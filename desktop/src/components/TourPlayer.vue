<script setup lang="ts">
/*
 * 使用教程。启动时先是右下角一个很小的提醒窗，里面在放动画；点它，展开成完整的教程：
 * 左边章节，右边一段会自己播放的示意动画，每段循环播放，点「看完了」打勾后进下一段。
 */
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue'
import AppIcon from './AppIcon.vue'
import TourWorld from '../tour/TourWorld.vue'
import { createDirector } from '../tour/director'
import { LESSONS, freshScene, loadTour, saveTour, type Caption, type Lesson } from '../tour/lessons'

const props = defineProps<{ startFull?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const viewport = ref<HTMLElement>(), cursor = ref<HTMLElement>(), ripples = ref<HTMLElement>(), dialog = ref<HTMLElement>()
const scene = reactive(freshScene())
const memory = reactive(loadTour())
const caption = ref<Caption>({ text: '' })
const current = shallowRef<Lesson>(LESSONS.find(item => !memory.done.includes(item.id)) || LESSONS[0])
const phase = ref<'play' | 'check' | 'all'>('play'), paused = ref(false), titled = ref(false), cut = ref(false), beat = ref(0)
const full = ref(Boolean(props.startFull)), leaving = ref(false)
let session = 0, alive = true

const director = createDirector({
  viewport: () => viewport.value || null,
  world: () => viewport.value?.querySelector<HTMLElement>('.tw-world') || null,
  cursor: () => cursor.value || null,
  ripples: () => ripples.value || null,
})
const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms))
const number = (lesson: Lesson) => String(LESSONS.indexOf(lesson) + 1).padStart(2, '0')

