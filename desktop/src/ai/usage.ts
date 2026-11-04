/**
 * 用量账本：本次打开应用以来每一次模型请求（对话、侧边对话、/btw、/compress、翻译、问题预判）
 * 的 token 用量与用时，供 /usage 面板汇总；按天的合计存在本机，用来画「今天」那一条。
 */
import { reactive } from 'vue'

export type UsageKind = 'chat' | 'side' | 'btw' | 'compress' | 'translate' | 'predict'
export type UsageEntry = { kind: UsageKind; provider: string; model: string; input: number; output: number; reasoning: number; estimated: boolean; ms: number; at: number }
export const USAGE_KINDS: Record<UsageKind, string> = { chat: '主对话', side: '侧边对话', btw: '/btw 顺便问', compress: '/compress 压缩', translate: '翻译', predict: '问题预判' }

const DAILY_KEY = 'kaizhi.usage.daily.v1'
const KEEP_DAYS = 14
type Day = { input: number; output: number; requests: number }

// 「已打开」从页面载入算起，而不是从第一次用到 AI 的时候。
export const ledger = reactive({ startedAt: Math.round(globalThis.performance?.timeOrigin || Date.now()), entries: [] as UsageEntry[] })

export const dayKey = (time = Date.now()) => { const date = new Date(time); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
function readDaily(): Record<string, Day> {
  try { const value = JSON.parse(localStorage.getItem(DAILY_KEY) || '{}'); return value && typeof value === 'object' ? value : {} } catch { return {} }
}
function writeDaily(days: Record<string, Day>) {
  const keep = Object.keys(days).sort().slice(-KEEP_DAYS)
  try { localStorage.setItem(DAILY_KEY, JSON.stringify(Object.fromEntries(keep.map(key => [key, days[key]])))) } catch { /* 存不下就只留本次会话的数字 */ }
}

export function recordUsage(entry: Omit<UsageEntry, 'at'> & { at?: number }) {
  const item: UsageEntry = { ...entry, input: Math.max(0, Math.round(entry.input || 0)), output: Math.max(0, Math.round(entry.output || 0)), reasoning: Math.max(0, Math.round(entry.reasoning || 0)), at: entry.at || Date.now() }
  if (!item.input && !item.output) return
  ledger.entries.push(item)
  if (ledger.entries.length > 4000) ledger.entries.splice(0, ledger.entries.length - 4000)
  const days = readDaily(), key = dayKey(item.at), day = days[key] || { input: 0, output: 0, requests: 0 }
  days[key] = { input: day.input + item.input, output: day.output + item.output, requests: day.requests + 1 }
  writeDaily(days)
}

export type UsageSummary = {
  requests: number; input: number; output: number; reasoning: number; estimated: boolean; busyMs: number; activeMs: number
  byModel: { model: string; provider: string; requests: number; input: number; output: number; reasoning: number }[]
  byKind: { kind: UsageKind; label: string; tokens: number; share: number }[]
  today: Day; peak: number
}
/** 汇总本次会话；today / peak 来自本机按天的合计（peak 是最近 14 天里单日最多的 token 数）。 */
export function summarize(entries: UsageEntry[] = ledger.entries, now = Date.now(), daily: Record<string, Day> = readDaily()): UsageSummary {
  const byModel = new Map<string, UsageSummary['byModel'][number]>(), byKind = new Map<UsageKind, number>()
  let input = 0, output = 0, reasoning = 0, busyMs = 0, estimated = false
  for (const entry of entries) {
    input += entry.input; output += entry.output; reasoning += entry.reasoning; busyMs += entry.ms; estimated ||= entry.estimated
    const key = `${entry.provider}:${entry.model}`, model = byModel.get(key) || { model: entry.model || '默认模型', provider: entry.provider, requests: 0, input: 0, output: 0, reasoning: 0 }
    model.requests++; model.input += entry.input; model.output += entry.output; model.reasoning += entry.reasoning
    byModel.set(key, model)
    byKind.set(entry.kind, (byKind.get(entry.kind) || 0) + entry.input + entry.output)
  }
  const total = Math.max(1, input + output)
  const today = daily[dayKey(now)] || { input: 0, output: 0, requests: 0 }
  const peak = Math.max(today.input + today.output, ...Object.values(daily).map(day => day.input + day.output))
  return {
    requests: entries.length, input, output, reasoning, estimated, busyMs, activeMs: now - ledger.startedAt,
    byModel: [...byModel.values()].sort((a, b) => b.input + b.output - a.input - a.output),
    byKind: [...byKind.entries()].map(([kind, tokens]) => ({ kind, label: USAGE_KINDS[kind], tokens, share: tokens / total })).sort((a, b) => b.tokens - a.tokens),
    today, peak,
  }
}
