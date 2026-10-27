export interface QuickPrompt { label: string; question: string }
export type QuickPrompts = [QuickPrompt, QuickPrompt, QuickPrompt]

export const QUICK_PROMPT_LABEL_LIMIT = 12
// Keep this consistent with the existing single-question limit in sendChat.
export const QUICK_PROMPT_QUESTION_LIMIT = 16000
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const DEFAULT_QUICK_PROMPTS: readonly Readonly<QuickPrompt>[] = Object.freeze([
  Object.freeze({ label: '梳理核心观点', question: '概括当前内容的核心观点，并说明它与整篇文档的关系。' }),
  Object.freeze({ label: '解释概念与公式', question: '解释当前页中的关键概念与公式。' }),
  Object.freeze({ label: '查找假设与局限', question: '找出文档中的主要假设、适用条件与局限。' }),
])

export function defaultQuickPrompts(): QuickPrompts {
  return DEFAULT_QUICK_PROMPTS.map(item => ({ ...item })) as QuickPrompts
}
export function quickPromptLabelLength(value: string): number {
  return [...segmenter.segment(value)].length
}
export function limitQuickPromptLabel(value: string): string {
  // Do not trim while typing: spaces within a title should remain editable.
  const singleLine = value.replace(/[\r\n\t]/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '')
  return [...segmenter.segment(singleLine)].slice(0, QUICK_PROMPT_LABEL_LIMIT).map(item => item.segment).join('')
}
function limitQuestion(value: string): string {
  const limited = value.trim().slice(0, QUICK_PROMPT_QUESTION_LIMIT)
  // A corrupted or manually edited stored setting must not split a surrogate pair.
  const last = limited.charCodeAt(limited.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? limited.slice(0, -1) : limited
}
// 旧版默认提示词要求「引用原文」，回答因此很生硬；用户没改过的旧默认值换成新的说法。
const RETIRED: Record<string, string> = {
  '解释当前页中的关键概念与公式，引用原文依据。': '解释当前页中的关键概念与公式。',
  '针对框选的内容解释「为什么」：它为什么成立、为什么这样做，背后的原因、推导或依据是什么。请结合上下文并引用原文。': '针对框选的内容解释「为什么」：它为什么成立、为什么这样做，背后的原因或推导是什么。',
}
const current = (question: string) => RETIRED[question] ?? question
export function normalizeQuickPrompts(value: unknown): QuickPrompts {
  const stored = Array.isArray(value) ? value : []
  return defaultQuickPrompts().map((fallback, index) => {
    const input = stored[index] && typeof stored[index] === 'object' ? stored[index] : {}
    const label = typeof input.label === 'string' ? limitQuickPromptLabel(input.label.trim()).trim() : ''
    const question = typeof input.question === 'string' ? current(limitQuestion(input.question)) : ''
    return { label: label || fallback.label, question: question || fallback.question }
  }) as QuickPrompts
}
// 框选快捷提问：气泡上显示简短的「提问概括」，发送的是完整提示词。数量可在设置中增减。
export const CAPTURE_QUESTION_MIN = 1
export const CAPTURE_QUESTION_MAX = 6
const DEFAULT_CAPTURE_QUESTIONS: readonly Readonly<QuickPrompt>[] = Object.freeze([
  Object.freeze({ label: '为什么？', question: '针对框选的内容解释「为什么」：它为什么成立、为什么这样做，背后的原因或推导是什么。' }),
  Object.freeze({ label: '详细展开', question: '详细展开框选的内容：逐项解释其中的概念、符号、公式或图表要素，补充理解所需的背景，并说明它在上下文中的作用。' }),
  Object.freeze({ label: '通俗解释', question: '用通俗易懂的语言重新解释框选的内容，可以打比方，避免堆砌术语，最后用一句话总结。' }),
  Object.freeze({ label: '举个例子', question: '围绕框选的内容给出一到两个具体例子或数值演算，帮助我理解它如何应用。' }),
])
export function defaultCaptureQuestions(): QuickPrompt[] {
  return DEFAULT_CAPTURE_QUESTIONS.map(item => ({ ...item }))
}
export function newCaptureQuestion(): QuickPrompt {
  return { label: '新的提问', question: '请解释框选的内容。' }
}
export function normalizeCaptureQuestions(value: unknown): QuickPrompt[] {
  if (!Array.isArray(value)) return defaultCaptureQuestions()
  const list = value.slice(0, CAPTURE_QUESTION_MAX).flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const label = typeof item.label === 'string' ? limitQuickPromptLabel(item.label.trim()).trim() : ''
    const question = typeof item.question === 'string' ? current(limitQuestion(item.question)) : ''
    return label && question ? [{ label, question }] : []
  })
  return list.length >= CAPTURE_QUESTION_MIN ? list : defaultCaptureQuestions()
}
export function captureQuestionErrors(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < CAPTURE_QUESTION_MIN || value.length > CAPTURE_QUESTION_MAX) return [`框选提问须有 ${CAPTURE_QUESTION_MIN}–${CAPTURE_QUESTION_MAX} 个。`]
  const errors: string[] = []
  value.forEach((item, index) => {
    const name = `框选提问 ${index + 1}`
    if (typeof item?.label !== 'string' || !item.label.trim()) errors.push(`${name}：请填写提问概括。`)
    else if (quickPromptLabelLength(item.label) > QUICK_PROMPT_LABEL_LIMIT || /[\u0000-\u001f\u007f]/.test(item.label)) errors.push(`${name}：提问概括须为 ${QUICK_PROMPT_LABEL_LIMIT} 字以内的单行文字。`)
    if (typeof item?.question !== 'string' || !item.question.trim()) errors.push(`${name}：请填写提问内容。`)
    else if (item.question.length > QUICK_PROMPT_QUESTION_LIMIT) errors.push(`${name}：提问内容须在 ${QUICK_PROMPT_QUESTION_LIMIT} 个字符以内。`)
  })
  return errors
}
export function quickPromptErrors(value: unknown): string[] {
  if (!Array.isArray(value) || value.length !== DEFAULT_QUICK_PROMPTS.length) return ['快捷提问须包含三个按钮。']
  const errors: string[] = []
  value.forEach((item, index) => {
    const name = `快捷提问 ${index + 1}`
    if (typeof item?.label !== 'string' || !item.label.trim()) errors.push(`${name}：请填写按钮介绍。`)
    else if (quickPromptLabelLength(item.label) > QUICK_PROMPT_LABEL_LIMIT || /[\u0000-\u001f\u007f]/.test(item.label)) errors.push(`${name}：按钮介绍须为 ${QUICK_PROMPT_LABEL_LIMIT} 字以内的单行文字。`)
    if (typeof item?.question !== 'string' || !item.question.trim()) errors.push(`${name}：请填写提示词。`)
    else if (item.question.length > QUICK_PROMPT_QUESTION_LIMIT) errors.push(`${name}：提示词须在 ${QUICK_PROMPT_QUESTION_LIMIT} 个字符以内。`)
  })
  return errors
}
