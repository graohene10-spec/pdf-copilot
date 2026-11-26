/**
 * 学过的要点：学习对话里通过了检查的节点，按书存一份，带页码和原文出处。
 * 它是「记忆」的一部分，显示在记忆界面里那本书的条目下面。
 */
import { reactive } from 'vue'
import { library } from '../sdk'
import type { BookMap } from './learning'

const key = (documentId: string) => 'learn.map.v1.' + documentId
// 哪些书有要点：记忆界面要把它们都列出来，不必先打开每本书。
const BOOKS = 'learn.map.books.v1'
export const maps = reactive<Record<string, BookMap>>({})
export const mapTitles = reactive<Record<string, string>>({})
const loading = new Map<string, Promise<BookMap>>()

export function loadMap(documentId: string): Promise<BookMap> {
  let pending = loading.get(documentId)
  if (!pending) {
    pending = (async () => {
      let map: BookMap = { nodes: [], edges: [] }
      try {
        const stored = JSON.parse(await library.getSetting(key(documentId)) || 'null')
        if (Array.isArray(stored?.nodes) && Array.isArray(stored?.edges)) map = { nodes: stored.nodes.filter((node: any) => node && typeof node.id === 'string' && typeof node.title === 'string'), edges: stored.edges }
      } catch { /* 读不到就从空的开始 */ }
      return maps[documentId] = map
    })()
    loading.set(documentId, pending)
  }
  return pending
}
let all: Promise<void> | undefined
export function loadAllMaps(): Promise<void> {
  return all ||= (async () => {
    try { Object.assign(mapTitles, JSON.parse(await library.getSetting(BOOKS) || '{}')) } catch { /* 没有就是空的 */ }
    await Promise.all(Object.keys(mapTitles).map(loadMap))
  })()
}
// 所有学习对话的名册：学习进度页和文档库卡片上的进度条都读它，不必把每本书的对话全读进来。
const SESSIONS = 'learn.sessions.v1'
export type LearnSession = { documentId: string; documentTitle: string; title: string; goal: string; phase: string; passed: number; total: number; current: string; at: number }
export const sessions = reactive<Record<string, LearnSession>>({})
/** 名册读好了；值是它以前存没存过（没存过就要从已有的对话里补一遍）。 */
export const sessionsReady: Promise<boolean> = (async () => {
  try { const raw = await library.getSetting(SESSIONS); if (raw) { Object.assign(sessions, JSON.parse(raw)); return true } } catch { /* 读不到就从空的开始 */ }
  return false
})()
let sessionTimer = 0
const saveSessions = () => { clearTimeout(sessionTimer); sessionTimer = window.setTimeout(() => { void library.setSetting(SESSIONS, JSON.stringify(sessions)).catch(() => {}) }, 300) }
export function noteSession(conversationId: string, entry: LearnSession) {
  const now = sessions[conversationId]
  if (now && JSON.stringify({ ...now, at: 0 }) === JSON.stringify({ ...entry, at: 0 })) return
  sessions[conversationId] = entry; saveSessions()
}
export function forgetSession(conversationId: string) { if (sessions[conversationId]) { delete sessions[conversationId]; saveSessions() } }
/** 这本书最近一段学习对话的进度。 */
export function bookProgress(documentId: string): LearnSession | undefined {
  let best: LearnSession | undefined
  for (const item of Object.values(sessions)) if (item.documentId === documentId && item.total && (!best || item.at > best.at)) best = item
  return best
}
const timers = new Map<string, number>()
function persist(documentId: string) {
  clearTimeout(timers.get(documentId))
  timers.set(documentId, window.setTimeout(() => {
    void library.setSetting(key(documentId), JSON.stringify(maps[documentId])).catch(() => { /* 存不进去就只留在这次 */ })
    void library.setSetting(BOOKS, JSON.stringify(mapTitles)).catch(() => {})
  }, 300))
}
export async function addToMap(documentId: string, title: string, merge: (map: BookMap) => BookMap) {
  await loadAllMaps()
  maps[documentId] = merge(await loadMap(documentId)); mapTitles[documentId] = title
  persist(documentId)
}
export async function forgetPoint(documentId: string, id: string) {
  const map = await loadMap(documentId)
  maps[documentId] = { nodes: map.nodes.filter(node => node.id !== id), edges: map.edges.filter(edge => !edge.includes(id)) }
  persist(documentId)
}
