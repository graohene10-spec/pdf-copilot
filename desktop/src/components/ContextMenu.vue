<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'

type Item = { label: string; icon?: string; action: () => void; danger?: boolean; disabled?: boolean; separator?: boolean; hint?: string }
const props = defineProps<{ x: number; y: number; items: Item[] }>()
const emit = defineEmits<{ close: [] }>()
const menu = ref<HTMLElement>()
const size = ref({ width: 236, height: props.items.length * 36 + 12 })
const style = computed(() => ({
  left: `${Math.max(8, Math.min(window.innerWidth - size.value.width - 8, props.x))}px`,
  top: `${Math.max(8, Math.min(window.innerHeight - size.value.height - 8, props.y))}px`,
}))
function run(item: Item) { if (item.disabled) return; emit('close'); item.action() }
function buttons() { return [...(menu.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])] }
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); emit('close'); return }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  event.preventDefault()
  const list = buttons(), index = list.indexOf(document.activeElement as HTMLButtonElement)
  list[(index + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus()
}
function outside(event: Event) { if (!(event.target instanceof Node) || !menu.value?.contains(event.target)) emit('close') }
onMounted(async () => {
  document.addEventListener('pointerdown', outside, true)
  window.addEventListener('blur', outside as any)
  window.addEventListener('resize', outside as any)
  await nextTick()
  if (menu.value) size.value = { width: menu.value.offsetWidth, height: menu.value.offsetHeight }
  buttons()[0]?.focus({ preventScroll: true })
})
onBeforeUnmount(() => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('blur', outside as any); window.removeEventListener('resize', outside as any) })
</script>

<template>
  <div ref="menu" class="context-menu" role="menu" :style="style" @keydown="keydown" @contextmenu.prevent>
    <template v-for="(item, index) in items" :key="index">
      <hr v-if="item.separator" />
      <button type="button" role="menuitem" :class="{ danger: item.danger }" :disabled="item.disabled" @click="run(item)"><AppIcon v-if="item.icon" :name="item.icon" :size="15" /><i v-else class="icon-space" aria-hidden="true" /><span>{{ item.label }}</span><small v-if="item.hint">{{ item.hint }}</small></button>
    </template>
  </div>
</template>

<style scoped>
/* 右键菜单：实底小卡片，从光标处弹出。 */
.context-menu{position:fixed;z-index:90;min-width:220px;max-width:300px;padding:5px;border-radius:var(--r-lg);background-color:var(--popup-glass);background-image:var(--popup-sheen);-webkit-backdrop-filter:blur(var(--popup-blur)) saturate(var(--glass-sat));backdrop-filter:blur(var(--popup-blur)) saturate(var(--glass-sat));border:1px solid var(--glass-outline);box-shadow:0 16px 40px -14px rgb(0 0 0 / .3),var(--glass-edge);color:var(--surface-ink);font-family:var(--font-ui);transform-origin:0 0;animation:zg-pop-in var(--dur-3) var(--spring-snappy) both}
button{display:flex;align-items:center;gap:10px;width:100%;height:32px;padding:0 10px;border:0;border-radius:var(--r-sm);background:none;box-shadow:none;font:inherit;font-size:12.5px;color:inherit;text-align:left;cursor:pointer}
button:hover:not(:disabled),button:focus-visible{background:color-mix(in srgb,var(--surface-ink) 8%,transparent);outline:none}
button svg{flex-shrink:0;color:var(--surface-muted)}
.icon-space{flex:0 0 15px}
button span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
button small{font-size:11px;color:var(--surface-muted)}
button.danger{color:var(--danger)}
button:disabled{opacity:.45;cursor:default}
hr{height:1px;margin:5px 8px;border:0;background:var(--line-soft)}
</style>
