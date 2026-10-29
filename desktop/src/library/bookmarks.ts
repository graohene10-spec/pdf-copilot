// 书签：在书里当前位置留一个记号，阅读区右侧的细条上显示，可以命名、删除、快速跳转。
// 位置由阅读器给出：PDF 是 { page, fraction }（页码与页内比例），Markdown 是 { progress }（整篇的滚动比例）。
// 每本书一份，存在本机文档库的设置表里；同一本书多开的副本共用。
import { reactive } from 'vue'
import { library } from '../sdk'

export type BookmarkPosition = { page?: number; fraction?: number; progress?: number }
export type Bookmark = { id: string; name: string; position: BookmarkPosition; createdAt: number }

const KEY = (id: string) => `bookmarks.v1.${id}`
const MAX = 200
export const bookmarks = reactive(new Map<string, Bookmark[]>())
const loading = new Map<string, Promise<void>>()

function valid(value: any): value is Bookmark {
  if (!value || typeof value.id !== 'string' || typeof value.name !== 'string' || !value.position || typeof value.position !== 'object') return false
  const { page, fraction, progress } = value.position
  if (page !== undefined && !(Number.isInteger(page) && page >= 1)) return false
  if (fraction !== undefined && !(Number.isFinite(fraction) && fraction >= -0.5 && fraction <= 1.5)) return false
  if (progress !== undefined && !(Number.isFinite(progress) && progress >= 0 && progress <= 1)) return false
  return page !== undefined || progress !== undefined
}

/** Reads a document's bookmarks once; later calls reuse the result. */
export function loadBookmarks(id: string) {
  if (!loading.has(id)) loading.set(id, (async () => {
    let list: Bookmark[] = []
    try { const parsed = JSON.parse(await library.getSetting(KEY(id)) || '[]'); if (Array.isArray(parsed)) list = parsed.filter(valid).slice(0, MAX).map(item => ({ ...item, name: item.name.slice(0, 40) })) }
    catch { /* 没有书签或数据损坏时从空列表开始 */ }
    if (!bookmarks.has(id)) bookmarks.set(id, list)
  })())
  return loading.get(id)!
}
function save(id: string) { void library.setSetting(KEY(id), JSON.stringify(bookmarks.get(id) || [])).catch(() => {}) }

export function addBookmark(id: string, position: BookmarkPosition) {
  const list = bookmarks.get(id) || []
  if (list.length >= MAX) return null
  const mark: Bookmark = { id: crypto.randomUUID(), name: '', position, createdAt: Date.now() }
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

export { neighbour } from './bookmark-nav'
