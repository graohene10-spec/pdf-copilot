// One shared, persisted markup store per document. Split panes and a reader
// reopened from the cache see the same strokes and the same undo history.
import { countPoints, emptyInk, inkKey, parseInk, serializeInk, MAX_INK_CHARS, MAX_INK_POINTS, type InkDocument, type InkStroke } from './model.ts'

export interface InkStorage { getSetting(key: string): Promise<string | null>; setSetting(key: string, value: string): Promise<void> }
type Operation =
  | { kind: 'add'; page: number; stroke: InkStroke }
  | { kind: 'erase'; page: number; removed: { stroke: InkStroke; index: number }[] }
  | { kind: 'clear'; page: number; strokes: InkStroke[] }
  | { kind: 'clearAll'; page: null; pages: [number, InkStroke[]][] }
  | { kind: 'recolor'; page: null; changes: { page: number; before: InkStroke; after: InkStroke }[] }
  | { kind: 'group'; page: null; operations: Operation[] }
export type InkListener = (page: number | null) => void

const HISTORY = 200
export const SAVE_DELAY = 700

export class InkStore {
  readonly key: string | null
  document: InkDocument = emptyInk()
  points = 0
  loaded: Promise<void>
  error = ''
  private history: Operation[] = []
  private listeners = new Set<InkListener>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private saving: Promise<void> = Promise.resolve()
  private dirty = false
  private readFailed = false
  refs = 0
  private storage: InkStorage | null
  private delay: number

  /** `after` lets a reopened document wait for the previous instance's final save. */
  constructor(documentId: string | undefined, storage: InkStorage | null, delay = SAVE_DELAY, after?: Promise<void>) {
    this.key = inkKey(documentId)
    this.storage = storage
    this.delay = delay
    this.loaded = this.load(after)
  }

  private async load(after?: Promise<void>) {
    if (!this.key || !this.storage) return
    await after?.catch(() => {})
    let raw: string | null = null
    try { raw = await this.storage.getSetting(this.key) }
    catch (error) {
      // Never overwrite marks that could not be read with only the new ones.
      this.readFailed = true
      this.error = `无法读取标记：${(error as Error)?.message || error}`
    }
    const stored = parseInk(raw)
    // Marks drawn before storage answered are kept after the stored ones.
    for (const [page, strokes] of this.document.pages) stored.pages.set(page, [...(stored.pages.get(page) || []), ...strokes])
    this.document = stored
    this.points = countPoints(stored)
    this.emit(null)
  }

  subscribe(listener: InkListener) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private emit(page: number | null) { for (const listener of this.listeners) listener(page) }

  strokes(page: number): readonly InkStroke[] { return this.document.pages.get(page) || [] }
  get canUndo() { return this.history.length > 0 }
  /** Whether a stroke of `count` points still fits the per-document budget. */
  canAdd(count: number) { return this.points + count <= MAX_INK_POINTS }

  add(page: number, stroke: InkStroke) {
    if (stroke.points.length < 4 || !this.canAdd(stroke.points.length / 2)) return false
    const list = this.document.pages.get(page) || []
    this.document.pages.set(page, [...list, stroke])
    this.points += stroke.points.length / 2
    this.record({ kind: 'add', page, stroke })
    return true
  }

  erase(page: number, ids: Iterable<string>) {
    const wanted = new Set(ids), list = this.document.pages.get(page) || []
    const removed = list.map((stroke, index) => ({ stroke, index })).filter(({ stroke }) => wanted.has(stroke.id))
    if (!removed.length) return false
    this.set(page, list.filter(stroke => !wanted.has(stroke.id)))
    this.record({ kind: 'erase', page, removed })
    return true
  }

  clearPage(page: number) {
    const strokes = [...this.strokes(page)]
    if (!strokes.length) return false
    this.set(page, [])
    this.record({ kind: 'clear', page, strokes })
    return true
  }

  /** Remove every mark in the document (Markdown has no pages to clear one by one). */
  clearAll() {
    const pages = [...this.document.pages.entries()].map(([page, strokes]) => [page, [...strokes]] as [number, InkStroke[]])
    if (!pages.length) return false
    this.document.pages = new Map()
    this.points = 0
    this.record({ kind: 'clearAll', page: null, pages })
    return true
  }
  get hasInk() { return this.document.pages.size > 0 }

  /** Erase a selection spanning several pages as one undo step. */
  eraseSelection(selection: ReadonlyMap<number, ReadonlySet<string>>) {
    const operations: Operation[] = []
    for (const [page, ids] of selection) {
      const list = this.document.pages.get(page) || []
      const removed = list.map((stroke, index) => ({ stroke, index })).filter(({ stroke }) => ids.has(stroke.id))
      if (!removed.length) continue
      this.set(page, list.filter(stroke => !ids.has(stroke.id)))
      operations.push({ kind: 'erase', page, removed })
    }
    if (!operations.length) return false
    this.record({ kind: 'group', page: null, operations })
    return true
  }

