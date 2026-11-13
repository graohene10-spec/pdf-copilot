<script setup lang="ts">
// Markdown 里插在段落下面的一条释义：可以留在笔记里、换个讲法，或者丢掉。
import { ref, watch } from 'vue'
import ExplainBody from './ExplainBody.vue'
import { dropNote, keepNote, rerunExplain, type Explain, type ExplainMode } from '../ai/explain'

const props = defineProps<{ item: Explain; kept: boolean; doc: string; line: number }>()
const emit = defineEmits<{ close: [] }>()
const saved = ref(props.kept)
const leaving = ref(false)
function keep() { if (props.item.status !== 'done') return; saved.value = !saved.value; if (saved.value) keepNote(props.doc, props.line, props.item); else dropNote(props.doc, props.item.id) }
function again(mode: ExplainMode) { rerunExplain(props.item, mode) }
// 留下的释义换了讲法，存的也跟着换。
watch(() => props.item.status, status => { if (status === 'done' && saved.value) keepNote(props.doc, props.line, props.item) })
function discard() { dropNote(props.doc, props.item.id); leaving.value = true; setTimeout(() => emit('close'), 160) }
</script>

<template>
  <aside class="explain-note" :class="{ leaving, saved }" contenteditable="false">
    <p class="en-head"><span>释义</span><b>{{ item.term.length > 60 ? item.term.slice(0, 60) + '…' : item.term }}</b></p>
    <ExplainBody :item="item" />
    <p class="en-actions">
      <button type="button" :class="{ on: saved }" :disabled="item.status !== 'done'" @click="keep">{{ saved ? '已留在笔记里' : '留在笔记里' }}</button>
      <button type="button" :disabled="item.status === 'running'" @click="again('deeper')">更深入</button>
      <button type="button" :disabled="item.status === 'running'" @click="again('example')">举个例子</button>
      <button type="button" :disabled="item.status === 'running'" @click="again('simpler')">说浅一点</button>
      <button type="button" @click="discard">丢弃</button>
    </p>
  </aside>
</template>

<style>
.explain-host{display:block}
.explain-note{margin:.6em 0 1.1em;padding:.65em 1em .5em;border-left:2px solid var(--accent);border-radius:0 var(--r-sm) var(--r-sm) 0;background:color-mix(in srgb,var(--accent) 7%,transparent);font-size:.92em;line-height:1.65;user-select:text;animation:en-in .26s var(--ease-out) both;transform-origin:0 0}
.explain-note.leaving{opacity:0;translate:0 -4px;transition:opacity .15s,translate .15s}
.explain-note p{margin:0}
.en-head{display:flex;align-items:baseline;gap:.7em;margin-bottom:.25em!important;color:var(--muted);font-size:.82em;letter-spacing:.04em}
.en-head b{color:var(--ink);font-weight:600;letter-spacing:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.en-actions{display:flex;flex-wrap:wrap;gap:.1em 1.1em;margin-top:.5em!important;font-size:.82em;opacity:.55;transition:opacity .15s}
.explain-note:hover .en-actions,.en-actions:focus-within{opacity:1}
.en-actions button{min-height:0;padding:0;border:0;border-radius:0;background:none!important;box-shadow:none!important;color:var(--muted);font:inherit;cursor:pointer}
.en-actions button:hover:not(:disabled),.en-actions button.on{color:var(--accent)}
.en-actions button:disabled{opacity:.45;cursor:default}
:root[data-style='sketch'] .explain-note{border:1.5px dashed color-mix(in srgb,var(--pencil,#2b2a27) 45%,transparent);border-radius:3px;background:color-mix(in srgb,var(--paper,#fdfaf0) 80%,#f3d260)}
@keyframes en-in{from{opacity:0;translate:0 -6px}}
@media(prefers-reduced-motion:reduce){.explain-note{animation:none}}
</style>
