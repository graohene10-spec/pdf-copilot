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
watch(open, value => { if (value) { locate(); sweep.value = (Date.now() % 60000) / 1000; fields.h = clock.last.h; fields.m = clock.last.m; fields.s = clock.last.s; Object.assign(alarm, nextHalfHour()) } })
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
const fields = reactive<Record<string, number>>({ h: clock.last.h, m: clock.last.m, s: clock.last.s })
// 每一格是一个自己画的数字：点上下箭头（按住连续变）、滚轮、方向键或直接敲数字都能改，没有文本框的光标和选区。
type Spin = { key: string; label: string; max: number; model: Record<string, number> }
const timerSpins: Spin[] = [{ key: 'h', label: '时', max: 99, model: fields }, { key: 'm', label: '分', max: 59, model: fields }, { key: 's', label: '秒', max: 59, model: fields }]
function bump(spin: Spin, by: number) { const size = spin.max + 1; spin.model[spin.key] = (spin.model[spin.key]! + by + size) % size }
// 刚点进一格时敲的第一个数字从头写；接着敲的往后补一位。
let fresh = true
function keySpin(spin: Spin, event: KeyboardEvent, enter: () => void) {
  const value = spin.model[spin.key]!
  if (/^\d$/.test(event.key)) { const digit = Number(event.key), next = fresh ? digit : (value % 10) * 10 + digit; spin.model[spin.key] = next > spin.max ? digit : next; fresh = false }
  else if (event.key === 'ArrowUp') bump(spin, 1)
  else if (event.key === 'ArrowDown') bump(spin, -1)
  else if (event.key === 'Backspace' || event.key === 'Delete') { spin.model[spin.key] = event.key === 'Delete' ? 0 : Math.floor(value / 10); fresh = false }
  else if (event.key === 'Enter') enter()
  else return
  event.preventDefault()
}
let holding: ReturnType<typeof setTimeout> | undefined
function release() { clearTimeout(holding); clearInterval(holding); holding = undefined }
function hold(spin: Spin, by: number, event: PointerEvent) {
  if (event.button !== 0) return
  release(); bump(spin, by)
  holding = setTimeout(() => { holding = setInterval(() => bump(spin, by), 80) }, 380)
  window.addEventListener('pointerup', release, { once: true }); window.addEventListener('pointercancel', release, { once: true })
}
onBeforeUnmount(release)
const PRESETS = [5, 15, 25, 60]
function preset(minutes: number) { fields.h = Math.floor(minutes / 60); fields.m = minutes % 60; fields.s = 0 }
const total = computed(() => ((fields.h! * 60 + fields.m!) * 60 + fields.s!) * 1000)
function start() {
  rememberFields(fields.h!, fields.m!, fields.s!)
  if (total.value) startCountdown(total.value); else startStopwatch()
  open.value = false
}
const left = computed(() => remaining()), gone = computed(() => elapsed())
const running = computed(() => clock.mode !== 'idle')
const reading = computed(() => clock.mode === 'down' ? span(left.value) : span(gone.value, true))
// 倒计时的圆环：走过的部分一点点擦掉。正计时没有终点，圆环每分钟转一圈。
const share = computed(() => clock.mode === 'down' ? (clock.total ? left.value / clock.total : 0) : (gone.value % 60000) / 60000)

