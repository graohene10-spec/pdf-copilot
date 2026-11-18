<script setup lang="ts">
/* 使用教程：左边是章节，右边是一段会自己播放的示意动画。 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import TourWorld from '../tour/TourWorld.vue'
import { createDirector } from '../tour/director'
import { LESSONS, freshScene, type Caption, type Lesson } from '../tour/lessons'

const emit = defineEmits<{ close: [] }>()
const viewport = ref<HTMLElement>(), cursor = ref<HTMLElement>(), ripples = ref<HTMLElement>(), dialog = ref<HTMLElement>()
const scene = reactive(freshScene())
const caption = ref<Caption>({ text: '' })
const current = ref<Lesson>(LESSONS[0]), ended = ref(false), paused = ref(false)
const next = computed(() => LESSONS.slice(LESSONS.indexOf(current.value) + 1).find(item => item.play))

const director = createDirector({
  viewport: () => viewport.value || null,
  world: () => viewport.value?.querySelector<HTMLElement>('.tw-world') || null,
  cursor: () => cursor.value || null,
  ripples: () => ripples.value || null,
})

async function start(lesson: Lesson) {
  if (!lesson.play) return
  current.value = lesson; ended.value = false; paused.value = false
  Object.assign(scene, freshScene())
  caption.value = { text: '' }
  await nextTick()
  const finished = await director.play(stage => lesson.play!(stage, scene, value => { caption.value = typeof value === 'string' ? { text: value } : value }))
  if (finished) ended.value = true
}

function togglePause() {
  if (ended.value) return
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
onBeforeUnmount(() => { document.removeEventListener('keydown', keydown, true); watcher?.disconnect(); director.stop() })
</script>

<template>
  <div class="settings-backdrop tour-backdrop" @click.self="emit('close')">
    <section ref="dialog" class="settings-dialog tour-dialog" data-glass-interactive="panel" role="dialog" aria-modal="true" aria-labelledby="tour-title" tabindex="-1">
      <header class="tour-header"><h2 id="tour-title">使用教程</h2><button type="button" class="tour-close" aria-label="关闭教程" @click="emit('close')"><AppIcon name="close" :size="18" /></button></header>
      <div class="tour-body">
        <nav class="tour-list" aria-label="章节">
          <button v-for="(item, index) in LESSONS" :key="item.id" type="button" :class="{ selected: item === current }" :disabled="!item.play" :aria-current="item === current ? 'true' : undefined" @click="start(item)">
            <i>{{ String(index + 1).padStart(2, '0') }}</i><span><b>{{ item.title }}</b><small>{{ item.note }}</small></span>
          </button>
        </nav>
        <div class="tour-stage">
          <div ref="viewport" class="tour-view" :class="{ paused }" @click="togglePause">
            <TourWorld :scene="scene" />
            <div ref="ripples" class="tour-ripples"></div>
            <svg ref="cursor" class="tour-cursor" width="16" height="22" viewBox="-1 -1 16 22" aria-hidden="true"><path d="M0 0V17L4.6 12.9 7.6 19.6 10.2 18.4 7.3 11.9H13Z" /></svg>
            <Transition name="tour-say" mode="out-in">
              <p v-if="caption.text && !ended" :key="caption.text" class="tour-caption">
                <svg v-if="caption.mouse" class="hint-mouse" viewBox="0 0 14 20" aria-hidden="true"><rect x="1" y="1" width="12" height="18" rx="6" /><line x1="7" y1="4.5" x2="7" y2="8.5" /></svg>
                <kbd v-for="key in caption.keys" :key="key">{{ key }}</kbd>{{ caption.text }}
              </p>
            </Transition>
            <Transition name="tour-end">
              <div v-if="ended" class="tour-end" @click.stop>
                <button type="button" @click="start(current)"><AppIcon name="retry" :size="16" />重播</button>
                <button v-if="next" type="button" class="primary" @click="start(next)">下一段：{{ next.title }}<AppIcon name="chevron-right" :size="15" /></button>
              </div>
            </Transition>
            <Transition name="tour-end"><span v-if="paused" class="tour-paused"><AppIcon name="play" :size="22" /></span></Transition>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.tour-backdrop{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:25px;background:rgb(16 20 26 / .24)}
.tour-dialog{position:relative;display:flex;flex-direction:column;width:1080px;max-width:100%;max-height:92vh;border:1px solid var(--glass-outline);border-radius:var(--r-2xl);background-color:var(--popup-glass);background-image:var(--popup-sheen);-webkit-backdrop-filter:blur(var(--popup-blur)) saturate(var(--glass-sat));backdrop-filter:blur(var(--popup-blur)) saturate(var(--glass-sat));box-shadow:0 30px 90px -20px rgb(0 0 0 / .35),var(--shadow-3),var(--glass-edge);color:var(--ink);outline:0;transform-origin:50% 60%}
:root[data-glass='solid'] .tour-dialog,:root[data-contrast='high'] .tour-dialog{background-color:var(--surface);background-image:none;-webkit-backdrop-filter:none;backdrop-filter:none}
.tour-header{display:flex;align-items:center;justify-content:space-between;padding:16px 16px 8px 26px}
.tour-header h2{margin:0;font-family:var(--font-display);font-size:20px;font-weight:700;letter-spacing:-.2px}
.tour-close{width:34px;height:34px;padding:0;border:1px solid var(--glass-outline);border-radius:50%;background-color:var(--glass-2);background-image:var(--glass-sheen);box-shadow:var(--glass-control-shadow);color:var(--control-ink)}
.tour-close:hover{background-color:var(--control-hover)}
.tour-body{display:flex;min-height:0;padding:4px 20px 20px 12px;gap:14px}

.tour-list{flex:0 0 186px;display:flex;flex-direction:column;gap:1px;overflow-y:auto;padding:2px}
.tour-list button{display:flex;align-items:center;justify-content:flex-start;gap:11px;height:auto;min-height:0;padding:7px 10px;border:0;border-radius:var(--r-control);background:none;box-shadow:none;color:var(--control-ink);text-align:left;transition:background-color var(--dur-1) var(--ease-soft)}
.tour-list button:hover:not(:disabled){background-color:var(--control-hover)}
.tour-list button.selected{background-color:color-mix(in srgb,var(--ink) 8%,transparent)}
.tour-list button:disabled{opacity:.38;cursor:default}
.tour-list i{flex:none;width:18px;color:var(--muted);font:500 11px/1 var(--font-display);font-style:normal;font-variant-numeric:tabular-nums;letter-spacing:.04em}
.tour-list button.selected i{color:var(--accent)}
.tour-list span{display:grid;min-width:0}
.tour-list b{font-size:13px;font-weight:600}
.tour-list small{overflow:hidden;color:var(--muted);font-size:11px;white-space:nowrap;text-overflow:ellipsis}

.tour-stage{flex:1;min-width:0;display:flex;align-items:center}
.tour-view{position:relative;width:100%;aspect-ratio:16/10;max-height:calc(92vh - 110px);overflow:hidden;border:1px solid var(--glass-outline);border-radius:14px;background:var(--canvas);cursor:pointer;contain:strict}
.tour-ripples{position:absolute;inset:0;pointer-events:none}
.tour-ripples :deep(.tour-ripple){position:absolute;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:1.5px solid color-mix(in srgb,var(--ink) 55%,transparent);animation:tour-ripple .62s var(--ease-out) both}
.tour-ripples :deep(.tour-ripple.middle){border-color:var(--accent);box-shadow:0 0 0 6px color-mix(in srgb,var(--accent) 16%,transparent)}
@keyframes tour-ripple{from{opacity:.9;scale:.2}to{opacity:0;scale:1.15}}
.tour-cursor{position:absolute;left:0;top:0;overflow:visible;transform-origin:0 0;opacity:0;pointer-events:none;filter:drop-shadow(0 2px 3px rgb(0 0 0 / .32));transition:opacity .3s var(--ease-out)}
.tour-cursor path{fill:#fff;stroke:#16181d;stroke-width:1.1;stroke-linejoin:round}

.tour-caption{position:absolute;left:50%;bottom:18px;display:flex;align-items:center;gap:8px;max-width:calc(100% - 40px);margin:0;padding:8px 16px;border:1px solid var(--glass-outline);border-radius:999px;background:color-mix(in srgb,var(--surface) 94%,transparent);box-shadow:0 14px 34px -14px rgb(0 0 0 / .4),0 1px 3px rgb(0 0 0 / .08);color:var(--surface-ink,var(--ink));font-size:13.5px;font-weight:600;white-space:nowrap;translate:-50% 0;pointer-events:none}
.tour-caption kbd{display:inline-grid;place-items:center;height:20px;padding:0 7px;border:1px solid color-mix(in srgb,var(--ink) 18%,transparent);border-radius:6px;background:color-mix(in srgb,var(--ink) 5%,transparent);font:600 11px/1 var(--font,inherit)}
.tour-say-enter-active{transition:opacity .26s var(--ease-out),translate .34s var(--ease-out)}
.tour-say-leave-active{transition:opacity .16s var(--ease-soft),translate .16s var(--ease-soft)}
.tour-say-enter-from{opacity:0;translate:-50% 8px}
.tour-say-leave-to{opacity:0;translate:-50% -5px}

.tour-end{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:10px;background:color-mix(in srgb,var(--canvas) 62%,transparent);cursor:default}
.tour-end button{height:38px;padding:0 18px;gap:7px;border:1px solid var(--glass-outline);border-radius:999px;background:var(--surface);box-shadow:0 10px 28px -14px rgb(0 0 0 / .4);color:var(--surface-ink,var(--ink));font-size:13px;font-weight:600}
.tour-end button.primary{padding-right:12px;border-color:transparent;background:var(--ink);color:var(--surface)}
.tour-end button:hover{translate:0 -1px}
.tour-paused{position:absolute;left:50%;top:50%;display:grid;place-items:center;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;background:color-mix(in srgb,var(--ink) 72%,transparent);color:var(--surface);pointer-events:none}
.tour-end-enter-active,.tour-end-leave-active{transition:opacity .28s var(--ease-out)}
.tour-end-enter-from,.tour-end-leave-to{opacity:0}

:root[data-style='sketch'] .tour-view{border-width:1.5px;border-radius:14px 18px 15px 19px / 18px 14px 19px 15px}
:root[data-style='sketch'] .tour-caption{border-width:1.4px;border-radius:14px 18px 15px 17px;box-shadow:2px 3px 0 color-mix(in srgb,var(--pencil,#2e2d2a) 22%,transparent)}
@media(max-width:860px){.tour-list{display:none}}
</style>
