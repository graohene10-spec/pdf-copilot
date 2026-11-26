<script setup lang="ts">
// 学习对话里的一道题，画在出题的那条回答下面。选项顺序由「回答 id + 题号」定，刷新后不变。
// 摸底的几道题一起交（batch）：卡片自己不带提交键，填了什么随时报给外面。
import { computed, reactive, ref, watch } from 'vue'
import { gradeChoice, shuffledOrder, type Quiz, type QuizAnswer } from '../ai/learning'
import { renderMarkdown } from '../ai/render'

const props = defineProps<{ quiz: Quiz; seed: string; /** 已经答过：读者当时的作答。 */ answered?: QuizAnswer & { correct?: boolean }; disabled?: boolean; batch?: boolean; /** 一起交的几道题里的第几道。 */ number?: number }>()
const emit = defineEmits<{ answer: [answer: QuizAnswer, correct?: boolean]; draft: [answer: QuizAnswer | null, correct?: boolean] }>()

const KIND = { probe: '摸底', predict: '先猜', check: '检查' }
const SURE = ['蒙的', '不太确定', '比较确定', '确定']
const order = computed(() => shuffledOrder(props.seed, props.quiz.options?.length || 0))
const many = computed(() => Array.isArray(props.quiz.answer) && props.quiz.answer.length > 1)
// 检查题先收着：读完讲解再点开。
const opened = ref(props.quiz.kind !== 'check')
const draft = reactive<{ picked: number[]; text: string; thinking: string; sure?: 0 | 1 | 2 | 3; dontKnow: boolean }>({ picked: [], text: '', thinking: '', dontKnow: false })
const done = computed(() => props.answered)
const picked = computed(() => done.value ? done.value.picked || [] : draft.picked)
function pick(index: number) {
  if (done.value) return
  draft.dontKnow = false
  if (!many.value) { draft.picked = [index]; return }
  const at = draft.picked.indexOf(index)
  if (at >= 0) draft.picked.splice(at, 1); else draft.picked.push(index)
}
const ready = computed(() => props.quiz.options ? draft.picked.length > 0 : draft.text.trim().length > 0)
const extra = () => ({ ...(draft.thinking.trim() ? { thinking: draft.thinking.trim() } : {}) })
/** 现在填的这份作答；还没填就是 null。 */
function current(): [QuizAnswer, boolean?] | null {
  if (draft.dontKnow) return [{ dontKnow: true, ...extra() }]
  if (!ready.value) return null
  if (props.quiz.options) return [{ picked: [...draft.picked], ...(draft.sure === undefined ? {} : { sure: draft.sure }), ...extra() }, gradeChoice(props.quiz, draft.picked)]
  return [{ text: draft.text.trim(), ...extra() }]
}
function submit() { const value = current(); if (value && !props.disabled) emit('answer', ...value) }
function dontKnow() {
  if (props.batch) { draft.dontKnow = !draft.dontKnow; if (draft.dontKnow) draft.picked = []; return }
  emit('answer', { dontKnow: true, ...extra() })
}
watch(draft, () => { if (props.batch) { const value = current(); if (value) emit('draft', ...value); else emit('draft', null) } }, { deep: true })
const right = (index: number) => Array.isArray(props.quiz.answer) && props.quiz.answer.includes(index)
const html = (text: string) => renderMarkdown(text)
</script>

<template>
  <section class="quiz" :class="{ done }" :aria-label="`${KIND[quiz.kind]}题`">
    <button v-if="!opened && !done" type="button" class="quiz-open" @click="opened = true">做检查题</button>
    <template v-else>
      <p class="quiz-kind">{{ KIND[quiz.kind] }}<template v-if="number"> {{ number }}</template><template v-if="many && !done"> · 多选</template></p>
      <div class="quiz-question" v-html="html(quiz.question)" />
      <div v-if="quiz.options" class="quiz-options" :role="many ? 'group' : 'radiogroup'">
        <button v-for="index in order" :key="index" type="button" class="quiz-option" :class="{ right: done && right(index), wrong: done && picked.includes(index) && !right(index) }" :role="many ? 'checkbox' : 'radio'" :aria-checked="picked.includes(index)" :disabled="Boolean(done)" @click="pick(index)"><i aria-hidden="true" /><span v-html="html(quiz.options[index]!)" /></button>
      </div>
      <textarea v-else-if="!done" v-model="draft.text" class="quiz-text" rows="3" placeholder="用自己的话回答" aria-label="回答" />
      <template v-if="!done">
        <textarea v-model="draft.thinking" class="quiz-text thinking" rows="2" placeholder="我的想法（可不填）" aria-label="我的想法" />
        <div v-if="quiz.options" class="quiz-sure" role="radiogroup" aria-label="把握程度">
          <button v-for="(label, level) in SURE" :key="label" type="button" role="radio" :aria-checked="draft.sure === level" @click="draft.sure = draft.sure === level ? undefined : level as 0 | 1 | 2 | 3">{{ label }}</button>
        </div>
        <div class="quiz-foot">
          <button type="button" class="quiz-plain" :aria-pressed="batch ? draft.dontKnow : undefined" :disabled="disabled" @click="dontKnow">不知道</button>
          <button v-if="!batch" type="button" class="quiz-submit" :disabled="!ready || disabled" @click="submit">提交</button>
        </div>
      </template>
      <template v-else>
        <p v-if="done.text" class="quiz-said">{{ done.text }}</p>
        <div v-if="!done.skipped" class="quiz-why" v-html="html(typeof quiz.answer === 'string' ? `**参考答案** ${quiz.answer}\n\n${quiz.why}` : quiz.why)" />
      </template>
    </template>
  </section>