// ---- 闹钟 ----------------------------------------------------------------------
function nextHalfHour() { const date = new Date(Date.now() + 30 * 60000); date.setMinutes(date.getMinutes() < 30 ? 30 : 60, 0, 0); return { h: date.getHours(), m: date.getMinutes() } }
const alarm = reactive<Record<string, number>>(nextHalfHour())
const alarmSpins: Spin[] = [{ key: 'h', label: '时', max: 23, model: alarm }, { key: 'm', label: '分', max: 59, model: alarm }]
function setAlarm() { addAlarm(alarm.h!, alarm.m!) }
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
const QUARTERS = 'M50.00 26.80L50.00 21.40 M77.20 54.00L82.60 54.00 M50.00 81.20L50.00 86.60 M22.80 54.00L17.40 54.00'
const HOURS = 'M64.90 28.19L66.30 25.77 M75.81 39.10L78.23 37.70 M75.81 68.90L78.23 70.30 M64.90 79.81L66.30 82.23 M35.10 79.81L33.70 82.23 M24.19 68.90L21.77 70.30 M24.19 39.10L21.77 37.70 M35.10 28.19L33.70 25.77'
// 秒针一分钟扫一圈；打开卡片时按现在的秒数对好位置。
const sweep = ref(0)
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
            <!-- 怀表式的表冠和提环 -->
            <circle class="cp-bow" cx="50" cy="7.6" r="3.5" /><path class="cp-crown" d="M47.4 11.4h5.2v3.4h-5.2z" />
            <circle class="cp-rim" cx="50" cy="54" r="38" /><circle class="cp-rim inner" cx="50" cy="54" r="35.4" />
            <path class="cp-ticks" :d="HOURS" /><path class="cp-ticks quarter" :d="QUARTERS" />
            <circle v-if="running && !clock.ringing" class="cp-arc" cx="50" cy="54" r="38" pathLength="1" :stroke-dasharray="`${share} 1`" transform="rotate(-90 50 54)" />
            <path class="cp-hand" d="M50 57.5 48.9 44 50 33.5 51.1 44z" :transform="`rotate(${hands.hour} 50 54)`" />
            <path class="cp-hand" d="M50 58.5 49.15 38 50 23 50.85 38z" :transform="`rotate(${hands.minute} 50 54)`" />
            <g class="cp-second" :style="{ animationDelay: `-${sweep}s` }"><path d="M50 62.5V22.5" /><circle cx="50" cy="62.5" r="1.3" /></g>
            <circle class="cp-hub" cx="50" cy="54" r="1.5" />
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
                <div v-for="spin in timerSpins" :key="spin.key" class="cp-field">
                  <button type="button" class="cp-step up" tabindex="-1" :aria-label="`${spin.label}加一`" @pointerdown.prevent="hold(spin, 1, $event)"><AppIcon name="down" :size="12" /></button>
                  <span class="cp-num" tabindex="0" role="spinbutton" :aria-label="spin.label" :aria-valuenow="spin.model[spin.key]" aria-valuemin="0" :aria-valuemax="spin.max" @focus="fresh = true" @keydown="keySpin(spin, $event, start)" @wheel.prevent="bump(spin, $event.deltaY < 0 ? 1 : -1)">{{ String(spin.model[spin.key]).padStart(2, '0') }}</span>
                  <button type="button" class="cp-step" tabindex="-1" :aria-label="`${spin.label}减一`" @pointerdown.prevent="hold(spin, -1, $event)"><AppIcon name="down" :size="12" /></button>
                  <small>{{ spin.label }}</small>
                </div>
              </div>
              <p class="cp-presets"><button v-for="minutes in PRESETS" :key="minutes" type="button" :class="{ on: total === minutes * 60000 }" @click="preset(minutes)">{{ minutes < 60 ? `${minutes} 分` : `${minutes / 60} 小时` }}</button></p>
              <button type="button" class="cp-go" :aria-label="total ? '开始倒计时' : '开始正计时'" :data-tip="total ? '开始倒计时' : '没填时间：正计时'" @click="start"><AppIcon name="play" :size="14" />{{ total ? '开始' : '正计时' }}</button>
            </template>
          </template>
          <!-- 闹钟 -->
          <template v-else>
            <div class="cp-alarm-new">
              <div class="cp-fields two">
                <div v-for="spin in alarmSpins" :key="spin.key" class="cp-field">
                  <button type="button" class="cp-step up" tabindex="-1" :aria-label="`${spin.label}加一`" @pointerdown.prevent="hold(spin, 1, $event)"><AppIcon name="down" :size="12" /></button>
                  <span class="cp-num" tabindex="0" role="spinbutton" :aria-label="spin.label" :aria-valuenow="spin.model[spin.key]" aria-valuemin="0" :aria-valuemax="spin.max" @focus="fresh = true" @keydown="keySpin(spin, $event, setAlarm)" @wheel.prevent="bump(spin, $event.deltaY < 0 ? 1 : -1)">{{ String(spin.model[spin.key]).padStart(2, '0') }}</span>
                  <button type="button" class="cp-step" tabindex="-1" :aria-label="`${spin.label}减一`" @pointerdown.prevent="hold(spin, -1, $event)"><AppIcon name="down" :size="12" /></button>
                  <small>{{ spin.label }}</small>
                </div>
              </div>
              <button type="button" class="cp-go" aria-label="定闹钟" data-tip="定闹钟" @click="setAlarm"><AppIcon name="plus" :size="15" /></button>
            </div>
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
.cp-face{flex:none;width:84px;height:84px;overflow:visible;fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round}
.cp-bow{stroke-width:.9}
.cp-crown{stroke-width:.9;stroke-linejoin:miter}
.cp-rim{stroke-width:1.1}
.cp-rim.inner{stroke-width:.45;opacity:.45}
.cp-ticks{stroke-width:.55;opacity:.7}
.cp-ticks.quarter{stroke-width:.95;opacity:1}
.cp-arc{stroke:var(--accent);stroke-width:2;transition:stroke-dasharray .3s linear}
.cp-hand{fill:currentColor;stroke:none}
.cp-second{stroke:var(--accent);stroke-width:.55;transform-origin:50px 54px;animation:cp-sweep 60s linear infinite}
.cp-second circle{fill:var(--accent);stroke:none}
.cp-hub{fill:var(--popup-glass,#fff);stroke:var(--accent);stroke-width:.8}
@keyframes cp-sweep{to{transform:rotate(360deg)}}
.cp-face.shake{transform-origin:50% 8%;animation:cp-shake .9s ease-in-out infinite}
@keyframes cp-shake{0%,100%{rotate:0deg}25%{rotate:-5deg}75%{rotate:5deg}}
.cp-read{display:flex;flex-direction:column;min-width:0}
.cp-read small{color:var(--muted);font-size:11px;line-height:1.3;letter-spacing:.14em}
.cp-read b{font-size:34px;font-weight:250;line-height:1.1;letter-spacing:-.01em;white-space:nowrap}
.cp-read span{min-height:1.3em;color:var(--muted);font-size:11.5px;line-height:1.3}
.cp-tabs{display:grid;grid-template-columns:1fr 1fr;gap:2px;margin:13px 0 12px;padding:2px;border-radius:10px;background:color-mix(in srgb,var(--ink) 7%,transparent)}
.cp-tabs button{gap:5px;padding:4px 0;border:0;border-radius:8px;background:none;box-shadow:none;color:var(--muted);font-size:12.5px}
.cp-tabs button:hover:not(.on){background:none;color:var(--ink)}
.cp-tabs button.on,.cp-tabs button.on:hover{background:color-mix(in srgb,var(--surface,#fff) 82%,transparent);box-shadow:0 1px 3px rgb(0 0 0 / .14);color:var(--ink);font-weight:600}
.cp-tabs i{min-width:15px;padding:0 4px;border-radius:999px;background:var(--accent);color:#fff;font-size:10px;font-style:normal;line-height:15px}
.cp-fields{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.cp-fields.two{flex:1;grid-template-columns:repeat(2,1fr)}
.cp-field{position:relative;display:flex;flex-direction:column;align-items:center;color:var(--muted)}
.cp-field small{margin-top:1px;font-size:11px}
.cp-num{display:grid;place-items:center;width:100%;height:44px;border-radius:12px;background:var(--fill-3);color:var(--ink);font-size:25px;font-weight:350;cursor:ns-resize;outline:none!important;user-select:none;-webkit-user-select:none;transition:background-color .15s,box-shadow .15s,color .15s,border-color .15s}
.cp-num:hover{background:var(--fill-2)}
.cp-num:focus{background:var(--fill-4);box-shadow:0 0 0 1.5px color-mix(in srgb,var(--accent) 60%,transparent);color:var(--accent)}
.clock-panel .cp-step{width:100%;height:15px;padding:0;border:0;border-radius:6px;background:none;box-shadow:none;color:var(--muted);opacity:.45}
.cp-step.up svg{rotate:180deg}
.clock-panel .cp-step:hover{background:none;color:var(--accent);opacity:1}
.clock-panel .cp-step:active{scale:.8}
.cp-alarm-new{display:flex;align-items:center;gap:10px}
.cp-alarm-new .cp-go{flex:none;width:38px;height:38px;margin-bottom:14px;padding:0}
.cp-presets{display:flex;gap:4px;margin:10px 0 12px!important}
.cp-presets button{flex:1;padding:3px 0;border-radius:999px;background:none;box-shadow:none;color:var(--secondary,var(--muted));font-size:11.5px;white-space:nowrap}
.cp-presets button.on{border-color:color-mix(in srgb,var(--accent) 55%,transparent);color:var(--accent)}
.cp-go{width:100%;gap:6px;padding:7px 0;border:0;border-radius:11px;background:var(--accent);background-image:linear-gradient(180deg,rgb(255 255 255 / .16),transparent);box-shadow:0 6px 14px -8px var(--accent);color:#fff;font-size:13px;font-weight:600}
.cp-go:hover:not(:disabled){background-color:color-mix(in srgb,var(--accent) 88%,#000);color:#fff}
.cp-go:active{scale:.97}
.cp-ok{margin-top:14px}
.cp-controls{display:flex;justify-content:center;gap:12px;padding:2px 0 2px}
.cp-controls button{width:40px;height:40px;padding:0;border-radius:50%}
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
:root[data-style='warm'] .cp-read b{font-weight:300}
:root[data-style='warm'] .cp-hub{fill:var(--surface)}
:root[data-style='warm'] .cp-read span{font-style:italic}
:root[data-style='warm'] .cp-tabs{gap:18px;display:flex;padding:0;border-radius:0;background:none;border-bottom:.5px solid var(--warm-rule,rgb(31 30 29 / .14))}
:root[data-style='warm'] .cp-tabs button{padding:0 0 6px;border-radius:0;margin-bottom:-.5px;border-bottom:1.5px solid transparent}
:root[data-style='warm'] .cp-tabs button.on,:root[data-style='warm'] .cp-tabs button.on:hover{background:none;box-shadow:none;border-bottom-color:var(--accent);color:var(--accent)}
:root[data-style='warm'] .cp-num{border-bottom:.5px solid var(--warm-rule,rgb(31 30 29 / .3));border-radius:0;background:none}
:root[data-style='warm'] .cp-num:focus{box-shadow:none;border-bottom-color:var(--accent)}
:root[data-style='warm'] .cp-presets button{border:0;border-radius:0;font-style:italic}
:root[data-style='warm'] .cp-presets button:hover{background:none;color:var(--accent)}
:root[data-style='warm'] .cp-presets button.on{text-decoration:underline;text-underline-offset:3px}
:root[data-style='warm'] .cp-go{border-radius:6px;background-image:none;box-shadow:none}
:root[data-style='warm'] .cp-controls button{border:.5px solid var(--warm-rule,rgb(31 30 29 / .25));background:none;box-shadow:none}
:root[data-style='warm'] .cp-controls button:hover{color:var(--accent);border-color:var(--accent)}

/* ---- 铅笔草稿：一页白纸、细铅笔线；钟是细线画的，只有秒针和要紧处用红铅笔 ---- */
:root[data-style='sketch'] .topbar-actions .icon-button.clock-chip,:root[data-style='sketch'] .topbar-actions .icon-button.clock-chip:hover:not(:disabled){width:auto;padding:0 11px;border-radius:15px 19px 16px 18px / 18px 15px 19px 16px}
:root[data-style='sketch'] .clock-chip.running{color:var(--red-pencil,#c0392b)}
:root[data-style='sketch'] .clock-panel{--scribble:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='8' viewBox='0 0 48 8' preserveAspectRatio='none'%3E%3Cpath d='M2 5.4c7-3.2 12 1.6 20-.6s14-2.6 24-.4' fill='none' stroke='%23c8553d' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E");width:262px;padding:18px 20px 18px;border:1.2px solid var(--pencil,#2b2a27);border-radius:10px 13px 9px 12px / 12px 9px 13px 10px;background:var(--paper,#fbf8f0);-webkit-backdrop-filter:none;backdrop-filter:none;box-shadow:2px 3px 0 rgb(60 50 30 / .14),10px 18px 30px -16px rgb(60 50 30 / .4);color:var(--pencil,#2b2a27)}
:root[data-style='sketch'] .cp-second{stroke:var(--red-pencil,#c8553d)}
:root[data-style='sketch'] .cp-second circle{fill:var(--red-pencil,#c8553d)}
:root[data-style='sketch'] .cp-arc{stroke:var(--red-pencil,#c8553d)}
:root[data-style='sketch'] .cp-hub{fill:var(--paper,#fbf8f0);stroke:var(--red-pencil,#c8553d)}
:root[data-style='sketch'] .cp-read small,:root[data-style='sketch'] .cp-read span,:root[data-style='sketch'] .cp-field small{color:var(--pencil-soft,rgb(46 45 42 / .62));font-size:13px;letter-spacing:.04em}
:root[data-style='sketch'] .cp-read b{font-family:Caveat,var(--font);font-size:44px;font-weight:500;line-height:1;letter-spacing:.01em}
:root[data-style='sketch'] .cp-tabs{display:flex;gap:18px;margin:14px 0 12px;padding:10px 0 0;border-radius:0;background:none;border-top:1px solid color-mix(in srgb,var(--pencil,#2b2a27) 22%,transparent)}
:root[data-style='sketch'] .cp-tabs button{padding:0 1px 6px;border:0;border-radius:0;color:var(--pencil-soft,rgb(46 45 42 / .62));font-size:15px;background:none}
:root[data-style='sketch'] .cp-tabs button.on,:root[data-style='sketch'] .cp-tabs button.on:hover{background:var(--scribble) no-repeat 50% 100% / 100% 6px;box-shadow:none;color:var(--pencil,#2b2a27);font-weight:600}
:root[data-style='sketch'] .cp-tabs i{background:var(--red-pencil,#c8553d);font-family:var(--font-answer,inherit)}
:root[data-style='sketch'] .cp-fields{gap:0;padding:0 8px}
:root[data-style='sketch'] .cp-field + .cp-field::before{content:':';position:absolute;left:-3px;top:19px;color:var(--pencil-soft,rgb(46 45 42 / .45));font:500 30px/1 Caveat,var(--font)}
:root[data-style='sketch'] .cp-num{width:52px;height:40px;border-bottom:1px solid color-mix(in srgb,var(--pencil,#2b2a27) 35%,transparent);border-radius:0;background:none;color:var(--pencil,#2b2a27);font:500 36px/1 Caveat,var(--font)}
:root[data-style='sketch'] .cp-num:hover{border-bottom-color:var(--pencil,#2b2a27)}
:root[data-style='sketch'] .cp-num:focus{background:none;box-shadow:none;border-bottom-color:var(--red-pencil,#c8553d);color:var(--red-pencil,#c8553d)}
:root[data-style='sketch'] .clock-panel .cp-step{color:var(--pencil-soft,rgb(46 45 42 / .62))}
:root[data-style='sketch'] .clock-panel .cp-step:hover{color:var(--red-pencil,#c8553d)}
:root[data-style='sketch'] .cp-alarm-new{gap:14px;padding-right:6px}
:root[data-style='sketch'] .cp-alarm-new .cp-go,:root[data-style='sketch'] .cp-alarm-new .cp-go:hover:not(:disabled){flex:none;width:36px;height:36px;padding:0;border-radius:50%;letter-spacing:0}
:root[data-style='sketch'] .cp-presets{gap:6px;margin:13px 0 15px!important}
:root[data-style='sketch'] .cp-presets button{padding:1px 0;border:1px solid color-mix(in srgb,var(--pencil,#2b2a27) 35%,transparent);border-radius:999px;background:none;box-shadow:none;color:var(--pencil-soft,rgb(46 45 42 / .7));font-size:13px}
:root[data-style='sketch'] .cp-presets button.on{border-color:var(--pencil,#2b2a27);background-image:repeating-linear-gradient(-35deg,color-mix(in srgb,var(--pencil,#2b2a27) 16%,transparent) 0 1.2px,transparent 1.2px 6px);color:var(--pencil,#2b2a27)}
:root[data-style='sketch'] .cp-presets button:hover:not(.on){border-color:var(--pencil,#2b2a27);color:var(--pencil,#2b2a27)}
/* 主操作和应用里别处一样：铅笔涂黑的一块。 */
:root[data-style='sketch'] .cp-go,:root[data-style='sketch'] .cp-go:hover:not(:disabled){border:1.2px solid var(--pencil,#2b2a27);border-radius:var(--r-control,12px);background:var(--pencil,#2b2a27);background-image:none;box-shadow:2px 3px 0 rgb(46 45 42 / .25);color:var(--paper,#fbf8f0);font-size:15px;font-weight:600;letter-spacing:.2em}
:root[data-style='sketch'] .cp-go:hover:not(:disabled){box-shadow:3px 4px 0 rgb(46 45 42 / .3)}
:root[data-style='sketch'] .cp-controls button{border:1.2px solid var(--pencil,#2b2a27);border-radius:50%;background:none;box-shadow:1.5px 2px 0 rgb(60 50 30 / .14);color:var(--pencil,#2b2a27)}
:root[data-style='sketch'] .cp-controls button:hover{color:var(--red-pencil,#c8553d);border-color:currentColor}
:root[data-style='sketch'] .cp-alarms li:hover{background:none}
:root[data-style='sketch'] .cp-alarms b{font-size:16px;font-weight:500}
:root[data-style='sketch'] .cp-alarms li > svg{color:var(--red-pencil,#c8553d)}
@media(prefers-reduced-motion:reduce){.clock-chip.ringing,.cc-bell,.cp-face.shake{animation:none}.cp-second{display:none}}
</style>
