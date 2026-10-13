export interface QuickPrompt { label: string; question: string }
export type QuickPrompts = [QuickPrompt, QuickPrompt, QuickPrompt]

export const QUICK_PROMPT_LABEL_LIMIT = 12
// Keep this consistent with the existing single-question limit in sendChat.
export const QUICK_PROMPT_QUESTION_LIMIT = 16000
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const DEFAULT_QUICK_PROMPTS: readonly Readonly<QuickPrompt>[] = Object.freeze([
  Object.freeze({ label: '梳理核心观点', question: '概括当前内容的核心观点，并说明它与整篇文档的关系。' }),
  Object.freeze({ label: '解释概念与公式', question: '解释当前页中的关键概念与公式，引用原文依据。' }),
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
export function normalizeQuickPrompts(value: unknown): QuickPrompts {
  const stored = Array.isArray(value) ? value : []
  return defaultQuickPrompts().map((fallback, index) => {
    const input = stored[index] && typeof stored[index] === 'object' ? stored[index] : {}
    const label = typeof input.label === 'string' ? limitQuickPromptLabel(input.label.trim()).trim() : ''
    const question = typeof input.question === 'string' ? limitQuestion(input.question) : ''
    return { label: label || fallback.label, question: question || fallback.question }
  }) as QuickPrompts
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
