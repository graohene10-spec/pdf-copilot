<script setup lang="ts">
// 阅读区右侧的书签细条：每个书签一枚浅色小玻璃标记，位置对应它在整本书里的地方。
// 左键跳过去，右键命名或删除；命名后标记左边带上文字，没名字时只是一枚标记。
import { nextTick, ref, watch } from 'vue'

type Mark = { id: string; name: string; ratio: number; hint: string }
const props = defineProps<{ marks: Mark[]; editing?: string | null }>()
const emit = defineEmits<{ jump: [id: string]; menu: [id: string, event: MouseEvent]; rename: [id: string, name: string]; cancel: [] }>()
const field = ref<HTMLInputElement[]>()
const draft = ref('')
watch(() => props.editing, async id => {
  if (!id) return
  draft.value = props.marks.find(mark => mark.id === id)?.name || ''
  await nextTick()
  field.value?.[0]?.focus(); field.value?.[0]?.select()
})
function commit(id: string) { emit('rename', id, draft.value) }
function key(event: KeyboardEvent, id: string) {
  if (event.isComposing) return
  if (event.key === 'Enter') { event.preventDefault(); commit(id) }
  else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); emit('cancel') }
}
</script>

<template>
  <div v-if="marks.length" class="bookmark-rail" aria-label="书签">
    <TransitionGroup name="bookmark">
      <div v-for="mark in marks" :key="mark.id" class="bookmark" :class="{ named: mark.name, editing: editing === mark.id }" :style="{ top: `${mark.ratio * 100}%` }">
        <input v-if="editing === mark.id" ref="field" v-model="draft" class="bookmark-field" maxlength="40" placeholder="给书签起个名字" aria-label="书签名称" @keydown="key($event, mark.id)" @blur="commit(mark.id)" />
        <button v-else type="button" class="bookmark-hit" :aria-label="mark.name ? `书签：${mark.name}` : `书签 · ${mark.hint}`" :data-tip="mark.name ? undefined : `${mark.hint} · 右键命名或删除`" @click="emit('jump', mark.id)" @contextmenu.prevent.stop="emit('menu', mark.id, $event)">
          <span v-if="mark.name" class="bookmark-label">{{ mark.name }}</span>
          <i class="bookmark-tick" aria-hidden="true" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
/* 细条贴着阅读区右边，从工具条下面到底边；本身不挡鼠标，只有标记可以点。 */
.bookmark-rail{position:absolute;top:72px;bottom:22px;right:4px;width:18px;z-index:8;pointer-events:none}
.bookmark{position:absolute;right:0;display:flex;justify-content:flex-end;transform:translateY(-50%);pointer-events:auto}
.bookmark-hit{display:flex;align-items:center;gap:5px;height:18px;padding:0 0 0 6px;border:0;background:none;box-shadow:none;cursor:pointer}
.bookmark-tick{display:block;width:12px;height:5px;border-radius:3px;background:color-mix(in srgb,var(--accent) 42%,rgb(255 255 255 / .7));box-shadow:0 0 0 .5px color-mix(in srgb,var(--accent) 45%,transparent),0 1px 3px rgb(0 0 0 / .14),inset 0 1px 0 rgb(255 255 255 / .7);transition:width var(--dur-2) var(--spring-snappy),background var(--dur-1) var(--ease-soft)}
.bookmark-hit:hover .bookmark-tick,.bookmark-hit:focus-visible .bookmark-tick{width:18px;background:var(--accent)}
.bookmark-hit:focus-visible{outline:none}
/* 命名的书签：标记左边一枚小玻璃胶囊写着名字。 */
.bookmark-label{max-width:150px;height:20px;padding:0 8px;overflow:hidden;border:1px solid var(--glass-outline);border-radius:var(--r-sm);background-color:var(--popup-glass);background-image:var(--popup-sheen);-webkit-backdrop-filter:blur(var(--popup-blur)) saturate(var(--glass-sat));backdrop-filter:blur(var(--popup-blur)) saturate(var(--glass-sat));box-shadow:0 4px 12px -6px rgb(0 0 0 / .3),var(--glass-edge);color:var(--surface-ink);font:600 11px/18px var(--font-ui);white-space:nowrap;text-overflow:ellipsis;opacity:.92;transition:opacity var(--dur-1) var(--ease-soft),translate var(--dur-2) var(--spring-snappy)}
.bookmark-hit:hover .bookmark-label{opacity:1;translate:-2px 0}
.bookmark-field{width:150px;height:26px;padding:0 9px;border:1px solid var(--accent-ring);border-radius:var(--r-sm);background:var(--surface);color:var(--surface-ink);box-shadow:0 8px 20px -10px rgb(0 0 0 / .35);font:12px var(--font-ui);outline:none}
.bookmark-enter-active{transition:opacity var(--dur-2) var(--ease-out),transform var(--dur-bounce) var(--spring-bouncy)}
.bookmark-leave-active{transition:opacity var(--dur-2) var(--ease-out),transform var(--dur-2) var(--ease-out)}
.bookmark-enter-from,.bookmark-leave-to{opacity:0;transform:translate(10px,-50%) scale(.4)}
@media(prefers-reduced-motion:reduce){.bookmark-enter-active,.bookmark-leave-active,.bookmark-tick,.bookmark-label{transition:none}}
</style>
