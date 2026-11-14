/**
 * 顶栏的小钟：平时显示现在几点；可以倒计时（几小时几分几秒）、正计时，或者定一个到点响的闹钟。
 * 状态记在 localStorage 里，重新打开应用时没到点的计时和闹钟还在。
 */
import { reactive } from 'vue'

const KEY = 'kaizhi.timer.v1'
/** 错过太久（关着应用、电脑睡着）的计时和闹钟不再补响。 */
const STALE = 10 * 60000
export type Alarm = { id: string; at: number }
export type Ringing = { kind: 'timer' | 'alarm'; at: number; total?: number }

export const clock = reactive({
  now: Date.now(),
  mode: 'idle' as 'idle' | 'down' | 'up',
  /** 倒计时总长（毫秒）。 */
  total: 0,
  /** 倒计时的结束时刻；正计时的开始时刻（暂停过的时间已经扣掉）。 */
  mark: 0,
  paused: false,
  /** 暂停时：倒计时还剩多少 / 正计时已经走了多少。 */
  held: 0,
  alarms: [] as Alarm[],
  ringing: null as Ringing | null,
  /** 上一次设的倒计时，下次打开还是它。 */
  last: { h: 0, m: 25, s: 0 },
})

/** 倒计时还剩多少毫秒。 */
export const remaining = () => clock.mode !== 'down' ? 0 : clock.paused ? clock.held : Math.max(0, clock.mark - clock.now)
/** 正计时已经走了多少毫秒。 */
export const elapsed = () => clock.mode !== 'up' ? 0 : clock.paused ? clock.held : Math.max(0, clock.now - clock.mark)

