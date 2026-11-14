<script setup lang="ts">
// 顶栏的小钟。平时显示现在几点（上午 / 下午 时:分）；点开是一张小卡片：倒计时（不填时间就是正计时）和闹钟。
// 开始计时后卡片收起，小钟上改成显示剩下的时间；到点了卡片自己弹出来，响几声。
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { addAlarm, clock, dismissRing, elapsed, pauseTimer, remaining, removeAlarm, rememberFields, resumeTimer, span, startCountdown, startStopwatch, stopTimer, timeLabel } from '../ui/timer'

const open = ref(false)
const tab = ref<'timer' | 'alarm'>('timer')
const chip = ref<HTMLElement>(), panel = ref<HTMLElement>()
const place = ref({ top: 12, right: 12 })
// 卡片挂在小钟下面、右边对齐；顶栏收起来时小钟不在，就放在窗口右上角。
function locate() {
  const box = chip.value?.getBoundingClientRect()
  place.value = box && box.width ? { top: Math.round(box.bottom + 8), right: Math.max(8, Math.round(innerWidth - box.right)) } : { top: 12, right: 12 }
}
function toggle() { open.value = !open.value }
watch(open, value => { if (value) { locate(); fields.h = clock.last.h; fields.m = clock.last.m; fields.s = clock.last.s; alarmAt.value = nextHalfHour() } })
watch(() => clock.ringing, ringing => { if (ringing) open.value = true })
function outside(event: PointerEvent) { if (!open.value || clock.ringing) return; const target = event.target as Node; if (!panel.value?.contains(target) && !chip.value?.contains(target)) open.value = false }
function key(event: KeyboardEvent) { if (event.key === 'Escape' && open.value && !clock.ringing) { open.value = false; chip.value?.focus() } }
onMounted(() => { document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', key); window.addEventListener('resize', locate) })
onBeforeUnmount(() => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', key); window.removeEventListener('resize', locate) })

// ---- 现在几点 ------------------------------------------------------------------
const nowLabel = computed(() => timeLabel(clock.now))
const half = computed(() => nowLabel.value.split(' ')[0]), digits = computed(() => nowLabel.value.split(' ')[1])
const today = computed(() => { const date = new Date(clock.now); return `${date.getMonth() + 1}月${date.getDate()}日 周${'日一二三四五六'[date.getDay()]}` })

// ---- 计时 ----------------------------------------------------------------------
const fields = reactive({ h: clock.last.h, m: clock.last.m, s: clock.last.s })
const LIMIT = { h: 99, m: 59, s: 59 } as const
type Unit = keyof typeof LIMIT
const UNITS: { key: Unit; label: string }[] = [{ key: 'h', label: '时' }, { key: 'm', label: '分' }, { key: 's', label: '秒' }]
function setField(unit: Unit, value: number) { fields[unit] = Math.min(LIMIT[unit], Math.max(0, Math.round(value) || 0)) }
function typed(unit: Unit, event: Event) { const input = event.target as HTMLInputElement; setField(unit, Number(input.value.replace(/\D/g, '').slice(-2))); input.value = String(fields[unit]).padStart(2, '0') }
function nudge(unit: Unit, by: number) { const size = LIMIT[unit] + 1; fields[unit] = (fields[unit] + by + size) % size }
function wheel(unit: Unit, event: WheelEvent) { event.preventDefault(); nudge(unit, event.deltaY < 0 ? 1 : -1) }
const PRESETS = [5, 15, 25, 60]
function preset(minutes: number) { fields.h = Math.floor(minutes / 60); fields.m = minutes % 60; fields.s = 0 }
const total = computed(() => ((fields.h * 60 + fields.m) * 60 + fields.s) * 1000)
function start() {
  rememberFields(fields.h, fields.m, fields.s)
  if (total.value) startCountdown(total.value); else startStopwatch()
  open.value = false
}
const left = computed(() => remaining()), gone = computed(() => elapsed())
const running = computed(() => clock.mode !== 'idle')
const reading = computed(() => clock.mode === 'down' ? span(left.value) : span(gone.value, true))
// 倒计时的圆环：走过的部分一点点擦掉。正计时没有终点，圆环每分钟转一圈。
const share = computed(() => clock.mode === 'down' ? (clock.total ? left.value / clock.total : 0) : (gone.value % 60000) / 60000)

// ---- 闹钟 ----------------------------------------------------------------------
function nextHalfHour() { const date = new Date(Date.now() + 30 * 60000); date.setMinutes(date.getMinutes() < 30 ? 30 : 60, 0, 0); return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` }
const alarmAt = ref(nextHalfHour())
function setAlarm() { const [hours, minutes] = alarmAt.value.split(':').map(Number); if (Number.isFinite(hours) && Number.isFinite(minutes)) addAlarm(hours!, minutes!) }
function alarmLabel(at: number) { const day = new Date(at).getDate() !== new Date(clock.now).getDate(); return `${day ? '明天 ' : ''}${timeLabel(at)}` }

// ---- 到点 ----------------------------------------------------------------------
const ringText = computed(() => {
  const ringing = clock.ringing
  if (!ringing) return ''
  if (ringing.kind === 'alarm') return timeLabel(ringing.at)
  const seconds = Math.round((ringing.total || 0) / 1000), h = Math.floor(seconds / 3600), m = Math.floor(seconds / 60) % 60, s = seconds % 60
  return [h && `${h} 小时`, m && `${m} 分`, s && `${s} 秒`].filter(Boolean).join(' ')
})
function done() { dismissRing(); open.value = false }
// ---- 表盘：指针指着现在几点；计时中外圈多一道弧，是剩下的时间 ------------------------
const TICKS = 'M50.0 25.5L50.0 20.5 M65.5 27.2L66.8 25.0 M76.8 38.5L79.0 37.2 M78.5 54.0L83.5 54.0 M76.8 69.5L79.0 70.8 M65.5 80.8L66.8 83.0 M50.0 82.5L50.0 87.5 M34.5 80.8L33.2 83.0 M23.2 69.5L21.0 70.8 M21.5 54.0L16.5 54.0 M23.2 38.5L21.0 37.2 M34.5 27.2L33.2 25.0'
const hands = computed(() => { const date = new Date(clock.now), minutes = date.getMinutes(); return { hour: (date.getHours() % 12 + minutes / 60) * 30, minute: minutes * 6 } })
const hero = computed(() => {
  const ringing = clock.ringing
  if (ringing) return ringing.kind === 'alarm' ? { small: '闹钟响了', big: timeLabel(ringing.at).split(' ')[1], sub: timeLabel(ringing.at).split(' ')[0] } : { small: '时间到', big: '00:00', sub: ringText.value }
  if (clock.mode === 'down') return { small: clock.paused ? '已暂停' : '倒计时', big: reading.value, sub: clock.paused ? '' : `${timeLabel(clock.mark)} 到点` }
  if (clock.mode === 'up') return { small: clock.paused ? '已暂停' : '正计时', big: reading.value, sub: '' }
  return { small: half.value, big: digits.value, sub: today.value }
})
watch(tab, () => void nextTick(locate))
</script>

<template>
  <button ref="chip" type="button" class="icon-button clock-chip" :class="{ active: open, running, paused: clock.paused, ringing: clock.ringing }" :aria-expanded="open" aria-label="计时与闹钟" :data-tip="open ? undefined : '计时 / 闹钟'" @click="toggle">
    <template v-if="clock.ringing"><AppIcon name="bell" :size="15" class="cc-bell" /><span>到点了</span></template>
    <template v-else-if="running">
      <svg class="cc-ring" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" /><circle cx="8" cy="8" r="6" pathLength="1" :stroke-dasharray="`${share} 1`" /></svg>
      <span>{{ reading }}</span>
    </template>
    <template v-else><AppIcon v-if="clock.alarms.length" name="bell" :size="13" class="cc-alarm" /><span><small>{{ half }}</small>{{ digits }}</span></template>
  </button>
  <Teleport to="body">
    <Transition name="clock-pop">
      <div v-if="open" ref="panel" class="clock-panel" :class="{ ringing: clock.ringing }" role="dialog" aria-label="计时与闹钟" :style="{ top: `${place.top}px`, right: `${place.right}px` }">
        <div class="cp-hero">
          <svg class="cp-face" :class="{ shake: clock.ringing }" viewBox="0 0 100 100" aria-hidden="true">
            <path class="cp-ears" d="M20 24a15 15 0 0 1 21-13 M80 24a15 15 0 0 0-21-13 M50 12v6 M29 86l-6 9 M71 86l6 9" />
            <circle class="cp-rim" cx="50" cy="54" r="36" />
            <path class="cp-ticks" :d="TICKS" />
            <circle v-if="running && !clock.ringing" class="cp-arc" cx="50" cy="54" r="36" pathLength="1" :stroke-dasharray="`${share} 1`" transform="rotate(-90 50 54)" />
            <line class="cp-hand" x1="50" y1="54" x2="50" y2="36" :transform="`rotate(${hands.hour} 50 54)`" />
            <line class="cp-hand long" x1="50" y1="54" x2="50" y2="27" :transform="`rotate(${hands.minute} 50 54)`" />
            <circle class="cp-hub" cx="50" cy="54" r="2.6" />
          </svg>
          <p class="cp-read"><small>{{ hero.small }}</small><b>{{ hero.big }}</b><span>{{ hero.sub }}</span></p>
        </div>
        <!-- 到点 -->
        <button v-if="clock.ringing" type="button" class="cp-go cp-ok" @click="done">好</button>
        <template v-else>
          <div class="cp-tabs" role="tablist">
            <button type="button" role="tab" :aria-selected="tab === 'timer'" :class="{ on: tab === 'timer' }" @click="tab = 'timer'">计时</button>
            <button type="button" role="tab" :aria-selected="tab === 'alarm'" :class="{ on: tab === 'alarm' }" @click="tab = 'alarm'">闹钟<i v-if="clock.alarms.length">{{ clock.alarms.length }}</i></button>
          </div>
          <!-- 计时 -->
          <template v-if="tab === 'timer'">
            <p v-if="running" class="cp-controls">
              <button v-if="clock.paused" type="button" aria-label="继续" data-tip="继续" @click="resumeTimer"><AppIcon name="play" :size="16" /></button>
              <button v-else type="button" aria-label="暂停" data-tip="暂停" @click="pauseTimer"><AppIcon name="pause" :size="16" /></button>
              <button type="button" aria-label="结束计时" data-tip="结束" @click="stopTimer"><AppIcon name="stop" :size="15" /></button>
            </p>
            <template v-else>
              <div class="cp-fields">
                <label v-for="unit in UNITS" :key="unit.key"><input type="text" inputmode="numeric" maxlength="3" :value="String(fields[unit.key]).padStart(2, '0')" :aria-label="unit.label" @change="typed(unit.key, $event)" @focus="($event.target as HTMLInputElement).select()" @wheel="wheel(unit.key, $event)" @keydown.up.prevent="nudge(unit.key, 1)" @keydown.down.prevent="nudge(unit.key, -1)" @keydown.enter.prevent="typed(unit.key, $event); start()" /><span>{{ unit.label }}</span></label>
              </div>
              <p class="cp-presets"><button v-for="minutes in PRESETS" :key="minutes" type="button" :class="{ on: total === minutes * 60000 }" @click="preset(minutes)">{{ minutes < 60 ? `${minutes} 分` : `${minutes / 60} 小时` }}</button></p>
              <button type="button" class="cp-go" :aria-label="total ? '开始倒计时' : '开始正计时'" :data-tip="total ? '开始倒计时' : '没填时间：正计时'" @click="start"><AppIcon name="play" :size="14" />{{ total ? '开始' : '正计时' }}</button>
            </template>
          </template>
          <!-- 闹钟 -->
          <template v-else>
            <form class="cp-alarm-new" @submit.prevent="setAlarm"><input v-model="alarmAt" type="time" required aria-label="闹钟时间" /><button type="submit" class="cp-go" aria-label="定闹钟" data-tip="定闹钟"><AppIcon name="plus" :size="15" /></button></form>
            <TransitionGroup name="cp-alarm" tag="ul" class="cp-alarms">
              <li v-for="alarm in clock.alarms" :key="alarm.id"><AppIcon name="bell" :size="13" /><b>{{ alarmLabel(alarm.at) }}</b><button type="button" aria-label="取消这个闹钟" data-tip="取消" @click="removeAlarm(alarm.id)"><AppIcon name="close" :size="12" /></button></li>
            </TransitionGroup>
          </template>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<style>
/* ---- 顶栏上的小钟 ---- */
.app-topbar .topbar-actions .icon-button.clock-chip{flex:none;width:auto;min-width:0;gap:6px;padding:0 10px;font-size:12.5px;font-weight:550;font-variant-numeric:tabular-nums;white-space:nowrap;letter-spacing:.01em}
.clock-chip small{margin-right:.3em;font-size:.82em;font-weight:500;opacity:.62}
.clock-chip .cc-alarm{opacity:.6}
.cc-ring{flex:none;rotate:-90deg}
.cc-ring circle{fill:none;stroke:currentColor;stroke-width:2}
.cc-ring circle:first-child{opacity:.18}
.cc-ring circle:last-child{stroke-linecap:round;transition:stroke-dasharray .3s linear}
.clock-chip.running{color:var(--accent)}
.clock-chip.paused{color:var(--muted)}
.clock-chip.paused .cc-ring circle:last-child{transition:none}
.clock-chip.ringing{color:var(--accent);animation:cc-pulse 1.3s ease-in-out infinite}
.cc-bell{transform-origin:50% 10%;animation:cc-swing 1.3s ease-in-out infinite}
@keyframes cc-pulse{50%{background-color:color-mix(in srgb,var(--accent) 18%,transparent)}}
@keyframes cc-swing{0%,55%,100%{rotate:0deg}10%{rotate:14deg}22%{rotate:-12deg}34%{rotate:8deg}45%{rotate:-4deg}}

/* ---- 卡片：上面是一只表盘和大号读数（平时是现在几点，计时中是剩下的时间），下面是计时 / 闹钟 ---- */
.clock-panel{position:fixed;z-index:430;width:256px;padding:14px 16px 14px;border:1px solid var(--glass-outline);border-radius:var(--r-lg,16px);background-color:var(--popup-glass);background-image:radial-gradient(110% 70% at 100% 0,color-mix(in srgb,var(--accent) 13%,transparent),transparent 62%),var(--popup-sheen);-webkit-backdrop-filter:blur(var(--popup-blur)) saturate(var(--glass-sat));backdrop-filter:blur(var(--popup-blur)) saturate(var(--glass-sat));box-shadow:var(--shadow-3),var(--glass-edge);color:var(--ink);transform-origin:calc(100% - 30px) 0;font-variant-numeric:tabular-nums}
.clock-panel p{margin:0}
.clock-panel button{min-height:0;transition:background-color .15s,color .15s,border-color .15s,box-shadow .15s,scale .18s var(--spring-snappy,ease-out),rotate .2s}
.clock-pop-enter-active{transition:opacity var(--dur-2,180ms) var(--ease-soft,ease),scale var(--dur-3,260ms) var(--spring-snappy,ease-out),translate var(--dur-3,260ms) var(--spring-snappy,ease-out)}
.clock-pop-leave-active{transition:opacity var(--dur-1,120ms) var(--ease-soft,ease),scale var(--dur-1,120ms) var(--ease-soft,ease)}
.clock-pop-enter-from{opacity:0;scale:.94;translate:0 -6px}.clock-pop-leave-to{opacity:0;scale:.97}
.cp-hero{display:flex;align-items:center;gap:14px}
.cp-face{flex:none;width:76px;height:76px;overflow:visible;fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round}
.cp-ears{display:none}
.cp-rim{stroke-width:1.6;opacity:.3}
.cp-ticks{stroke-width:1.6;opacity:.45}
.cp-arc{stroke:var(--accent);stroke-width:4;transition:stroke-dasharray .3s linear}
.cp-hand{stroke-width:3.2;transition:transform .5s var(--spring-snappy,ease-out)}
.cp-hand.long{stroke-width:2.2}
.cp-hub{fill:var(--accent);stroke:none}
.cp-face.shake{transform-origin:50% 60%;animation:cp-shake .5s linear infinite;color:var(--accent)}
@keyframes cp-shake{0%,100%{rotate:0deg}25%{rotate:-7deg}75%{rotate:7deg}}
.cp-read{display:flex;flex-direction:column;min-width:0}
.cp-read small{color:var(--muted);font-size:11.5px;line-height:1.3}
.cp-read b{font-size:34px;font-weight:300;line-height:1.08;letter-spacing:-.02em;white-space:nowrap}
.cp-read span{min-height:1.3em;color:var(--muted);font-size:11.5px;line-height:1.3}
.cp-tabs{display:grid;grid-template-columns:1fr 1fr;gap:2px;margin:13px 0 12px;padding:2px;border-radius:10px;background:color-mix(in srgb,var(--ink) 7%,transparent)}
.cp-tabs button{gap:5px;padding:4px 0;border:0;border-radius:8px;background:none;box-shadow:none;color:var(--muted);font-size:12.5px}
.cp-tabs button:hover:not(.on){background:none;color:var(--ink)}
.cp-tabs button.on,.cp-tabs button.on:hover{background:color-mix(in srgb,var(--surface,#fff) 82%,transparent);box-shadow:0 1px 3px rgb(0 0 0 / .14);color:var(--ink);font-weight:600}
.cp-tabs i{min-width:15px;padding:0 4px;border-radius:999px;background:var(--accent);color:#fff;font-size:10px;font-style:normal;line-height:15px}
.cp-fields{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.cp-fields label{display:flex;flex-direction:column;align-items:center;gap:4px;color:var(--muted);font-size:11px}
.cp-fields input{width:100%;height:48px;padding:0;border-radius:12px;text-align:center;font-size:25px;font-weight:350;font-variant-numeric:tabular-nums;cursor:ns-resize}
.cp-presets{display:flex;gap:4px;margin:10px 0 12px!important}
.cp-presets button{flex:1;padding:3px 0;border-radius:999px;background:none;box-shadow:none;color:var(--secondary,var(--muted));font-size:11.5px;white-space:nowrap}
.cp-presets button.on{border-color:color-mix(in srgb,var(--accent) 55%,transparent);color:var(--accent)}
.cp-go{width:100%;gap:6px;padding:7px 0;border:0;border-radius:11px;background:var(--accent);background-image:linear-gradient(180deg,rgb(255 255 255 / .16),transparent);box-shadow:0 6px 14px -8px var(--accent);color:#fff;font-size:13px;font-weight:600}
.cp-go:hover:not(:disabled){background-color:color-mix(in srgb,var(--accent) 88%,#000);color:#fff}
.cp-go:active{scale:.97}
.cp-ok{margin-top:14px}
.cp-controls{display:flex;justify-content:center;gap:12px;padding:2px 0 2px}
.cp-controls button{width:40px;height:40px;padding:0;border-radius:50%}
.cp-alarm-new{display:flex;gap:8px}
.cp-alarm-new input{flex:1;min-width:0;height:38px;padding:0 10px;border-radius:11px;font-size:17px;text-align:center}
.cp-alarm-new .cp-go{flex:none;width:38px;height:38px;padding:0}
.cp-alarms{position:relative;display:flex;flex-direction:column;gap:2px;margin:10px 0 0;padding:0;list-style:none}
.cp-alarms:empty{margin:0}
.cp-alarms li{display:flex;align-items:center;gap:8px;padding:5px 4px 5px 8px;border-radius:9px;color:var(--secondary,var(--ink))}
.cp-alarms li:hover{background:color-mix(in srgb,var(--ink) 6%,transparent)}
.cp-alarms li > svg{flex:none;color:var(--accent)}
.cp-alarms b{flex:1;font-size:13.5px;font-weight:550}
.cp-alarms button{width:22px;height:22px;padding:0;border:0;border-radius:50%;background:none;box-shadow:none;color:var(--muted);opacity:.6}
.cp-alarms button:hover{opacity:1}
.cp-alarm-enter-active,.cp-alarm-leave-active,.cp-alarm-move{transition:opacity .2s,translate .22s var(--spring-snappy,ease-out)}
.cp-alarm-enter-from,.cp-alarm-leave-to{opacity:0;translate:0 -6px}
.cp-alarm-leave-active{position:absolute;left:0;right:0}

/* ---- 暖色极简：象牙白纸、细线、衬线数字，陶土色只点在要紧处 ---- */
:root[data-style='warm'] .clock-chip{font-family:var(--font-reading)}
:root[data-style='warm'] .clock-panel{border:.5px solid var(--warm-rule,rgb(31 30 29 / .18));border-radius:8px;background:var(--surface);-webkit-backdrop-filter:none;backdrop-filter:none;box-shadow:0 12px 32px -16px rgb(31 30 29 / .4);font-family:var(--font-reading)}
:root[data-style='warm'] .cp-rim{stroke-width:1;opacity:.5}
:root[data-style='warm'] .cp-ticks{stroke-width:1}
:root[data-style='warm'] .cp-hand{stroke-width:2.4}
:root[data-style='warm'] .cp-hand.long{stroke-width:1.5}
:root[data-style='warm'] .cp-arc{stroke-width:2.5}
:root[data-style='warm'] .cp-read b{font-weight:400}
:root[data-style='warm'] .cp-read span{font-style:italic}
:root[data-style='warm'] .cp-tabs{gap:18px;display:flex;padding:0;border-radius:0;background:none;border-bottom:.5px solid var(--warm-rule,rgb(31 30 29 / .14))}
:root[data-style='warm'] .cp-tabs button{padding:0 0 6px;border-radius:0;margin-bottom:-.5px;border-bottom:1.5px solid transparent}
:root[data-style='warm'] .cp-tabs button.on,:root[data-style='warm'] .cp-tabs button.on:hover{background:none;box-shadow:none;border-bottom-color:var(--accent);color:var(--accent)}
:root[data-style='warm'] .cp-fields input,:root[data-style='warm'] .cp-alarm-new input{border:0;border-bottom:.5px solid var(--warm-rule,rgb(31 30 29 / .3));border-radius:0;background:none;box-shadow:none}
:root[data-style='warm'] .cp-fields input:focus,:root[data-style='warm'] .cp-alarm-new input:focus{border-bottom-color:var(--accent)}
:root[data-style='warm'] .cp-presets button{border:0;border-radius:0;font-style:italic}
:root[data-style='warm'] .cp-presets button:hover{background:none;color:var(--accent)}
:root[data-style='warm'] .cp-presets button.on{text-decoration:underline;text-underline-offset:3px}
:root[data-style='warm'] .cp-go{border-radius:6px;background-image:none;box-shadow:none}
:root[data-style='warm'] .cp-controls button{border:.5px solid var(--warm-rule,rgb(31 30 29 / .25));background:none;box-shadow:none}
:root[data-style='warm'] .cp-controls button:hover{color:var(--accent);border-color:var(--accent)}

/* ---- 铅笔草稿：一页白纸，铅笔勾的边；上面画着一只小闹钟，数字是手写的，要紧的地方用红铅笔圈出来 ---- */
:root[data-style='sketch'] .topbar-actions .icon-button.clock-chip,:root[data-style='sketch'] .topbar-actions .icon-button.clock-chip:hover:not(:disabled){width:auto;padding:0 11px;border-radius:15px 19px 16px 18px / 18px 15px 19px 16px}
:root[data-style='sketch'] .clock-chip.running{color:var(--red-pencil,#c0392b)}
:root[data-style='sketch'] .clock-panel{--scribble:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='8' viewBox='0 0 48 8' preserveAspectRatio='none'%3E%3Cpath d='M2 5.4c7-3.2 12 1.6 20-.6s14-2.6 24-.4' fill='none' stroke='%23c8553d' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E");width:262px;padding:16px 18px 16px;border:0;border-radius:15px 20px 14px 19px / 18px 13px 20px 14px;background:var(--paper,#fbf8f0);-webkit-backdrop-filter:none;backdrop-filter:none;box-shadow:3px 4px 0 rgb(60 50 30 / .16),10px 16px 28px -14px rgb(60 50 30 / .45);color:var(--pencil,#2b2a27);rotate:-.5deg}
:root[data-style='sketch'] .clock-panel::before{content:'';position:absolute;inset:0;border:1.6px solid var(--pencil,#2b2a27);border-radius:inherit;filter:url(#sk-pencil);opacity:.85;pointer-events:none}
:root[data-style='sketch'] .cp-face{width:84px;height:84px;filter:url(#sk-pencil)}
:root[data-style='sketch'] .cp-ears{display:block;stroke-width:2.2}
:root[data-style='sketch'] .cp-rim{stroke-width:2.2;opacity:1;fill:color-mix(in srgb,var(--sticky,#fff2a8) 55%,transparent)}
:root[data-style='sketch'] .cp-ticks{stroke-width:1.5;opacity:.7}
:root[data-style='sketch'] .cp-arc{stroke:var(--red-pencil,#c8553d);stroke-width:4.5;opacity:.9}
:root[data-style='sketch'] .cp-hub{fill:var(--red-pencil,#c8553d)}
:root[data-style='sketch'] .cp-face.shake{color:var(--pencil,#2b2a27)}
:root[data-style='sketch'] .cp-read small,:root[data-style='sketch'] .cp-read span,:root[data-style='sketch'] .cp-fields label{color:var(--pencil-soft,rgb(46 45 42 / .62));font-size:13px}
:root[data-style='sketch'] .cp-read b{font-family:Caveat,var(--font);font-size:46px;font-weight:700;line-height:.95;letter-spacing:0}
:root[data-style='sketch'] .cp-tabs{display:flex;gap:18px;margin:12px 0 10px;padding:9px 2px 0;border-radius:0;background:none;border-top:1.5px dashed var(--pencil-soft,rgb(46 45 42 / .35))}
:root[data-style='sketch'] .cp-tabs button{padding:0 1px 6px;border:0;border-radius:0;color:var(--pencil-soft,rgb(46 45 42 / .62));font-size:15px;background:none}
:root[data-style='sketch'] .cp-tabs button.on,:root[data-style='sketch'] .cp-tabs button.on:hover{background:var(--scribble) no-repeat 50% 100% / 100% 7px;box-shadow:none;color:var(--pencil,#2b2a27);font-weight:700}
:root[data-style='sketch'] .cp-tabs i{background:var(--red-pencil,#c8553d);font-family:var(--font-answer,inherit)}
:root[data-style='sketch'] .cp-fields{gap:0;padding:0 6px}
:root[data-style='sketch'] .cp-fields label{position:relative;gap:0}
:root[data-style='sketch'] .cp-fields label + label::before{content:':';position:absolute;left:-4px;top:2px;color:var(--pencil-soft,rgb(46 45 42 / .5));font:700 34px/1 Caveat,var(--font)}
:root[data-style='sketch'] .cp-fields input{width:54px;height:44px;border:0;border-bottom:1.5px dashed var(--pencil-soft,rgb(46 45 42 / .45));border-radius:0;background:none;box-shadow:none;color:var(--pencil,#2b2a27);font:700 40px/1 Caveat,var(--font)}
:root[data-style='sketch'] .cp-fields input:hover,:root[data-style='sketch'] .cp-alarm-new input:hover{background:none}
:root[data-style='sketch'] .cp-fields input:focus,:root[data-style='sketch'] .cp-alarm-new input:focus{background:none;box-shadow:none;border-bottom:2px solid var(--red-pencil,#c8553d);color:var(--red-pencil,#c8553d)}
:root[data-style='sketch'] .cp-presets{gap:6px;margin:12px 0 14px!important}
:root[data-style='sketch'] .cp-presets button{padding:1px 0;border:1.3px solid var(--pencil-soft,rgb(46 45 42 / .45));border-radius:52% 48% 55% 45% / 60% 50% 50% 40%;background:none;box-shadow:none;color:var(--pencil,#2b2a27);font-size:13px}
:root[data-style='sketch'] .cp-presets button:nth-child(even){border-radius:46% 54% 44% 56% / 48% 62% 38% 52%}
:root[data-style='sketch'] .cp-presets button.on{border-color:var(--pencil,#2b2a27);background:var(--sticky,#fff2a8)}
:root[data-style='sketch'] .cp-presets button:hover:not(.on){border-color:var(--red-pencil,#c8553d);color:var(--red-pencil,#c8553d)}
:root[data-style='sketch'] .cp-go,:root[data-style='sketch'] .cp-go:hover:not(:disabled){display:flex;width:fit-content;margin:0 auto;padding:3px 30px;border:1.8px solid var(--red-pencil,#c8553d);border-radius:54% 46% 52% 48% / 62% 48% 52% 38%;background:none;background-image:none;box-shadow:none;color:var(--red-pencil,#c8553d);font-size:16px;font-weight:700;filter:url(#sk-pencil-b)}
:root[data-style='sketch'] .cp-go:hover:not(:disabled){background:color-mix(in srgb,var(--sticky,#fff2a8) 80%,transparent);rotate:-1.5deg}
:root[data-style='sketch'] .cp-ok{margin-top:12px}
:root[data-style='sketch'] .cp-controls button{border:1.6px solid var(--pencil,#2b2a27);border-radius:50% 44% 52% 46%;background:none;box-shadow:1.5px 2px 0 rgb(60 50 30 / .16);color:var(--pencil,#2b2a27)}
:root[data-style='sketch'] .cp-controls button:hover{color:var(--red-pencil,#c8553d);border-color:currentColor}
:root[data-style='sketch'] .cp-alarm-new{align-items:center;gap:12px;padding:0 4px}
:root[data-style='sketch'] .cp-alarm-new input{height:40px;border:0;border-bottom:1.5px dashed var(--pencil-soft,rgb(46 45 42 / .45));border-radius:0;background:none;box-shadow:none;color:var(--pencil,#2b2a27);font:700 26px/1 Caveat,var(--font)}
:root[data-style='sketch'] .cp-alarm-new .cp-go,:root[data-style='sketch'] .cp-alarm-new .cp-go:hover:not(:disabled){flex:none;width:36px;height:36px;margin:0;padding:0;border-radius:50% 44% 52% 46%}
:root[data-style='sketch'] .cp-alarm-new input::-webkit-calendar-picker-indicator{display:none}
:root[data-style='sketch'] .cp-alarms li{font-size:15px}
:root[data-style='sketch'] .cp-alarms li:hover{background:none}
:root[data-style='sketch'] .cp-alarms li:hover b{text-decoration:underline wavy var(--pencil-soft,rgb(46 45 42 / .45));text-underline-offset:4px}
:root[data-style='sketch'] .cp-alarms b{font-size:16px}
:root[data-style='sketch'] .cp-alarms li > svg{color:var(--red-pencil,#c8553d)}
@media(prefers-reduced-motion:reduce){.clock-chip.ringing,.cc-bell,.cp-face.shake{animation:none}}
</style>
