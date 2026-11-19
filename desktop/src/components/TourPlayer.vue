<script setup lang="ts">
/* 使用教程：右下角一个小窗，里面只有一段会自己播放的示意动画。每段循环播放，点「看完了」打勾后进下一段。 */
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue'
import AppIcon from './AppIcon.vue'
import TourWorld from '../tour/TourWorld.vue'
import { createDirector } from '../tour/director'
import { LESSONS, freshScene, loadTour, saveTour, type Caption, type Lesson } from '../tour/lessons'

const emit = defineEmits<{ close: [] }>()
const viewport = ref<HTMLElement>(), cursor = ref<HTMLElement>(), ripples = ref<HTMLElement>()
const scene = reactive(freshScene())
const memory = reactive(loadTour())
const caption = ref<Caption>({ text: '' })
const current = shallowRef<Lesson>(LESSONS.find(item => !memory.done.includes(item.id)) || LESSONS[0])
const phase = ref<'play' | 'check' | 'all'>('play'), paused = ref(false), titled = ref(false), cut = ref(false), beat = ref(0)
const large = ref(false), listOpen = ref(false)
let session = 0, alive = true

const director = createDirector({
  viewport: () => viewport.value || null,
  world: () => viewport.value?.querySelector<HTMLElement>('.tw-world') || null,
  cursor: () => cursor.value || null,
  ripples: () => ripples.value || null,
})
const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms))
const number = (lesson: Lesson) => String(LESSONS.indexOf(lesson) + 1).padStart(2, '0')

/* 播放一段；播完淡一下从头再来，直到换段、打勾或关闭。 */
async function start(lesson: Lesson) {
  const mine = ++session
  current.value = lesson; phase.value = 'play'; paused.value = false; listOpen.value = false
  for (let intro = true; alive && mine === session; intro = false) {
    Object.assign(scene, freshScene())
    caption.value = { text: '' }; beat.value = 0; titled.value = intro; cut.value = false
    await nextTick()
    const finished = await director.play(async stage => {
      if (intro) { await stage.wait(1000); titled.value = false; await stage.wait(260) }
      await lesson.play(stage, scene, value => { beat.value++; caption.value = typeof value === 'string' ? { text: value } : value })
      await stage.wait(700)
    })
    if (!finished || mine !== session) return
    cut.value = true
    await sleep(240)
  }
}

async function confirm() {
  if (phase.value !== 'play') return
  const mine = ++session
  director.stop()
  listOpen.value = false
  if (!memory.done.includes(current.value.id)) memory.done.push(current.value.id)
  saveTour(memory)
  phase.value = 'check'
  await sleep(1450)
  if (!alive || mine !== session) return
  const index = LESSONS.indexOf(current.value)
  const next = [...LESSONS.slice(index + 1), ...LESSONS.slice(0, index)].find(item => !memory.done.includes(item.id))
  if (next) void start(next)
  else phase.value = 'all'
}

function restart() { memory.done = []; saveTour(memory); void start(LESSONS[0]) }
function toggleHidden() { memory.hidden = !memory.hidden; saveTour(memory) }
function setPaused(value: boolean) { paused.value = value; director.pause(value || listOpen.value) }
function togglePause() { if (phase.value === 'play' && !listOpen.value) setPaused(!paused.value) }
function toggleList() { listOpen.value = !listOpen.value; director.pause(paused.value || listOpen.value) }
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (listOpen.value) toggleList(); else emit('close') }
  else if (event.key === ' ' && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); togglePause() }
}

let watcher: ResizeObserver | undefined
onMounted(() => {
  watcher = new ResizeObserver(() => director.repaint())
  if (viewport.value) watcher.observe(viewport.value)
  void start(current.value)
})
onBeforeUnmount(() => { alive = false; ++session; watcher?.disconnect(); director.stop() })
</script>

