<script setup lang="ts">
// 学习开始前的设定表。目标也可以直接写在输入框里。
import { computed, reactive, ref, watchEffect } from 'vue'
import { LEARNING_GOALS } from '../ai/learning-prompts'
import { summaryChapters, chapterGroups, chapterScope, type Chapter } from '../ai/summary'
import type { LearningOptions } from '../ai/learning'
import AppIcon from './AppIcon.vue'

const props = defineProps<{ title: string; options: LearningOptions; hasSelection?: boolean; outline?: Chapter[] }>()
const emit = defineEmits<{ start: []; cancel: [] }>()
const options = props.options
const SELECTION = '选中的内容'
const chapters = computed(() => summaryChapters(props.outline))
const groups = computed(() => chapterGroups(chapters.value))
const chosen = reactive(new Set<number>())
const unfolded = reactive(new Set<number>())
type Group = { at: number; parts: number[] }
const stateOf = (group: Group) => chosen.has(group.at) ? 'true' : group.parts.some(index => chosen.has(index)) ? 'mixed' : 'false'
const commit = () => { options.scope = chapterScope(chapters.value, chosen) }
function toggleGroup(group: Group) {
  const whole = chosen.has(group.at)
  for (const index of [group.at, ...group.parts]) if (whole) chosen.delete(index); else chosen.add(index)
  commit()
}
function togglePart(group: Group, index: number) {
  if (chosen.has(index)) chosen.delete(index); else chosen.add(index)
  if (group.parts.every(part => chosen.has(part))) chosen.add(group.at); else chosen.delete(group.at)
  commit()
}
function toggleFold(at: number) { if (unfolded.has(at)) unfolded.delete(at); else unfolded.add(at) }
function write(value: string) { chosen.clear(); options.scope = value }
const typed = computed(() => !chosen.size && options.scope !== SELECTION ? options.scope : '')
const pagesOf = (chapter: Chapter) => chapter.page ? chapter.end && chapter.end > chapter.page ? `${chapter.page}–${chapter.end}` : String(chapter.page) : ''
// 目标：三种现成的学法里选一种，后面可以再补一句自己的要求。两样合成一句交给助手。
const preset = ref<string>(LEARNING_GOALS.find(item => options.goal.startsWith(item.name))?.name || '深度理解')
const more = ref(options.goal.replace(new RegExp(`^(${LEARNING_GOALS.map(item => item.name).join('|')})：?`), ''))
watchEffect(() => { options.goal = [preset.value, more.value.trim()].filter(Boolean).join('：') })
</script>

<template>
  <section class="learn-card" aria-label="学习设置">
    <header><h3>学习</h3><p :title="title">{{ title }}</p></header>
    <div class="learn-field">
      <span class="learn-label">范围</span>
      <button v-if="hasSelection" type="button" class="learn-chip" :aria-pressed="options.scope === SELECTION" @click="write(options.scope === SELECTION ? '' : SELECTION)">{{ SELECTION }}</button>
      <div v-if="chapters.length" class="learn-chapters" role="group" aria-label="按章节选">
        <template v-for="group in groups" :key="group.at">
          <div class="learn-chapter-row">
            <button v-if="group.parts.length" type="button" class="learn-unfold" :aria-expanded="unfolded.has(group.at)" :aria-label="`${unfolded.has(group.at) ? '收起' : '展开'}「${chapters[group.at]!.title}」的小节`" @click="toggleFold(group.at)"><AppIcon name="arrow" :size="10" /></button>
            <span v-else class="learn-unfold" aria-hidden="true" />
            <button type="button" class="learn-chapter" role="checkbox" :aria-checked="stateOf(group)" @click="toggleGroup(group)"><i aria-hidden="true" /><span>{{ chapters[group.at]!.title }}</span><small v-if="pagesOf(chapters[group.at]!)">{{ pagesOf(chapters[group.at]!) }}</small></button>
          </div>
          <template v-if="unfolded.has(group.at)">
            <button v-for="index in group.parts" :key="index" type="button" class="learn-chapter sub" role="checkbox" :aria-checked="chosen.has(index)" @click="togglePart(group, index)"><i aria-hidden="true" /><span>{{ chapters[index]!.title }}</span><small v-if="pagesOf(chapters[index]!)">{{ pagesOf(chapters[index]!) }}</small></button>
          </template>
        </template>
      </div>
      <input :value="typed" type="text" maxlength="200" placeholder="或者自己写：第 3 章、42–58 页…" aria-label="范围：自己写" @input="write(($event.target as HTMLInputElement).value)" />
    </div>
    <div class="learn-field">
      <span class="learn-label">目标</span>
      <div class="learn-seg wide" role="radiogroup" aria-label="学法">
        <button v-for="item in LEARNING_GOALS" :key="item.name" type="button" role="radio" :aria-checked="preset === item.name" :data-tip="item.note" @click="preset = item.name">{{ item.name }}</button>
      </div>
      <input v-model="more" type="text" maxlength="300" placeholder="还有什么要求（可不填）" aria-label="目标：自己写" @keydown.enter.prevent="!$event.isComposing && $event.keyCode !== 229 && emit('start')" />
    </div>
    <div class="learn-field row">
      <span class="learn-label">题型</span>
      <div class="learn-seg" role="radiogroup" aria-label="题型">
        <button type="button" role="radio" :aria-checked="options.quiz === 'choice'" @click="options.quiz = 'choice'">选择</button>
        <button type="button" role="radio" :aria-checked="options.quiz === 'open'" @click="options.quiz = 'open'">自述</button>
      </div>
    </div>
    <footer><button type="button" class="learn-cancel" @click="emit('cancel')">取消</button><button type="button" class="learn-start" @click="emit('start')">开始</button></footer>
  </section>
