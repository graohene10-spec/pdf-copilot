<script setup lang="ts">
/* 使用教程：左边是章节，右边是一段会自己播放的示意动画。每段循环播放，点「看完了」打勾后进下一段。 */
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue'
import AppIcon from './AppIcon.vue'
import TourWorld from '../tour/TourWorld.vue'
import { createDirector } from '../tour/director'
import { LESSONS, freshScene, loadTour, saveTour, type Caption, type Lesson } from '../tour/lessons'

const emit = defineEmits<{ close: [] }>()
const viewport = ref<HTMLElement>(), cursor = ref<HTMLElement>(), ripples = ref<HTMLElement>(), dialog = ref<HTMLElement>()
const scene = reactive(freshScene())
const memory = reactive(loadTour())
const caption = ref<Caption>({ text: '' })
const current = shallowRef<Lesson>(LESSONS.find(item => !memory.done.includes(item.id)) || LESSONS[0])
const phase = ref<'play' | 'check' | 'all'>('play'), paused = ref(false), titled = ref(false), cut = ref(false), beat = ref(0)
let session = 0, alive = true

const director = createDirector({
  viewport: () => viewport.value || null,
  world: () => viewport.value?.querySelector<HTMLElement>('.tw-world') || null,
  cursor: () => cursor.value || null,
  ripples: () => ripples.value || null,
})
const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms))

/* 播放一段；播完淡一下从头再来，直到换段、打勾或关闭。 */
async function start(lesson: Lesson) {
  const mine = ++session
  current.value = lesson; phase.value = 'play'; paused.value = false
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
function togglePause() {
  if (phase.value !== 'play') return
  paused.value = !paused.value
  director.pause(paused.value)
}

function keydown(event: KeyboardEvent) {
  event.stopPropagation()
  if (event.key === 'Escape') { event.preventDefault(); emit('close') }
  else if (event.key === ' ' && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); togglePause() }
}

let watcher: ResizeObserver | undefined
onMounted(() => {
  document.addEventListener('keydown', keydown, true)
  watcher = new ResizeObserver(() => director.repaint())
  if (viewport.value) watcher.observe(viewport.value)
  dialog.value?.focus()
  void start(current.value)
})
onBeforeUnmount(() => { alive = false; ++session; document.removeEventListener('keydown', keydown, true); watcher?.disconnect(); director.stop() })
</script>