/* 播放一段；播完淡一下从头再来，直到换段、打勾或关闭。小窗里不放片头。 */
async function start(lesson: Lesson, intro = full.value) {
  const mine = ++session
  current.value = lesson; phase.value = 'play'; paused.value = false
  for (; alive && mine === session; intro = false) {
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

/* 小窗 → 完整教程：窗口从右下角原来的位置长到屏幕中间。 */
async function expand() {
  if (full.value) return
  const from = dialog.value?.getBoundingClientRect()
  full.value = true
  await nextTick()
  director.repaint()
  const to = dialog.value?.getBoundingClientRect()
  if (from && to && to.width) {
    dialog.value!.animate([
      { transformOrigin: '0 0', transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`, opacity: .6 },
      { transformOrigin: '0 0', transform: 'none', opacity: 1 },
    ], { duration: 460, easing: 'cubic-bezier(.2,.9,.25,1)' })
  }
  dialog.value?.focus()
  void start(current.value, true)
}
async function close() {
  if (leaving.value) return
  leaving.value = true
  await sleep(180)
  emit('close')
}
function viewClick() { if (full.value) togglePause(); else void expand() }

function keydown(event: KeyboardEvent) {
  if (!full.value) return
  event.stopPropagation()
  if (event.key === 'Escape') { event.preventDefault(); void close() }
  else if (event.key === ' ' && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); togglePause() }
}

let watcher: ResizeObserver | undefined
onMounted(() => {
  document.addEventListener('keydown', keydown, true)
  watcher = new ResizeObserver(() => director.repaint())
  if (viewport.value) watcher.observe(viewport.value)
  if (full.value) dialog.value?.focus()
  void start(current.value)
})
onBeforeUnmount(() => { alive = false; ++session; document.removeEventListener('keydown', keydown, true); watcher?.disconnect(); director.stop() })
</script>

<template>
  <div class="tour" :class="[full ? 'full settings-backdrop' : 'mini', { leaving }]" @click.self="full && close()">
    <section ref="dialog" class="tour-dialog" :class="{ 'settings-dialog': full }" :data-glass-interactive="full ? 'panel' : undefined" role="dialog" :aria-modal="full" aria-label="使用教程" tabindex="-1">
      <header v-if="full" class="tour-header"><h2>使用教程</h2><span class="tour-progress">{{ memory.done.length }} / {{ LESSONS.length }}</span><button type="button" class="tour-close" aria-label="关闭教程" @click="close"><AppIcon name="close" :size="18" /></button></header>
      <div class="tour-body">
        <nav v-if="full" class="tour-list" aria-label="章节">
          <button v-for="item in LESSONS" :key="item.id" type="button" :class="{ selected: item === current && phase !== 'all', done: memory.done.includes(item.id) }" :aria-current="item === current ? 'true' : undefined" @click="start(item, true)">
            <i><svg v-if="memory.done.includes(item.id)" class="tour-tick" viewBox="0 0 16 16" aria-label="已看完"><path d="M3.5 8.4 6.6 11.4 12.6 4.8" /></svg><template v-else>{{ number(item) }}</template></i><span><b>{{ item.title }}</b><small>{{ item.note }}</small></span>
          </button>
        </nav>
        <div class="tour-stage">
          <div ref="viewport" class="tour-view" :class="{ paused }" :role="full ? undefined : 'button'" :aria-label="full ? undefined : '展开使用教程'" @click="viewClick">
            <div class="tour-film" :class="{ cut }"><TourWorld :scene="scene" /></div>
            <div ref="ripples" class="tour-ripples"></div>
            <svg ref="cursor" class="tour-cursor" width="16" height="22" viewBox="-1 -1 16 22" aria-hidden="true"><path d="M0 0V17L4.6 12.9 7.6 19.6 10.2 18.4 7.3 11.9H13Z" /></svg>
            <template v-if="full">
              <div v-if="phase === 'play' && !titled" class="tour-beats" aria-hidden="true"><i v-for="index in current.steps" :key="index" :class="{ past: index < beat, now: index === beat }"></i></div>
              <Transition name="tour-say" mode="out-in">
                <p v-if="caption.text && phase === 'play' && !titled" :key="caption.text" class="tour-caption" :class="{ top: caption.top }">
                  <svg v-if="caption.mouse" class="hint-mouse" viewBox="0 0 14 20" aria-hidden="true"><path v-if="caption.mouse === 'left'" class="side" d="M7 1.6A5.4 5.4 0 0 0 1.6 7v1.8H7z" /><path v-else-if="caption.mouse === 'right'" class="side" d="M7 1.6A5.4 5.4 0 0 1 12.4 7v1.8H7z" /><rect x="1" y="1" width="12" height="18" rx="6" /><line x1="7" y1="4.5" x2="7" y2="8.5" /></svg>
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
                  <p v-if="phase === 'all'" class="tour-all"><button type="button" @click="restart"><AppIcon name="retry" :size="15" />从头再看</button><button type="button" class="primary" @click="close">开始使用</button></p>
                </div>
              </Transition>
              <Transition name="tour-veil"><span v-if="paused" class="tour-paused"><AppIcon name="play" :size="22" /></span></Transition>
            </template>
            <template v-else>
              <span class="tour-tag"><AppIcon name="play" :size="11" />使用教程</span>
              <button type="button" class="tour-dismiss" aria-label="关闭" data-tip="关闭" @click.stop="close"><AppIcon name="close" :size="12" /></button>
            </template>
          </div>
          <footer v-if="full" class="tour-foot">
            <button type="button" class="tour-quiet" :class="{ on: memory.hidden }" role="switch" :aria-checked="memory.hidden" @click="toggleHidden"><i><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.4 6.6 11.4 12.6 4.8" /></svg></i>启动时不再自动弹出</button>
            <span class="tour-hint">循环播放 · 点画面暂停 · 以后可以从设置里打开</span>
            <button type="button" class="tour-confirm" :disabled="phase !== 'play'" @click="confirm"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.4 6.6 11.4 12.6 4.8" /></svg>看完了</button>
          </footer>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* ---- 小窗：右下角一个提醒，只有画面、一个标签和关闭 ---- */
.tour.mini{position:fixed;right:18px;bottom:18px;z-index:70;width:248px;animation:tour-in .5s var(--ease-spring) both}
@keyframes tour-in{from{opacity:0;translate:0 22px;scale:.92}}
.tour.mini .tour-dialog{border-radius:12px;background:var(--canvas);box-shadow:0 0 0 1px color-mix(in srgb,var(--ink) 22%,transparent),0 22px 50px -20px rgb(0 0 0 / .5),0 8px 18px -12px rgb(0 0 0 / .3);outline:0;transition:translate .2s var(--ease-out),box-shadow .2s var(--ease-out)}
.tour.mini .tour-dialog:hover{translate:0 -2px;box-shadow:0 0 0 1px color-mix(in srgb,var(--ink) 34%,transparent),0 28px 56px -20px rgb(0 0 0 / .55),0 10px 20px -12px rgb(0 0 0 / .3)}
.tour.mini .tour-view{border-radius:12px}
.tour.mini .tour-cursor{width:11px;height:15px}
.tour-tag{position:absolute;left:7px;bottom:7px;display:flex;align-items:center;gap:5px;height:22px;padding:0 9px 0 7px;border-radius:999px;background:color-mix(in srgb,var(--ink) 82%,transparent);color:var(--surface);font-size:11px;font-weight:600;pointer-events:none}
.tour-dismiss{position:absolute;right:6px;top:6px;display:grid;place-items:center;width:20px;height:20px;min-height:0;padding:0;border:0;border-radius:50%;background:color-mix(in srgb,var(--surface) 88%,transparent);box-shadow:0 0 0 1px color-mix(in srgb,var(--ink) 14%,transparent);color:var(--surface-ink,var(--ink));opacity:0;transition:opacity .15s}
.tour.mini:hover .tour-dismiss,.tour-dismiss:focus-visible{opacity:1}
:root[data-style='sketch'] .tour.mini .tour-dialog{box-shadow:0 0 0 1.5px var(--pencil,#2e2d2a),3px 4px 0 color-mix(in srgb,var(--pencil,#2e2d2a) 18%,transparent)}
.tour.leaving{opacity:0;transition:opacity .18s var(--ease-soft)}
.tour.mini.leaving{translate:0 10px;transition:opacity .18s var(--ease-soft),translate .18s var(--ease-soft)}

/* ---- 完整的教程 ---- */
.tour.full{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:25px;background:rgb(16 20 26 / .24);animation:tour-dim .3s var(--ease-out) both}
@keyframes tour-dim{from{background-color:transparent}}
.tour.full .tour-dialog{position:relative;display:flex;flex-direction:column;width:1080px;max-width:100%;max-height:94vh;border:1px solid var(--glass-outline);border-radius:var(--r-2xl);background-color:var(--popup-glass);background-image:var(--popup-sheen);-webkit-backdrop-filter:blur(var(--popup-blur)) saturate(var(--glass-sat));backdrop-filter:blur(var(--popup-blur)) saturate(var(--glass-sat));box-shadow:0 30px 90px -20px rgb(0 0 0 / .35),var(--shadow-3),var(--glass-edge);color:var(--ink);outline:0}
:root[data-glass='solid'] .tour.full .tour-dialog,:root[data-contrast='high'] .tour.full .tour-dialog{background-color:var(--surface);background-image:none;-webkit-backdrop-filter:none;backdrop-filter:none}
.tour-header{display:flex;align-items:center;gap:12px;padding:16px 16px 8px 26px}
.tour-header h2{margin:0;font-family:var(--font-display);font-size:20px;font-weight:700;letter-spacing:-.2px}
.tour-progress{color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums;letter-spacing:.06em}
.tour-close{width:34px;height:34px;margin-left:auto;padding:0;border:1px solid var(--glass-outline);border-radius:50%;background-color:var(--glass-2);background-image:var(--glass-sheen);box-shadow:var(--glass-control-shadow);color:var(--control-ink)}
.tour-close:hover{background-color:var(--control-hover)}
.tour.full .tour-body{display:flex;min-height:0;padding:4px 20px 16px 12px;gap:14px}

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
.tour-view{position:relative;width:100%;aspect-ratio:16/10;overflow:hidden;background:var(--canvas);cursor:pointer;contain:strict}
.tour.full .tour-view{max-height:calc(94vh - 150px);border:1px solid var(--glass-outline);border-radius:14px}
.tour-film{position:absolute;inset:0;transition:opacity .22s var(--ease-soft)}
.tour-film.cut{opacity:0}
.tour-ripples{position:absolute;inset:0;pointer-events:none}
.tour-ripples :deep(.tour-ripple){position:absolute;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:1.5px solid color-mix(in srgb,var(--ink) 55%,transparent);animation:tour-ripple .5s var(--ease-out) both}
.tour.mini .tour-ripples :deep(.tour-ripple){width:22px;height:22px;margin:-11px 0 0 -11px}
.tour-ripples :deep(.tour-ripple.right){border-style:dashed}
.hint-mouse .side{fill:var(--accent);stroke:none}
.hint-mouse:has(.side) line{stroke:color-mix(in srgb,var(--ink) 45%,transparent);stroke-width:1.3;animation:none}
.tour-ripples :deep(.tour-ripple.middle){border-color:var(--accent);box-shadow:0 0 0 6px color-mix(in srgb,var(--accent) 16%,transparent)}
@keyframes tour-ripple{from{opacity:.9;scale:.2}to{opacity:0;scale:1.15}}
.tour-cursor{position:absolute;left:0;top:0;overflow:visible;transform-origin:0 0;will-change:transform;opacity:0;pointer-events:none;filter:drop-shadow(0 2px 3px rgb(0 0 0 / .32));transition:opacity .25s var(--ease-out)}
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

:root[data-style='sketch'] .tour.full .tour-view{border-width:1.5px;border-radius:14px 18px 15px 19px / 18px 14px 19px 15px}
:root[data-style='sketch'] .tour-caption{border-width:1.4px;border-radius:14px 18px 15px 17px;box-shadow:2px 3px 0 color-mix(in srgb,var(--pencil,#2e2d2a) 22%,transparent)}
@media(max-width:860px){.tour-list{display:none}}
</style>