<template>
  <aside class="tour-pip" :class="{ large }" role="dialog" aria-label="使用教程" tabindex="-1" @keydown="keydown">
    <div ref="viewport" class="tour-view" :class="{ paused }" @click="togglePause">
      <div class="tour-film" :class="{ cut }"><TourWorld :scene="scene" /></div>
      <div ref="ripples" class="tour-ripples"></div>
      <svg ref="cursor" class="tour-cursor" width="16" height="22" viewBox="-1 -1 16 22" aria-hidden="true"><path d="M0 0V17L4.6 12.9 7.6 19.6 10.2 18.4 7.3 11.9H13Z" /></svg>

      <Transition name="tour-say" mode="out-in">
        <p v-if="caption.text && phase === 'play' && !titled && !listOpen" :key="caption.text" class="tour-caption" :class="{ top: caption.top }">
          <svg v-if="caption.mouse" class="hint-mouse" viewBox="0 0 14 20" aria-hidden="true"><rect x="1" y="1" width="12" height="18" rx="6" /><line x1="7" y1="4.5" x2="7" y2="8.5" /></svg>
          <kbd v-for="key in caption.keys" :key="key">{{ key }}</kbd>{{ caption.text }}
        </p>
      </Transition>
      <Transition name="tour-title">
        <div v-if="titled && phase === 'play'" :key="current.id" class="tour-title"><i>{{ number(current) }}</i><hr /><b>{{ current.title }}</b><small>{{ current.note }}</small></div>
      </Transition>
      <Transition name="tour-veil">
        <div v-if="phase !== 'play'" class="tour-veil" @click.stop>
          <svg :key="phase + current.id" class="tour-done" viewBox="0 0 80 80" aria-hidden="true"><circle class="halo" cx="40" cy="40" r="30" /><circle class="ring" cx="40" cy="40" r="30" pathLength="1" /><path class="tick" pathLength="1" d="M26.5 41.2 36 50.4 54.2 30.6" /></svg>
          <b>{{ phase === 'all' ? '全部看完' : current.title }}</b>
          <p v-if="phase === 'all'" class="tour-all"><button type="button" @click="restart">从头再看</button><button type="button" class="primary" @click="emit('close')">关闭</button></p>
        </div>
      </Transition>
      <Transition name="tour-veil"><span v-if="paused && !listOpen" class="tour-paused"><AppIcon name="play" :size="20" /></span></Transition>

      <Transition name="tour-veil">
        <nav v-if="listOpen" class="tour-list" aria-label="章节" @click.stop>
          <div class="tour-grid">
            <button v-for="item in LESSONS" :key="item.id" type="button" :class="{ selected: item === current, done: memory.done.includes(item.id) }" @click="start(item)">
              <i><svg v-if="memory.done.includes(item.id)" class="tour-tick" viewBox="0 0 16 16" aria-label="已看完"><path d="M3.5 8.4 6.6 11.4 12.6 4.8" /></svg><template v-else>{{ number(item) }}</template></i>{{ item.title }}
            </button>
          </div>
          <button type="button" class="tour-quiet" :class="{ on: memory.hidden }" role="switch" :aria-checked="memory.hidden" @click="toggleHidden"><i><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.4 6.6 11.4 12.6 4.8" /></svg></i>启动时不再自动弹出</button>
        </nav>
      </Transition>

      <header class="tour-bar" @click.stop>
        <button type="button" class="tour-chip" :aria-expanded="listOpen" data-tip="全部章节" @click="toggleList"><i>{{ number(current) }}</i>{{ current.title }}<small>{{ memory.done.length }}/{{ LESSONS.length }}</small><AppIcon name="down" :size="11" /></button>
        <span v-if="phase === 'play' && !titled" class="tour-beats" aria-hidden="true"><i v-for="index in current.steps" :key="index" :class="{ past: index < beat, now: index === beat }"></i></span>
        <span class="tour-tools">
          <button type="button" class="tour-confirm" :disabled="phase !== 'play'" @click="confirm"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.4 6.6 11.4 12.6 4.8" /></svg>看完了</button>
          <button type="button" class="tour-icon" :aria-label="large ? '缩小' : '放大'" :data-tip="large ? '缩小' : '放大'" @click="large = !large"><AppIcon :name="large ? 'exit-fullscreen' : 'fullscreen'" :size="13" /></button>
          <button type="button" class="tour-icon" aria-label="关闭教程" data-tip="关闭" @click="emit('close')"><AppIcon name="close" :size="14" /></button>
        </span>
      </header>
    </div>
  </aside>