<template>
  <div class="settings-backdrop tour-backdrop" @click.self="emit('close')">
    <section ref="dialog" class="settings-dialog tour-dialog" data-glass-interactive="panel" role="dialog" aria-modal="true" aria-labelledby="tour-title" tabindex="-1">
      <header class="tour-header"><h2 id="tour-title">使用教程</h2><span class="tour-progress">{{ memory.done.length }} / {{ LESSONS.length }}</span><button type="button" class="tour-close" aria-label="关闭教程" @click="emit('close')"><AppIcon name="close" :size="18" /></button></header>
      <div class="tour-body">
        <nav class="tour-list" aria-label="章节">
          <button v-for="(item, index) in LESSONS" :key="item.id" type="button" :class="{ selected: item === current && phase !== 'all', done: memory.done.includes(item.id) }" :aria-current="item === current ? 'true' : undefined" @click="start(item)">
            <i><svg v-if="memory.done.includes(item.id)" class="tour-tick" viewBox="0 0 16 16" aria-label="已看完"><path d="M3.5 8.4 6.6 11.4 12.6 4.8" /></svg><template v-else>{{ String(index + 1).padStart(2, '0') }}</template></i><span><b>{{ item.title }}</b><small>{{ item.note }}</small></span>
          </button>
        </nav>
        <div class="tour-stage">
          <div ref="viewport" class="tour-view" :class="{ paused }" @click="togglePause">
            <div class="tour-film" :class="{ cut }"><TourWorld :scene="scene" /></div>
            <div ref="ripples" class="tour-ripples"></div>
            <svg ref="cursor" class="tour-cursor" width="16" height="22" viewBox="-1 -1 16 22" aria-hidden="true"><path d="M0 0V17L4.6 12.9 7.6 19.6 10.2 18.4 7.3 11.9H13Z" /></svg>
            <div v-if="phase === 'play' && !titled" class="tour-beats" aria-hidden="true"><i v-for="index in current.steps" :key="index" :class="{ past: index < beat, now: index === beat }"></i></div>
            <Transition name="tour-say" mode="out-in">
              <p v-if="caption.text && phase === 'play' && !titled" :key="caption.text" class="tour-caption" :class="{ top: caption.top }">
                <svg v-if="caption.mouse" class="hint-mouse" viewBox="0 0 14 20" aria-hidden="true"><rect x="1" y="1" width="12" height="18" rx="6" /><line x1="7" y1="4.5" x2="7" y2="8.5" /></svg>
                <kbd v-for="key in caption.keys" :key="key">{{ key }}</kbd>{{ caption.text }}
              </p>
            </Transition>
            <Transition name="tour-title">
              <div v-if="titled && phase === 'play'" :key="current.id" class="tour-title">
                <i>{{ String(LESSONS.indexOf(current) + 1).padStart(2, '0') }}</i><hr /><b>{{ current.title }}</b><small>{{ current.note }}</small>
              </div>
            </Transition>
            <Transition name="tour-veil">
              <div v-if="phase !== 'play'" class="tour-veil" @click.stop>
                <svg :key="phase + current.id" class="tour-done" viewBox="0 0 80 80" aria-hidden="true"><circle class="halo" cx="40" cy="40" r="30" /><circle class="ring" cx="40" cy="40" r="30" pathLength="1" /><path class="tick" pathLength="1" d="M26.5 41.2 36 50.4 54.2 30.6" /></svg>
                <b>{{ phase === 'all' ? '全部看完' : current.title }}</b>
                <p v-if="phase === 'all'" class="tour-all"><button type="button" @click="restart"><AppIcon name="retry" :size="15" />从头再看</button><button type="button" class="primary" @click="emit('close')">开始使用</button></p>
              </div>
            </Transition>
            <Transition name="tour-veil"><span v-if="paused" class="tour-paused"><AppIcon name="play" :size="22" /></span></Transition>
          </div>
          <footer class="tour-foot">
            <button type="button" class="tour-quiet" :class="{ on: memory.hidden }" role="switch" :aria-checked="memory.hidden" @click="toggleHidden"><i><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.4 6.6 11.4 12.6 4.8" /></svg></i>不再自动弹出</button>
            <span class="tour-hint">循环播放 · 点画面暂停</span>
            <button type="button" class="tour-confirm" :disabled="phase !== 'play'" @click="confirm"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.4 6.6 11.4 12.6 4.8" /></svg>看完了</button>
          </footer>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.tour-backdrop{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:25px;background:rgb(16 20 26 / .24)}
.tour-dialog{position:relative;display:flex;flex-direction:column;width:1080px;max-width:100%;max-height:94vh;border:1px solid var(--glass-outline);border-radius:var(--r-2xl);background-color:var(--popup-glass);background-image:var(--popup-sheen);-webkit-backdrop-filter:blur(var(--popup-blur)) saturate(var(--glass-sat));backdrop-filter:blur(var(--popup-blur)) saturate(var(--glass-sat));box-shadow:0 30px 90px -20px rgb(0 0 0 / .35),var(--shadow-3),var(--glass-edge);color:var(--ink);outline:0;transform-origin:50% 60%}
:root[data-glass='solid'] .tour-dialog,:root[data-contrast='high'] .tour-dialog{background-color:var(--surface);background-image:none;-webkit-backdrop-filter:none;backdrop-filter:none}
.tour-header{display:flex;align-items:center;gap:12px;padding:16px 16px 8px 26px}
.tour-header h2{margin:0;font-family:var(--font-display);font-size:20px;font-weight:700;letter-spacing:-.2px}
.tour-progress{color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums;letter-spacing:.06em}
.tour-close{width:34px;height:34px;margin-left:auto;padding:0;border:1px solid var(--glass-outline);border-radius:50%;background-color:var(--glass-2);background-image:var(--glass-sheen);box-shadow:var(--glass-control-shadow);color:var(--control-ink)}
.tour-close:hover{background-color:var(--control-hover)}
.tour-body{display:flex;min-height:0;padding:4px 20px 16px 12px;gap:14px}

