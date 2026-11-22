<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { vLiquidSelection } from '../ui/liquid-selection'

type Item = { label: string; icon?: string; action: () => void; danger?: boolean; disabled?: boolean; separator?: boolean; hint?: string; /** 图标位置换成一小幅画（96 × 40 的 SVG 内容，应用自己的图案，不是用户输入）。 */ swatch?: string }
const props = defineProps<{ x: number; y: number; items: Item[] }>()
const emit = defineEmits<{ close: [] }>()
const menu = ref<HTMLElement>()
// 指针或键盘焦点所在的一项：一滴玻璃高光滑到它下面。
const current = ref(-1)
const size = ref({ width: 236, height: props.items.length * 36 + 12 })
const style = computed(() => ({
  left: `${Math.max(8, Math.min(window.innerWidth - size.value.width - 8, props.x))}px`,
  top: `${Math.max(8, Math.min(window.innerHeight - size.value.height - 8, props.y))}px`,
}))
function run(item: Item) { if (item.disabled) return; emit('close'); item.action() }
function buttons() { return [...(menu.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])] }
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); emit('close'); return }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const list = buttons(), index = list.indexOf(document.activeElement as HTMLButtonElement)
  if (event.key === 'Home') list[0]?.focus()
  else if (event.key === 'End') list.at(-1)?.focus()
  else list[(index + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus()
}
// 在菜单外面按下左键：这一下只用来收起菜单，不顺带点中底下的东西。
// 只吞掉紧跟着的那一次 click；右键照常（在别处右键会收起这个菜单、再打开新的）。
// App 在 document 的捕获阶段用 pointerdown 判断「这一下是收菜单的」，这里不拦 pointerdown，它照常收到。
function swallowClick() {
  const stop = (event: Event) => { event.preventDefault(); event.stopPropagation(); done() }
  const later = () => setTimeout(done, 0)
  function done() { window.removeEventListener('click', stop, true); window.removeEventListener('pointerup', later, true); window.removeEventListener('pointercancel', later, true) }
  window.addEventListener('click', stop, true)
  window.addEventListener('pointerup', later, true); window.addEventListener('pointercancel', later, true)
}
function outside(event: Event) {
  if (event.target instanceof Node && menu.value?.contains(event.target)) return
  if (event.type === 'pointerdown' && (event as PointerEvent).button === 0) swallowClick()
  emit('close')
}
// 菜单关掉后把焦点还给原来的地方（比如书页），方向键、翻页键接着能用。
let before: Element | null = null
onMounted(async () => {
  before = document.activeElement
  document.addEventListener('pointerdown', outside, true)
  window.addEventListener('blur', outside as any)
  window.addEventListener('resize', outside as any)
  await nextTick()
  if (menu.value) size.value = { width: menu.value.offsetWidth, height: menu.value.offsetHeight }
  buttons()[0]?.focus({ preventScroll: true })
})
onBeforeUnmount(() => {
  const back = before
  // 菜单项自己把焦点带去了别处（比如打开了一个输入框）就不抢。
  setTimeout(() => { if ((!document.activeElement || document.activeElement === document.body) && back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true }) }, 0)
  document.removeEventListener('pointerdown', outside, true); window.removeEventListener('blur', outside as any); window.removeEventListener('resize', outside as any) })
</script>

<template>
  <div ref="menu" v-liquid-selection="{ selector: '.current', radius: 'var(--r-sm)' }" class="context-menu" data-glass-interactive="panel" role="menu" :style="style" @keydown="keydown" @contextmenu.prevent @pointerleave="current = -1">
    <template v-for="(item, index) in items" :key="index">
      <hr v-if="item.separator" />
      <button type="button" role="menuitem" :class="{ danger: item.danger, current: current === index && !item.disabled }" :disabled="item.disabled" @click="run(item)" @pointerenter="current = index" @focus="current = index"><svg v-if="item.swatch" class="menu-swatch" viewBox="0 0 96 40" aria-hidden="true" v-html="item.swatch" /><AppIcon v-else-if="item.icon" :name="item.icon" :size="15" /><i v-else class="icon-space" aria-hidden="true" /><span>{{ item.label }}</span><small v-if="item.hint">{{ item.hint }}</small></button>
    </template>
  </div>
</template>

<style scoped>
/* 右键菜单：一块从光标处弹出的液态玻璃——带折射的透镜边、跟随光标的镜面环，指向的那一项下面滑过一滴玻璃高光。 */
.context-menu{position:fixed;z-index:90;min-width:220px;max-width:300px;padding:5px;border-radius:var(--r-lg);background-color:var(--popup-glass);background-image:var(--popup-sheen);--lens-blur:var(--popup-blur);--lens-saturate:var(--glass-sat);-webkit-backdrop-filter:var(--refraction, blur(var(--popup-blur)) saturate(var(--glass-sat)));backdrop-filter:var(--refraction, blur(var(--popup-blur)) saturate(var(--glass-sat)));border:1px solid var(--glass-outline);box-shadow:0 16px 40px -14px rgb(0 0 0 / .3),var(--glass-edge);color:var(--surface-ink);font-family:var(--font-ui);transform-origin:0 0;animation:zg-pop-in var(--dur-3) var(--spring-snappy) both}
button{display:flex;align-items:center;gap:10px;width:100%;height:32px;padding:0 10px;border:0;border-radius:var(--r-sm);background:none;box-shadow:none;font:inherit;font-size:12.5px;color:inherit;text-align:left;cursor:pointer}
button{position:relative}
button:focus-visible{outline:none}
.context-menu:not(.has-indicator) button:hover:not(:disabled){background:color-mix(in srgb,var(--surface-ink) 8%,transparent)}
button svg{flex-shrink:0;color:var(--surface-muted)}
.icon-space{flex:0 0 15px}
.menu-swatch{flex:0 0 36px;width:36px;height:15px;border-radius:2px;box-shadow:0 0 0 1px rgb(0 0 0 / .18)}
button span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
button small{font-size:11px;color:var(--surface-muted)}
button.danger{color:var(--danger)}
button:disabled{opacity:.45;cursor:default}
/* 分隔线两头淡出。 */
hr{height:1px;margin:5px 8px;border:0;background:linear-gradient(90deg,transparent,var(--line-soft) 18%,var(--line-soft) 82%,transparent)}
.context-menu :deep(.liquid-indicator){background-color:color-mix(in srgb,var(--surface-ink) 9%,transparent);background-image:linear-gradient(180deg,rgb(255 255 255 / .22),rgb(255 255 255 / 0) 60%);box-shadow:inset 0 1px 0 rgb(255 255 255 / .35),inset 0 0 0 .5px color-mix(in srgb,var(--surface-ink) 8%,transparent)}
</style>