</template>

<style scoped>
/* 题目是拿来读和想的：实心底、正文字体，不跟着主题用手写体和玻璃。 */
.quiz{display:flex;flex-direction:column;gap:11px;margin:12px 0 4px;padding:16px;border:1px solid color-mix(in srgb,var(--ink) 22%,transparent);border-radius:12px;background:var(--surface,#fff);color:var(--ink);font-family:var(--font-formal);font-size:15px;line-height:1.65;letter-spacing:0;-webkit-backdrop-filter:none;backdrop-filter:none}
.quiz :is(button,textarea){font-family:var(--font-formal);letter-spacing:0;rotate:none}
.quiz-open{align-self:flex-start;height:32px;padding:0 14px;border:1px solid color-mix(in srgb,var(--ink) 30%,transparent);border-radius:8px;background:none;box-shadow:none;color:var(--ink);font-size:14px}
.quiz-open:hover{border-color:var(--accent)}
.quiz-kind{margin:0;color:var(--secondary);font-size:12.5px;font-weight:600;letter-spacing:.04em}
.quiz-question{font-size:15.5px;font-weight:650;overflow-wrap:anywhere}
.quiz-question :deep(p),.quiz-option :deep(p),.quiz-why :deep(p){margin:0}
.quiz-why :deep(p+p){margin-top:.5em}
.quiz-options{display:flex;flex-direction:column;gap:8px}
.quiz-option{display:flex;align-items:flex-start;gap:11px;height:auto;padding:10px 12px;border:1.5px solid color-mix(in srgb,var(--ink) 26%,transparent);border-radius:9px;background:var(--surface,#fff);box-shadow:none;color:var(--ink);font-size:15px;line-height:1.6;text-align:left;transition:border-color var(--dur-1) var(--ease-soft),background var(--dur-1) var(--ease-soft)}
.quiz-option span{flex:1;min-width:0;white-space:normal;overflow-wrap:anywhere}
.quiz-option:not(:disabled):hover{border-color:color-mix(in srgb,var(--ink) 55%,transparent)}
.quiz-option i{flex:none;width:15px;height:15px;margin-top:5px;border:1.5px solid color-mix(in srgb,var(--ink) 55%,transparent);border-radius:50%}
.quiz-option[role='checkbox'] i{border-radius:3px}
.quiz-option[aria-checked='true']{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 14%,var(--surface,#fff))}
.quiz-option[aria-checked='true'] i{border-color:var(--accent);background:var(--accent);box-shadow:inset 0 0 0 2.5px var(--surface,#fff)}
.quiz-option.right{border-color:#2e9d5c;background:color-mix(in srgb,#2e9d5c 14%,var(--surface,#fff))}
.quiz-option.wrong{border-color:#c9503c;background:color-mix(in srgb,#c9503c 13%,var(--surface,#fff))}
.quiz-option:disabled{opacity:1;cursor:default}
.quiz-text{width:100%;padding:8px 11px;border:1px solid color-mix(in srgb,var(--ink) 26%,transparent);border-radius:8px;background:var(--surface,#fff);box-shadow:none;color:var(--ink);font-size:14.5px;line-height:1.55;outline:0;resize:vertical}
.quiz-text:focus{border-color:var(--accent)}
.quiz-text::placeholder{color:var(--secondary)}
.quiz-sure{display:flex;flex-wrap:wrap;gap:6px}
.quiz-sure button{height:28px;padding:0 10px;border:1px solid color-mix(in srgb,var(--ink) 26%,transparent);border-radius:7px;background:none;box-shadow:none;color:var(--secondary);font-size:13px;white-space:nowrap}
.quiz-sure button[aria-checked='true']{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 14%,var(--surface,#fff));color:var(--ink);font-weight:600}
.quiz-foot{display:flex;align-items:center;justify-content:flex-end;gap:10px}
.quiz-plain{height:32px;padding:0 10px;border:1px solid transparent;border-radius:8px;background:none;box-shadow:none;color:var(--secondary);font-size:14px}
.quiz-plain:hover{color:var(--ink)}
.quiz-plain[aria-pressed='true']{border-color:var(--accent);color:var(--ink);font-weight:600}
.quiz-submit{height:32px;padding:0 18px;border:0;border-radius:8px;background:var(--accent);box-shadow:none;color:var(--accent-on,#fff);font-size:14px;font-weight:600}
.quiz-submit:disabled{opacity:.45}
.quiz-said{margin:0;padding-left:10px;border-left:2px solid color-mix(in srgb,var(--ink) 22%,transparent);color:var(--ink);font-size:14.5px;white-space:pre-wrap}
.quiz-why{color:var(--ink);font-size:14.5px}
</style>
