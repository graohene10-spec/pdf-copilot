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
/* 细条贴着阅读区右边、让开滚动条一段距离，从工具条下面到底边；本身不挡鼠标，只有标记可以点。 */
.bookmark-rail{position:absolute;top:72px;bottom:22px;right:20px;width:18px;z-index:8;pointer-events:none;
  --mark-glass:rgb(255 255 255 / .58);--mark-edge:rgb(255 255 255 / .9);--mark-glow:rgb(255 255 255 / .75);--mark-core:rgb(255 255 255 / .96);--mark-shade:rgb(15 18 24 / .22)}
/* 深色主题或深色底图上：更通透的玻璃、更亮的光晕，文字用浅色。 */
:root[data-theme=dark] .bookmark-rail,.bookmark-rail[data-glass-ink='light']{--mark-glass:rgb(255 255 255 / .14);--mark-edge:rgb(255 255 255 / .5);--mark-glow:rgb(255 255 255 / .42);--mark-shade:rgb(0 0 0 / .4)}
.bookmark{position:absolute;right:0;display:flex;justify-content:flex-end;transform:translateY(-50%);pointer-events:auto}
/* 一枚发光的玻璃胶囊：命名的书签把名字写在胶囊里，标记芯在胶囊右端，两者是同一块玻璃，不会错位。 */
.bookmark-hit{display:flex;align-items:center;gap:6px;height:16px;padding:0 4px;border:1px solid var(--mark-edge);border-radius:999px;background:var(--mark-glass);-webkit-backdrop-filter:blur(10px) saturate(1.6);backdrop-filter:blur(10px) saturate(1.6);box-shadow:0 0 10px 1px var(--mark-glow),0 2px 6px -2px var(--mark-shade),inset 0 1px 0 rgb(255 255 255 / .6);cursor:pointer;transition:box-shadow var(--dur-2) var(--ease-out),transform var(--dur-2) var(--spring-snappy)}
.bookmark-hit:hover,.bookmark-hit:focus-visible{outline:none;transform:scale(1.08);box-shadow:0 0 16px 3px var(--mark-glow),0 3px 8px -2px var(--mark-shade),inset 0 1px 0 rgb(255 255 255 / .7)}
.bookmark-tick{display:block;width:10px;height:4px;border-radius:2px;background:var(--mark-core);box-shadow:0 0 6px 1px var(--mark-glow)}
.bookmark.named .bookmark-hit{height:22px;padding:0 6px 0 9px}
.bookmark-label{max-width:150px;overflow:hidden;color:var(--ink);font:600 11px/20px var(--font-ui);white-space:nowrap;text-overflow:ellipsis;text-shadow:var(--glass-label-shadow, none)}
.bookmark-field{width:150px;height:26px;padding:0 9px;border:1px solid var(--mark-edge);border-radius:999px;background:var(--surface);color:var(--surface-ink);box-shadow:0 0 12px 1px var(--mark-glow),0 8px 20px -10px rgb(0 0 0 / .35);font:12px var(--font-ui);outline:none}
.bookmark-enter-active{transition:opacity var(--dur-2) var(--ease-out),transform var(--dur-bounce) var(--spring-bouncy)}
.bookmark-leave-active{transition:opacity var(--dur-2) var(--ease-out),transform var(--dur-2) var(--ease-out)}
.bookmark-enter-from,.bookmark-leave-to{opacity:0;transform:translate(10px,-50%) scale(.4)}
@media(prefers-reduced-motion:reduce){.bookmark-enter-active,.bookmark-leave-active,.bookmark-hit{transition:none}}
</style>
