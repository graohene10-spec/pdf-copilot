// 书签：在书里当前位置留一个记号，阅读区右侧的细条上显示，可以命名、删除、快速跳转。
// 位置由阅读器给出：PDF 是 { page, fraction }（页码与页内比例），Markdown 是 { progress }（整篇的滚动比例）。
// 每本书一份，存在本机文档库的设置表里；同一本书多开的副本共用。
import { reactive } from 'vue'
import { library } from '../sdk'
import { pickArt, validArt } from './bookmark-art'

export type BookmarkPosition = { page?: number; fraction?: number; progress?: number }
export type Bookmark = {
  id: string; name: string; position: BookmarkPosition; createdAt: number
  /** 画风（bookmark-art.ts 里的一种）。 */ art?: string
  /** 掉了头：燕尾朝左。贴在书页左边时就是这样。 */ flip?: boolean
  /** 不贴边、自己摆的横向位置：平的那一头在书页宽度上的比例（0 是左边，1 是右边，可以在页外）。没有就是贴边。 */ x?: number
}

const KEY = (id: string) => `bookmarks.v1.${id}`
const MAX = 200
export const bookmarks = reactive(new Map<string, Bookmark[]>())
const loading = new Map<string, Promise<void>>()

function valid(value: any): value is Bookmark {
  if (!value || typeof value.id !== 'string' || typeof value.name !== 'string' || !value.position || typeof value.position !== 'object') return false
  const { page, fraction, progress } = value.position
  if (page !== undefined && !(Number.isInteger(page) && page >= 1)) return false
  if (fraction !== undefined && !(Number.isFinite(fraction) && fraction >= -0.5 && fraction <= 1.5)) return false
  // Markdown 的书签可以摆到最后一屏里，那里的比例超过 1。
  if (progress !== undefined && !(Number.isFinite(progress) && progress >= 0 && progress <= 3)) return false
  return page !== undefined || progress !== undefined
}

/** Reads a document's bookmarks once; later calls reuse the result. */
export function loadBookmarks(id: string) {
  if (!loading.has(id)) loading.set(id, (async () => {
    let list: Bookmark[] = []
    try { const parsed = JSON.parse(await library.getSetting(KEY(id)) || '[]'); if (Array.isArray(parsed)) list = parsed.filter(valid).slice(0, MAX).map(item => ({ ...item, name: item.name.slice(0, 40), art: validArt(item.art) ? item.art : undefined, flip: item.flip === true ? true : undefined, x: typeof item.x === 'number' && Number.isFinite(item.x) ? Math.max(-4, Math.min(5, item.x)) : undefined })) }
    catch { /* 没有书签或数据损坏时从空列表开始 */ }
    if (!bookmarks.has(id)) bookmarks.set(id, list)
  })())
  return loading.get(id)!
}
function save(id: string) { void library.setSetting(KEY(id), JSON.stringify(bookmarks.get(id) || [])).catch(() => {}) }

export function addBookmark(id: string, position: BookmarkPosition) {
  const list = bookmarks.get(id) || []
  if (list.length >= MAX) return null
  const mark: Bookmark = { id: crypto.randomUUID(), name: '', position, createdAt: Date.now(), art: pickArt(list) }
  bookmarks.set(id, [...list, mark])
  save(id)
  return mark
}
export function removeBookmark(id: string, markId: string) {
  bookmarks.set(id, (bookmarks.get(id) || []).filter(mark => mark.id !== markId))
  save(id)
}
/** Removes every bookmark of a document; returns how many were removed. */
export function clearBookmarks(id: string) {
  const count = bookmarks.get(id)?.length || 0
  bookmarks.set(id, [])
  save(id)
  return count
}
export function renameBookmark(id: string, markId: string, name: string) {
  bookmarks.set(id, (bookmarks.get(id) || []).map(mark => mark.id === markId ? { ...mark, name: name.trim().slice(0, 40) } : mark))
  save(id)
}

/** 把书签挪到新位置：竖向是它标记的地方，横向是贴右边、贴左边（掉头）还是自己摆。 */
export function placeBookmark(id: string, markId: string, to: { position: BookmarkPosition; flip: boolean; x?: number }) {
  bookmarks.set(id, (bookmarks.get(id) || []).map(mark => mark.id === markId ? { ...mark, position: to.position, flip: to.flip || undefined, x: to.x } : mark))
  save(id)
}

export function restyleBookmark(id: string, markId: string, art: string) {
  if (!validArt(art)) return
  bookmarks.set(id, (bookmarks.get(id) || []).map(mark => mark.id === markId ? { ...mark, art } : mark))
  save(id)
}

export { neighbour } from './bookmark-nav'