/** 「下午 3:42」：不带秒。 */
export function timeLabel(at: number) {
  const date = new Date(at), hours = date.getHours()
  return `${hours < 12 ? '上午' : '下午'} ${hours % 12 || 12}:${String(date.getMinutes()).padStart(2, '0')}`
}
/** 「1:02:03」或「02:03」。倒计时向上取整，这样刚开始时显示的是设定的时间，归零那一刻正好响。 */
export function span(ms: number, up = false) {
  const seconds = up ? Math.floor(ms / 1000) : Math.ceil(ms / 1000), h = Math.floor(seconds / 3600), m = Math.floor(seconds / 60) % 60, s = seconds % 60
  return `${h ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ mode: clock.mode, total: clock.total, mark: clock.mark, paused: clock.paused, held: clock.held, alarms: clock.alarms, last: clock.last })) } catch { /* 存不了就只在这次打开期间有效 */ }
}
function load() {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (!stored || typeof stored !== 'object') return
    const now = Date.now()
    if (stored.last && [stored.last.h, stored.last.m, stored.last.s].every(Number.isFinite)) clock.last = { h: stored.last.h, m: stored.last.m, s: stored.last.s }
    if (Array.isArray(stored.alarms)) clock.alarms = stored.alarms.filter((item: any) => item && typeof item.id === 'string' && Number.isFinite(item.at) && item.at > now - STALE).slice(0, 8)
    if ((stored.mode === 'down' || stored.mode === 'up') && Number.isFinite(stored.mark)) {
      if (stored.mode === 'down' && !stored.paused && stored.mark < now - STALE) return
      Object.assign(clock, { mode: stored.mode, total: Number(stored.total) || 0, mark: stored.mark, paused: Boolean(stored.paused), held: Number(stored.held) || 0 })
    }
  } catch { /* 记录坏了就当没有 */ }
}

// ---- 走时 ----------------------------------------------------------------------
let timer: ReturnType<typeof setTimeout> | undefined
function arm() {
  clearTimeout(timer)
  const now = Date.now(), running = clock.mode !== 'idle' && !clock.paused
  // 计时中每秒走几次；平时只在整分钟、或最近的闹钟到点时醒一下。
  const next = running ? 250 : Math.min(60000 - now % 60000, ...clock.alarms.map(alarm => alarm.at - now)) + 15
  timer = setTimeout(tick, Math.max(50, next))
}
function tick() {
  clock.now = Date.now()
  if (clock.mode === 'down' && !clock.paused && clock.now >= clock.mark) {
    ring({ kind: 'timer', at: clock.mark, total: clock.total })
    clock.mode = 'idle'; save()
  }
  const due = clock.alarms.filter(alarm => alarm.at <= clock.now)
  if (due.length) {
    clock.alarms = clock.alarms.filter(alarm => alarm.at > clock.now)
    ring({ kind: 'alarm', at: due.at(-1)!.at }); save()
  }
  arm()
}

// ---- 操作 ----------------------------------------------------------------------
export function startCountdown(ms: number) {
  unlockAudio()
  Object.assign(clock, { now: Date.now(), mode: 'down', total: ms, mark: Date.now() + ms, paused: false, held: 0 })
  save(); arm()
}
export function startStopwatch() {
  unlockAudio()
  Object.assign(clock, { now: Date.now(), mode: 'up', total: 0, mark: Date.now(), paused: false, held: 0 })
  save(); arm()
}
export function pauseTimer() {
  if (clock.mode === 'idle' || clock.paused) return
  clock.now = Date.now(); clock.held = clock.mode === 'down' ? remaining() : elapsed(); clock.paused = true
  save(); arm()
}
export function resumeTimer() {
  if (clock.mode === 'idle' || !clock.paused) return
  clock.now = Date.now(); clock.mark = clock.mode === 'down' ? clock.now + clock.held : clock.now - clock.held; clock.paused = false
  save(); arm()
}
export function stopTimer() { clock.mode = 'idle'; clock.paused = false; save(); arm() }
/** 定一个闹钟：今天这个钟点已经过了就是明天。 */
export function addAlarm(hours: number, minutes: number) {
  unlockAudio()
  const at = new Date(); at.setHours(hours, minutes, 0, 0)
  if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1)
  if (clock.alarms.some(alarm => alarm.at === at.getTime()) || clock.alarms.length >= 8) return
  clock.alarms = [...clock.alarms, { id: crypto.randomUUID(), at: at.getTime() }].sort((a, b) => a.at - b.at)
  save(); arm()
}
export function removeAlarm(id: string) { clock.alarms = clock.alarms.filter(alarm => alarm.id !== id); save(); arm() }
export function rememberFields(h: number, m: number, s: number) { clock.last = { h, m, s }; save() }

// ---- 到点：响几声，直到读者点「好」 -------------------------------------------------
let audio: AudioContext | undefined
let chimes: ReturnType<typeof setInterval> | undefined
/** 浏览器要先有一次点击才肯出声：开始计时、定闹钟时顺手把声音通道打开。 */
function unlockAudio() { try { audio ||= new AudioContext(); void audio.resume() } catch { /* 没有声音也照样提醒 */ } }
function chime() {
  if (!audio) return
  try {
    const start = audio.currentTime + .02
    for (const [index, pitch] of [880, 1108.7, 1318.5].entries()) {
      const tone = audio.createOscillator(), gain = audio.createGain(), at = start + index * .16
      tone.type = 'sine'; tone.frequency.value = pitch
      gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(.16, at + .02); gain.gain.exponentialRampToValueAtTime(.0001, at + .9)
      tone.connect(gain).connect(audio.destination); tone.start(at); tone.stop(at + .95)
    }
  } catch { /* 出不了声就算了 */ }
}
function ring(what: Ringing) {
  clock.ringing = what
  clearInterval(chimes); unlockAudio(); chime()
  let count = 1
  chimes = setInterval(() => { if (!clock.ringing || ++count > 12) { clearInterval(chimes); chimes = undefined } else chime() }, 2600)
}
export function dismissRing() { clock.ringing = null; clearInterval(chimes); chimes = undefined }

load(); tick()
// 从后台回到前台、电脑睡醒：马上对一次表。
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (!document.hidden) tick() })