  /** Give every selected stroke a new colour (one undo step); ids stay the same so the selection survives. */
  recolor(selection: ReadonlyMap<number, ReadonlySet<string>>, color: string) {
    const changes: { page: number; before: InkStroke; after: InkStroke }[] = []
    for (const [page, ids] of selection) {
      const list = this.document.pages.get(page)
      if (!list) continue
      this.document.pages.set(page, list.map(stroke => {
        if (!ids.has(stroke.id) || stroke.color === color) return stroke
        const after = { ...stroke, color }
        changes.push({ page, before: stroke, after })
        return after
      }))
    }
    if (!changes.length) return false
    this.record({ kind: 'recolor', page: null, changes })
    return true
  }

  undo() {
    const operation = this.history.pop()
    if (!operation) return null
    this.revert(operation)
    this.changed(operation.page)
    return operation.page
  }

  private revert(operation: Operation) {
    if (operation.kind === 'group') { for (const part of [...operation.operations].reverse()) this.revert(part); return }
    if (operation.kind === 'recolor') {
      for (const { page, before, after } of operation.changes) {
        const list = this.document.pages.get(page)
        if (list) this.document.pages.set(page, list.map(stroke => stroke === after ? before : stroke))
      }
      return
    }
    if (operation.kind === 'clearAll') {
      for (const [page, strokes] of operation.pages) this.document.pages.set(page, [...strokes, ...this.strokes(page)])
      this.points = countPoints(this.document)
      return
    }
    const list = [...this.strokes(operation.page)]
    if (operation.kind === 'add') this.set(operation.page, list.filter(stroke => stroke !== operation.stroke))
    else if (operation.kind === 'clear') this.set(operation.page, [...operation.strokes, ...list])
    else {
      for (const { stroke, index } of [...operation.removed].sort((a, b) => a.index - b.index)) list.splice(Math.min(index, list.length), 0, stroke)
      this.set(operation.page, list)
    }
  }

  private set(page: number, strokes: InkStroke[]) {
    if (strokes.length) this.document.pages.set(page, strokes)
    else this.document.pages.delete(page)
    this.points = countPoints(this.document)
  }

  private record(operation: Operation) {
    this.history.push(operation)
    if (this.history.length > HISTORY) this.history.splice(0, this.history.length - HISTORY)
    this.changed(operation.page)
  }

  private changed(page: number | null) {
    this.dirty = true
    this.emit(page)
    if (!this.key || !this.storage) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush() }, this.delay)
  }

  /** Write pending changes now; resolves once the latest state is stored. */
  flush(): Promise<void> {
    clearTimeout(this.timer); this.timer = undefined
    if (!this.dirty || !this.key || !this.storage) return this.saving
    const storage = this.storage, key = this.key
    this.saving = this.saving.then(async () => {
      await this.loaded
      if (!this.dirty || this.readFailed) return
      this.dirty = false
      const value = serializeInk(this.document)
      if (value.length > MAX_INK_CHARS) { this.error = '本文档的标记太多，无法保存；请先擦除一部分。'; this.emit(null); return }
      try { await storage.setSetting(key, value); if (this.error) { this.error = ''; this.emit(null) } }
      catch (error) { this.dirty = true; this.error = `标记保存失败：${(error as Error)?.message || error}`; this.emit(null) }
    })
    return this.saving
  }

  dispose() { this.listeners.clear(); return this.flush() }
}

const stores = new Map<string, InkStore>()
const closing = new Map<string, Promise<void>>()
/** Acquire the shared store for a document; release it with releaseInkStore. */
export function acquireInkStore(documentId: string | undefined, storage: InkStorage | null, delay = SAVE_DELAY) {
  const key = inkKey(documentId)
  if (!key || !storage) { const store = new InkStore(undefined, null, delay); store.refs = 1; return store }
  let store = stores.get(key)
  if (!store) { store = new InkStore(documentId, storage, delay, closing.get(key)); stores.set(key, store) }
  store.refs++
  return store
}
export function releaseInkStore(store: InkStore) {
  if (--store.refs > 0) { void store.flush(); return }
  const key = store.key
  if (!key || stores.get(key) !== store) { void store.dispose(); return }
  stores.delete(key)
  const saved = store.dispose()
  closing.set(key, saved)
  void saved.finally(() => { if (closing.get(key) === saved) closing.delete(key) })
}
