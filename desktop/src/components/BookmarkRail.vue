<script setup lang="ts">
// 阅读区右侧的书签：每个书签是一枚从页边伸出来的小书签，上面是一小幅画，画风取自艺术史上的一个流派（library/bookmark-art.ts）。
// 平时只露出一小条，指上去展开成整幅；位置对应它在整本书里的地方。
// 左键跳过去，右键命名、换画风、删除或一次删掉全部；选中按 Delete 也能删。命名后左边带上文字。
import { nextTick, ref, watch } from 'vue'
import type { BookmarkArt } from '../library/bookmark-art'

type Mark = { id: string; name: string; ratio: number; hint: string; art: BookmarkArt }
const props = defineProps<{ marks: Mark[]; editing?: string | null }>()
const emit = defineEmits<{ jump: [id: string]; menu: [id: string, event: MouseEvent]; rename: [id: string, name: string]; remove: [id: string]; cancel: [] }>()
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
        <button v-else type="button" class="bookmark-hit" :aria-label="mark.name ? `书签：${mark.name}` : `书签 · ${mark.hint}`" :data-tip="`${mark.art.name} · ${mark.hint}`" @click="emit('jump', mark.id)" @keydown.delete.prevent="emit('remove', mark.id)" @contextmenu.prevent.stop="emit('menu', mark.id, $event)">
          <span v-if="mark.name" class="bookmark-label">{{ mark.name }}</span>
          <span class="bookmark-art" aria-hidden="true"><svg :key="mark.art.id" viewBox="0 0 96 40" preserveAspectRatio="xMaxYMid slice" v-html="mark.art.svg" /></span>
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
/* 细条贴着阅读区右边、让开滚动条一段距离，从工具条下面到底边；本身不挡鼠标，只有书签可以点。 */
.bookmark-rail{position:absolute;top:72px;bottom:22px;right:14px;width:18px;z-index:8;pointer-events:none}
.bookmark{position:absolute;right:0;display:flex;justify-content:flex-end;transform:translateY(-50%);pointer-events:auto}
.bookmark:hover,.bookmark:focus-within{z-index:2}
.bookmark-hit{display:flex;align-items:center;gap:7px;padding:0;border:0;background:none;box-shadow:none;cursor:pointer}
.bookmark-hit:focus-visible{outline:none}
/* 一枚小书签：左端剪出燕尾，从页边伸出来。压在白纸上、也可能压在深色底图上，所以带一圈投影和一圈浅色光晕，哪种底色上都看得清。 */
.bookmark-art{display:block;width:34px;height:15px;filter:drop-shadow(0 1px 2px rgb(0 0 0 / .42)) drop-shadow(0 0 3px rgb(255 255 255 / .5));transition:width var(--dur-3) var(--ease-out),height var(--dur-3) var(--ease-out)}
.bookmark-art svg{display:block;width:100%;height:100%;clip-path:polygon(0 0,100% 0,100% 100%,0 100%,6px 50%);border-radius:0 2px 2px 0}
.bookmark-hit:hover .bookmark-art,.bookmark-hit:focus-visible .bookmark-art{width:96px;height:40px}
.bookmark-hit:hover .bookmark-art svg,.bookmark-hit:focus-visible .bookmark-art svg{clip-path:polygon(0 0,100% 0,100% 100%,0 100%,9px 50%)}
.bookmark-label{max-width:150px;height:20px;padding:0 8px;overflow:hidden;border:1px solid rgb(20 24 30 / .26);border-radius:999px;background:rgb(255 255 255 / .86);-webkit-backdrop-filter:blur(10px) saturate(1.6);backdrop-filter:blur(10px) saturate(1.6);box-shadow:0 1px 5px rgb(0 0 0 / .28);color:#1d2128;font:600 11px/18px var(--font-ui);white-space:nowrap;text-overflow:ellipsis}
.bookmark-field{width:150px;height:26px;padding:0 9px;border:1px solid rgb(20 24 30 / .3);border-radius:999px;background:var(--surface);color:var(--surface-ink);box-shadow:0 0 12px 1px rgb(255 255 255 / .55),0 8px 20px -10px rgb(0 0 0 / .35);font:12px var(--font-ui);outline:none}
.bookmark-enter-active{transition:opacity var(--dur-2) var(--ease-out),transform var(--dur-bounce) var(--spring-bouncy)}
.bookmark-leave-active{transition:opacity var(--dur-2) var(--ease-out),transform var(--dur-2) var(--ease-out)}
.bookmark-enter-from,.bookmark-leave-to{opacity:0;transform:translate(24px,-50%)}
@media(prefers-reduced-motion:reduce){.bookmark-enter-active,.bookmark-leave-active,.bookmark-art{transition:none}}
</style>