</template>

<style scoped>
.learn-card{display:flex;flex-direction:column;gap:14px;margin:6px 2px;padding:16px;border:1px solid var(--hairline);border-radius:14px;background:var(--surface,transparent)}
header{display:flex;align-items:baseline;gap:10px;min-width:0}
h3{flex:none;margin:0;font-size:15px}
header p{min-width:0;margin:0;overflow:hidden;color:var(--muted);font-size:12.5px;white-space:nowrap;text-overflow:ellipsis}
.learn-field{display:flex;flex-direction:column;gap:7px}
.learn-field.row{flex-direction:row;align-items:center;justify-content:space-between}
.learn-label{color:var(--secondary);font-size:13px}
.learn-chip{align-self:flex-start;height:28px;padding:0 12px;border:1px solid color-mix(in srgb,var(--ink) 18%,transparent);border-radius:8px;background:none;box-shadow:none;color:var(--secondary);font:inherit;font-size:13px}
.learn-chip[aria-pressed='true']{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--ink);font-weight:600}
input{min-width:0;height:32px;padding:0 10px;border:1px solid color-mix(in srgb,var(--ink) 18%,transparent);border-radius:8px;background:none;box-shadow:none;color:var(--ink);font:inherit;font-size:13px;outline:0}
input:focus{border-color:var(--accent)}
input::placeholder{color:var(--muted)}
.learn-chapters{display:flex;flex-direction:column;max-height:232px;padding:4px;overflow:auto;border:1px solid var(--hairline);border-radius:8px}
.learn-chapter-row{display:flex;align-items:center;flex:none}
.learn-unfold{display:grid;place-items:center;flex:none;width:22px;height:30px;padding:0;border:0;border-radius:6px;background:none;box-shadow:none;color:var(--muted)}
.learn-unfold svg{rotate:180deg;transition:rotate var(--dur-2) var(--ease-out)}
.learn-unfold[aria-expanded='true'] svg{rotate:-90deg}
.learn-chapter{display:flex;align-items:center;gap:9px;flex:1;min-width:0;min-height:30px;padding:0 6px 0 4px;border:0;border-radius:6px;background:none;box-shadow:none;color:var(--ink);font:inherit;font-size:13px;text-align:left}
.learn-chapter.sub{flex:none;width:calc(100% - 40px);margin-left:40px;color:var(--secondary)}
.learn-chapter:hover{background:color-mix(in srgb,var(--ink) 6%,transparent)}
.learn-chapter i{position:relative;flex:none;width:13px;height:13px;border:1.5px solid color-mix(in srgb,var(--ink) 42%,transparent);border-radius:3px}
.learn-chapter span{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.learn-chapter small{flex:none;color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}
.learn-chapter[aria-checked='true'] i{border-color:var(--accent);background:var(--accent)}
.learn-chapter[aria-checked='mixed'] i{border-color:var(--accent)}
.learn-chapter[aria-checked='mixed'] i::after{content:'';position:absolute;left:2px;right:2px;top:calc(50% - 1px);height:2px;border-radius:1px;background:var(--accent)}
.learn-seg{display:flex;padding:3px;border-radius:10px;background:color-mix(in srgb,var(--ink) 8%,transparent)}
.learn-seg.wide button{flex:1}
.learn-seg button{height:26px;padding:0 16px;border:0;border-radius:7px;background:none;box-shadow:none;color:var(--secondary);font:inherit;font-size:13px}
.learn-seg button[aria-checked='true']{background:var(--surface,#fff);box-shadow:0 1px 3px rgb(0 0 0 / .18);color:var(--ink);font-weight:600}
footer{display:flex;align-items:center;justify-content:space-between}
.learn-cancel{height:32px;padding:0 2px;border:0;background:none;box-shadow:none;color:var(--muted);font:inherit;font-size:13px}
.learn-cancel:hover{color:var(--ink)}
.learn-start{height:34px;padding:0 20px;border:0;border-radius:9px;background:var(--accent);box-shadow:none;color:var(--accent-on,#fff);font:inherit;font-size:13.5px;font-weight:600}
</style>
