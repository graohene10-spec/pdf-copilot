// 手势提醒：中键解释、右键拖动截图这类屏幕上看不见的功能，在用得上的时候提一句。
// 每条一共只提两次，一次会话里每条最多一次，两条之间至少隔 45 秒；用过一次就不再提。
import { ref } from 'vue'

export type Hint = { id: string; keys: string[]; text: string }
const KEY = 'kaizhi.hints.v1', MAX = 2, GAP = 45000, STAY = 6500, LEARNED = 99
const counts: Record<string, number> = (() => { try { const value = JSON.parse(localStorage.getItem(KEY) || '{}'); return value && typeof value === 'object' ? value : {} } catch { return {} } })()
const seen = new Set<string>()
let lastAt = 0, timer = 0
export const currentHint = ref<Hint | null>(null)
function save() { try { localStorage.setItem(KEY, JSON.stringify(counts)) } catch { /* 存不了就算了，最多多提几次 */ } }

export function offerHint(id: string, keys: string[], text: string) {
  if ((counts[id] || 0) >= MAX || seen.has(id) || currentHint.value || Date.now() - lastAt < GAP) return
  counts[id] = (counts[id] || 0) + 1; seen.add(id); lastAt = Date.now(); save()
  currentHint.value = { id, keys, text }
  clearTimeout(timer); timer = window.setTimeout(dismissHint, STAY)
}
export function dismissHint() { clearTimeout(timer); currentHint.value = null }
/** 用户已经自己用过这个功能：以后不再提。 */
export function hintLearned(id: string) {
  if (counts[id] !== LEARNED) { counts[id] = LEARNED; save() }
  // 照着刚弹出的提示做了：收起它，也不必再等间隔，下一条（比如 Shift + 中键）可以接着提。
  if (currentHint.value?.id === id) { dismissHint(); lastAt = 0 }
}
