<script setup lang="ts">
// 阅读区右侧的书签细条：每个书签一枚白色磨砂玻璃标记（深色芯、深色细边），白纸和深色底上都看得清，位置对应它在整本书里的地方。
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
.bookmark-rail{position:absolute;top:72px;bottom:22px;right:20px;width:18px;z-index:8;pointer-events:none}
.bookmark{position:absolute;right:0;display:flex;justify-content:flex-end;transform:translateY(-50%);pointer-events:auto}
/* 标记压在白纸页面上，也可能压在深色底图上，所以不跟主题变色：一枚白色磨砂玻璃胶囊，
   外面一圈深色细边和投影（白底上看得见），再一圈白色光晕（深底上看得见），芯是深色的，任何底色上都清楚。 */
.bookmark-hit{display:flex;align-items:center;gap:6px;height:16px;padding:0 4px;border:1px solid rgb(20 24 30 / .3);border-radius:999px;background:rgb(255 255 255 / .8);-webkit-backdrop-filter:blur(10px) saturate(1.6);backdrop-filter:blur(10px) saturate(1.6);box-shadow:0 0 9px 1px rgb(255 255 255 / .55),0 1px 5px rgb(0 0 0 / .32),inset 0 1px 0 rgb(255 255 255 / .9);cursor:pointer;transition:box-shadow var(--dur-2) var(--ease-out),transform var(--dur-2) var(--spring-snappy)}
.bookmark-hit:hover:not(:disabled),.bookmark-hit:focus-visible{outline:none;border-color:rgb(20 24 30 / .42);background:rgb(255 255 255 / .9);transform:scale(1.08);box-shadow:0 0 14px 3px rgb(255 255 255 / .7),0 2px 8px rgb(0 0 0 / .38),inset 0 1px 0 rgb(255 255 255 / .9)}
.bookmark-tick{display:block;width:10px;height:4px;border-radius:2px;background:#2a2f37}
.bookmark.named .bookmark-hit{height:22px;padding:0 6px 0 9px}
.bookmark-label{max-width:150px;overflow:hidden;color:#1d2128;font:600 11px/20px var(--font-ui);white-space:nowrap;text-overflow:ellipsis}
.bookmark-field{width:150px;height:26px;padding:0 9px;border:1px solid rgb(20 24 30 / .3);border-radius:999px;background:var(--surface);color:var(--surface-ink);box-shadow:0 0 12px 1px rgb(255 255 255 / .55),0 8px 20px -10px rgb(0 0 0 / .35);font:12px var(--font-ui);outline:none}
.bookmark-enter-active{transition:opacity var(--dur-2) var(--ease-out),transform var(--dur-bounce) var(--spring-bouncy)}
.bookmark-leave-active{transition:opacity var(--dur-2) var(--ease-out),transform var(--dur-2) var(--ease-out)}
.bookmark-enter-from,.bookmark-leave-to{opacity:0;transform:translate(10px,-50%) scale(.4)}
@media(prefers-reduced-motion:reduce){.bookmark-enter-active,.bookmark-leave-active,.bookmark-hit{transition:none}}
</style>