.tour-list{flex:0 0 190px;display:flex;flex-direction:column;gap:1px;overflow-y:auto;padding:2px}
.tour-list button{display:flex;align-items:center;justify-content:flex-start;gap:11px;height:auto;min-height:0;padding:6px 10px;border:0;border-radius:var(--r-control);background:none;box-shadow:none;color:var(--control-ink);text-align:left;transition:background-color var(--dur-1) var(--ease-soft)}
.tour-list button:hover{background-color:var(--control-hover)}
.tour-list button.selected{background-color:color-mix(in srgb,var(--ink) 8%,transparent)}
.tour-list i{flex:none;display:grid;place-items:center;width:18px;height:18px;color:var(--muted);font:500 11px/1 var(--font-display);font-style:normal;font-variant-numeric:tabular-nums;letter-spacing:.04em}
.tour-list button.selected i{color:var(--accent)}
.tour-list span{display:grid;min-width:0}
.tour-list b{font-size:13px;font-weight:600}
.tour-list small{overflow:hidden;color:var(--muted);font-size:11px;white-space:nowrap;text-overflow:ellipsis}
.tour-list button.done:not(.selected) :is(b,small){opacity:.62}
.tour-tick{width:16px;height:16px;fill:none;stroke:var(--accent);stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.tour-tick path{stroke-dasharray:14;animation:tour-stroke .4s var(--ease-out) .5s backwards}
@keyframes tour-stroke{from{stroke-dashoffset:14}}

.tour-stage{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:10px}
.tour-view{position:relative;width:100%;aspect-ratio:16/10;max-height:calc(94vh - 150px);overflow:hidden;border:1px solid var(--glass-outline);border-radius:14px;background:var(--canvas);cursor:pointer;contain:strict}
.tour-film{position:absolute;inset:0;transition:opacity .22s var(--ease-soft)}
.tour-film.cut{opacity:0}
.tour-ripples{position:absolute;inset:0;pointer-events:none}
.tour-ripples :deep(.tour-ripple){position:absolute;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:1.5px solid color-mix(in srgb,var(--ink) 55%,transparent);animation:tour-ripple .5s var(--ease-out) both}
.tour-ripples :deep(.tour-ripple.middle){border-color:var(--accent);box-shadow:0 0 0 6px color-mix(in srgb,var(--accent) 16%,transparent)}
@keyframes tour-ripple{from{opacity:.9;scale:.2}to{opacity:0;scale:1.15}}
.tour-cursor{position:absolute;left:0;top:0;overflow:visible;transform-origin:0 0;opacity:0;pointer-events:none;filter:drop-shadow(0 2px 3px rgb(0 0 0 / .32));transition:opacity .25s var(--ease-out)}
.tour-cursor path{fill:#fff;stroke:#16181d;stroke-width:1.1;stroke-linejoin:round}

.tour-beats{position:absolute;left:50%;top:12px;display:flex;gap:5px;padding:5px 8px;border-radius:999px;background:color-mix(in srgb,var(--surface) 80%,transparent);translate:-50% 0;pointer-events:none}
.tour-beats i{width:4px;height:4px;border-radius:2px;background:color-mix(in srgb,var(--ink) 22%,transparent);transition:width .35s var(--ease-spring),background-color .25s}
.tour-beats i.past{background:color-mix(in srgb,var(--ink) 55%,transparent)}
.tour-beats i.now{width:18px;background:var(--accent)}
.tour-caption{position:absolute;left:50%;bottom:18px;display:flex;align-items:center;gap:8px;max-width:calc(100% - 40px);margin:0;padding:8px 16px;border:1px solid var(--glass-outline);border-radius:999px;background:color-mix(in srgb,var(--surface) 94%,transparent);box-shadow:0 14px 34px -14px rgb(0 0 0 / .4),0 1px 3px rgb(0 0 0 / .08);color:var(--surface-ink,var(--ink));font-size:13.5px;font-weight:600;white-space:nowrap;translate:-50% 0;pointer-events:none}
.tour-caption.top{top:40px;bottom:auto}
.tour-caption kbd{display:inline-grid;place-items:center;height:20px;padding:0 7px;border:1px solid color-mix(in srgb,var(--ink) 18%,transparent);border-radius:6px;background:color-mix(in srgb,var(--ink) 5%,transparent);font:600 11px/1 var(--font,inherit)}
.tour-say-enter-active{transition:opacity .2s var(--ease-out),translate .3s var(--ease-spring)}
.tour-say-leave-active{transition:opacity .1s var(--ease-soft)}
.tour-say-enter-from{opacity:0;translate:-50% 10px}
.tour-say-leave-to{opacity:0}

/* 片头：大号编号、一根细线、标题。 */
.tour-title{position:absolute;inset:0;display:grid;align-content:center;justify-items:center;gap:6px;background:color-mix(in srgb,var(--canvas) 90%,transparent);pointer-events:none}
.tour-title i{font:200 76px/1 var(--font-display);font-style:normal;font-variant-numeric:tabular-nums;letter-spacing:.02em;color:var(--ink);animation:tour-rise .55s var(--ease-out) both}
.tour-title hr{width:54px;height:1px;margin:10px 0 12px;border:0;background:var(--accent);animation:tour-line .5s var(--ease-out) .12s both}
.tour-title b{font:600 22px/1.2 var(--font-display);letter-spacing:.04em;animation:tour-rise .5s var(--ease-out) .16s both}
.tour-title small{color:var(--muted);font-size:12.5px;animation:tour-rise .5s var(--ease-out) .24s both}
@keyframes tour-rise{from{opacity:0;translate:0 12px}}
@keyframes tour-line{from{scale:0 1}}
.tour-title-leave-active{transition:opacity .3s var(--ease-soft),scale .34s var(--ease-soft)}
.tour-title-leave-to{opacity:0;scale:1.06}

/* 打勾：圆描一圈，勾划出来，整体轻轻弹一下，外面散开一圈。 */
.tour-veil{position:absolute;inset:0;display:grid;align-content:center;justify-items:center;gap:14px;background:color-mix(in srgb,var(--canvas) 86%,transparent);cursor:default}
.tour-veil>b{font:600 17px/1.2 var(--font-display);letter-spacing:.06em;animation:tour-rise .4s var(--ease-out) .62s both}
.tour-done{width:84px;height:84px;overflow:visible;animation:tour-pop .5s var(--ease-spring) .66s both}
.tour-done :is(circle,path){fill:none;stroke:var(--accent);stroke-linecap:round;stroke-linejoin:round}
.tour-done .ring{stroke-width:2;stroke-dasharray:1;rotate:-90deg;transform-origin:50% 50%;animation:tour-trace .5s cubic-bezier(.65,0,.35,1) both}
.tour-done .tick{stroke-width:2.6;stroke-dasharray:1;animation:tour-trace .3s cubic-bezier(.65,0,.35,1) .44s both}
.tour-done .halo{stroke-width:1.2;transform-origin:50% 50%;animation:tour-halo .7s var(--ease-out) .7s both}
@keyframes tour-trace{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
@keyframes tour-pop{40%{scale:1.1}}
@keyframes tour-halo{from{opacity:.5;scale:1}to{opacity:0;scale:1.5}}
.tour-all{display:flex;gap:10px;margin:8px 0 0;animation:tour-rise .4s var(--ease-out) .9s both}
.tour-all button{height:38px;padding:0 18px;gap:7px;border:1px solid var(--glass-outline);border-radius:999px;background:var(--surface);box-shadow:0 10px 28px -14px rgb(0 0 0 / .4);color:var(--surface-ink,var(--ink));font-size:13px;font-weight:600}
.tour-all button.primary{border-color:transparent;background:var(--ink);color:var(--surface)}
.tour-paused{position:absolute;left:50%;top:50%;display:grid;place-items:center;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;background:color-mix(in srgb,var(--ink) 72%,transparent);color:var(--surface);pointer-events:none}
.tour-veil-enter-active,.tour-veil-leave-active{transition:opacity .26s var(--ease-out)}
.tour-veil-enter-from,.tour-veil-leave-to{opacity:0}

.tour-foot{display:flex;align-items:center;gap:14px}
.tour-foot svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.tour-quiet{height:32px;padding:0 10px 0 6px;gap:8px;border:0;background:none;box-shadow:none;color:var(--muted);font-size:12.5px}
.tour-quiet i{display:grid;place-items:center;width:16px;height:16px;border:1px solid color-mix(in srgb,var(--ink) 38%,transparent);border-radius:5px;transition:background-color .2s,border-color .2s}
.tour-quiet svg{width:12px;height:12px;color:var(--surface);opacity:0;transition:opacity .15s}
.tour-quiet.on{color:var(--ink)}
.tour-quiet.on i{border-color:var(--accent);background:var(--accent)}
.tour-quiet.on svg{opacity:1}
.tour-hint{margin-left:auto;color:var(--muted);font-size:12px}
.tour-confirm{height:36px;padding:0 18px 0 14px;gap:7px;border:0;border-radius:999px;background:var(--ink);box-shadow:0 10px 26px -14px rgb(0 0 0 / .5);color:var(--surface);font-size:13px;font-weight:600;transition:translate .2s var(--ease-out),opacity .2s}
.tour-confirm:hover:not(:disabled){background:var(--ink);color:var(--surface);translate:0 -1px}
.tour-confirm:disabled{opacity:.35}

:root[data-style='sketch'] .tour-view{border-width:1.5px;border-radius:14px 18px 15px 19px / 18px 14px 19px 15px}
:root[data-style='sketch'] .tour-caption{border-width:1.4px;border-radius:14px 18px 15px 17px;box-shadow:2px 3px 0 color-mix(in srgb,var(--pencil,#2e2d2a) 22%,transparent)}
@media(max-width:860px){.tour-list{display:none}}
</style>