</template>

<style scoped>
/* 右下角的小窗：一圈发丝细的边，里面整块都是画面，控件浮在画面上。 */
.tour-pip{position:fixed;right:18px;bottom:18px;z-index:70;width:min(560px,calc(100vw - 36px));padding:0;border-radius:14px;background:var(--canvas);box-shadow:0 0 0 1px color-mix(in srgb,var(--ink) 20%,transparent),0 30px 70px -24px rgb(0 0 0 / .5),0 10px 24px -14px rgb(0 0 0 / .3);outline:0;transition:width .38s var(--ease-out)}
.tour-pip.large{width:min(900px,calc(100vw - 36px))}
.tour-view{position:relative;width:100%;aspect-ratio:16/10;max-height:calc(100vh - 36px);overflow:hidden;border-radius:inherit;background:var(--canvas);cursor:pointer;contain:strict}
.tour-film{position:absolute;inset:0;transition:opacity .22s var(--ease-soft)}
.tour-film.cut{opacity:0}
.tour-ripples{position:absolute;inset:0;pointer-events:none}
.tour-ripples :deep(.tour-ripple){position:absolute;width:40px;height:40px;margin:-20px 0 0 -20px;border-radius:50%;border:1.5px solid color-mix(in srgb,var(--ink) 55%,transparent);animation:tour-ripple .5s var(--ease-out) both}
.tour-ripples :deep(.tour-ripple.middle){border-color:var(--accent);box-shadow:0 0 0 6px color-mix(in srgb,var(--accent) 16%,transparent)}
@keyframes tour-ripple{from{opacity:.9;scale:.2}to{opacity:0;scale:1.15}}
.tour-cursor{position:absolute;left:0;top:0;overflow:visible;transform-origin:0 0;will-change:transform;opacity:0;pointer-events:none;filter:drop-shadow(0 2px 3px rgb(0 0 0 / .32));transition:opacity .25s var(--ease-out)}
.tour-cursor path{fill:#fff;stroke:#16181d;stroke-width:1.1;stroke-linejoin:round}

/* 顶上一排浮着的小控件。 */
.tour-bar{position:absolute;left:8px;right:8px;top:8px;display:flex;align-items:center;gap:8px;cursor:default;pointer-events:none}
.tour-bar>*{pointer-events:auto}
.tour-bar button{min-height:0;border:0;box-shadow:0 0 0 1px color-mix(in srgb,var(--ink) 12%,transparent),0 6px 16px -10px rgb(0 0 0 / .5);background:color-mix(in srgb,var(--surface) 90%,transparent);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);color:var(--surface-ink,var(--ink));font-size:12px;font-weight:600;transition:background-color .15s,translate .15s var(--ease-out),opacity .2s}
.tour-bar button:hover:not(:disabled){background:var(--surface);color:var(--surface-ink,var(--ink))}
.tour-chip{height:26px;padding:0 8px 0 9px;gap:6px;border-radius:999px}
.tour-chip i{color:var(--accent);font:600 11px/1 var(--font-display);font-style:normal;font-variant-numeric:tabular-nums}
.tour-chip small{color:var(--muted);font-size:10.5px;font-weight:500;font-variant-numeric:tabular-nums}
.tour-beats{display:flex;gap:4px;padding:5px 7px;border-radius:999px;background:color-mix(in srgb,var(--surface) 80%,transparent)}
.tour-beats i{width:4px;height:4px;border-radius:2px;background:color-mix(in srgb,var(--ink) 22%,transparent);transition:width .35s var(--ease-spring),background-color .25s}
.tour-beats i.past{background:color-mix(in srgb,var(--ink) 55%,transparent)}
.tour-beats i.now{width:16px;background:var(--accent)}
.tour-tools{display:flex;align-items:center;gap:6px;margin-left:auto}
.tour-icon{display:grid;place-items:center;width:26px;height:26px;padding:0;border-radius:50%}
.tour-bar .tour-confirm{height:26px;padding:0 11px 0 8px;gap:5px;border-radius:999px;background:var(--ink);color:var(--surface)}
.tour-bar .tour-confirm:hover:not(:disabled){background:var(--ink);color:var(--surface);translate:0 -1px}
.tour-confirm:disabled{opacity:.3}
.tour-confirm svg,.tour-quiet svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}

.tour-caption{position:absolute;left:50%;bottom:12px;display:flex;align-items:center;gap:7px;max-width:calc(100% - 24px);margin:0;padding:6px 13px;border-radius:999px;background:color-mix(in srgb,var(--surface) 95%,transparent);box-shadow:0 0 0 1px color-mix(in srgb,var(--ink) 14%,transparent),0 12px 28px -12px rgb(0 0 0 / .45);color:var(--surface-ink,var(--ink));font-size:12.5px;font-weight:600;white-space:nowrap;translate:-50% 0;pointer-events:none}
.large .tour-caption{bottom:18px;padding:8px 16px;font-size:13.5px}
.tour-caption.top{top:44px;bottom:auto}
.tour-caption kbd{display:inline-grid;place-items:center;height:19px;padding:0 6px;border:1px solid color-mix(in srgb,var(--ink) 18%,transparent);border-radius:6px;background:color-mix(in srgb,var(--ink) 5%,transparent);font:600 11px/1 var(--font,inherit)}
.tour-caption .hint-mouse{width:11px;height:16px}
.tour-say-enter-active{transition:opacity .2s var(--ease-out),translate .3s var(--ease-spring)}
.tour-say-leave-active{transition:opacity .1s var(--ease-soft)}
.tour-say-enter-from{opacity:0;translate:-50% 10px}
.tour-say-leave-to{opacity:0}

/* 片头：大号编号、一根细线、标题。 */
.tour-title{position:absolute;inset:0;display:grid;align-content:center;justify-items:center;gap:5px;background:color-mix(in srgb,var(--canvas) 92%,transparent);pointer-events:none}
.tour-title i{font:200 60px/1 var(--font-display);font-style:normal;font-variant-numeric:tabular-nums;letter-spacing:.02em;color:var(--ink);animation:tour-rise .55s var(--ease-out) both}
.tour-title hr{width:44px;height:1px;margin:8px 0 10px;border:0;background:var(--accent);animation:tour-line .5s var(--ease-out) .12s both}
.tour-title b{font:600 19px/1.2 var(--font-display);letter-spacing:.04em;animation:tour-rise .5s var(--ease-out) .16s both}
.tour-title small{color:var(--muted);font-size:12px;animation:tour-rise .5s var(--ease-out) .24s both}
@keyframes tour-rise{from{opacity:0;translate:0 12px}}
@keyframes tour-line{from{scale:0 1}}
.tour-title-leave-active{transition:opacity .3s var(--ease-soft),scale .34s var(--ease-soft)}
.tour-title-leave-to{opacity:0;scale:1.06}

/* 打勾：圆描一圈，勾划出来，整体轻轻弹一下，外面散开一圈。 */
.tour-veil{position:absolute;inset:0;display:grid;align-content:center;justify-items:center;gap:12px;background:color-mix(in srgb,var(--canvas) 88%,transparent);cursor:default}
.tour-veil>b{font:600 16px/1.2 var(--font-display);letter-spacing:.06em;animation:tour-rise .4s var(--ease-out) .62s both}
.tour-done{width:72px;height:72px;overflow:visible;animation:tour-pop .5s var(--ease-spring) .66s both}
.tour-done :is(circle,path){fill:none;stroke:var(--accent);stroke-linecap:round;stroke-linejoin:round}
.tour-done .ring{stroke-width:2;stroke-dasharray:1;rotate:-90deg;transform-origin:50% 50%;animation:tour-trace .5s cubic-bezier(.65,0,.35,1) both}
.tour-done .tick{stroke-width:2.6;stroke-dasharray:1;animation:tour-trace .3s cubic-bezier(.65,0,.35,1) .44s both}
.tour-done .halo{stroke-width:1.2;transform-origin:50% 50%;animation:tour-halo .7s var(--ease-out) .7s both}
@keyframes tour-trace{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
@keyframes tour-pop{40%{scale:1.1}}
@keyframes tour-halo{from{opacity:.5;scale:1}to{opacity:0;scale:1.5}}
.tour-all{display:flex;gap:8px;margin:6px 0 0;animation:tour-rise .4s var(--ease-out) .9s both}
.tour-all button{height:32px;padding:0 16px;border:0;border-radius:999px;background:var(--surface);box-shadow:0 0 0 1px color-mix(in srgb,var(--ink) 14%,transparent);color:var(--surface-ink,var(--ink));font-size:12.5px;font-weight:600}
.tour-all button.primary{background:var(--ink);color:var(--surface)}
.tour-paused{position:absolute;left:50%;top:50%;display:grid;place-items:center;width:48px;height:48px;margin:-24px 0 0 -24px;border-radius:50%;background:color-mix(in srgb,var(--ink) 72%,transparent);color:var(--surface);pointer-events:none}
.tour-veil-enter-active,.tour-veil-leave-active{transition:opacity .24s var(--ease-out)}
.tour-veil-enter-from,.tour-veil-leave-to{opacity:0}

/* 章节：盖在画面上的一张表。 */
.tour-list{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;gap:10px;padding:44px 16px 12px;background:color-mix(in srgb,var(--canvas) 94%,transparent);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);cursor:default}
.tour-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px}
.tour-list button{justify-content:flex-start;min-height:0;border:0;background:none;box-shadow:none;color:var(--surface-ink,var(--ink))}
.tour-grid button{height:34px;padding:0 10px;gap:9px;border-radius:9px;font-size:12.5px;font-weight:600;transition:background-color .15s}
.tour-grid button:hover{background:color-mix(in srgb,var(--ink) 7%,transparent)}
.tour-grid button.selected{background:color-mix(in srgb,var(--ink) 9%,transparent)}
.tour-grid i{flex:none;display:grid;place-items:center;width:16px;color:var(--muted);font:500 10.5px/1 var(--font-display);font-style:normal;font-variant-numeric:tabular-nums}
.tour-grid button.selected i{color:var(--accent)}
.tour-grid button.done:not(.selected){color:var(--muted)}
.tour-tick{width:15px;height:15px;fill:none;stroke:var(--accent);stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.tour-quiet{align-self:flex-start;height:28px;padding:0 10px;gap:8px;color:var(--muted)!important;font-size:12px}
.tour-quiet i{display:grid;place-items:center;width:15px;height:15px;border:1px solid color-mix(in srgb,var(--ink) 38%,transparent);border-radius:4px;transition:background-color .2s,border-color .2s}
.tour-quiet svg{width:11px;height:11px;color:var(--surface);opacity:0;transition:opacity .15s}
.tour-quiet.on{color:var(--ink)!important}
.tour-quiet.on i{border-color:var(--accent);background:var(--accent)}
.tour-quiet.on svg{opacity:1}

/* 出入：从右下角浮上来。 */
.tour-pip.tour-pip-enter-active{transition:opacity .28s var(--ease-out),translate .5s var(--ease-spring),scale .5s var(--ease-spring)}
.tour-pip.tour-pip-leave-active{transition:opacity .18s var(--ease-soft),translate .2s var(--ease-soft)}
.tour-pip.tour-pip-enter-from{opacity:0;translate:0 26px;scale:.94}
.tour-pip.tour-pip-leave-to{opacity:0;translate:0 14px}
.tour-pip{transform-origin:100% 100%}
:root[data-style='sketch'] .tour-pip{box-shadow:0 0 0 1.5px var(--pencil,#2e2d2a),4px 6px 0 color-mix(in srgb,var(--pencil,#2e2d2a) 18%,transparent)}
</style>
