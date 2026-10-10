<script setup lang="ts">
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { renderMessage } from '../../../extension/chat/math.mjs'
import { getProvider } from '../ai/providers.mjs'
import { chatState, sendChat, stopChat, configureRequests, taskSummary, type Message } from '../ai/workspace'
import { loadAiSettings } from '../ai/settings.mjs'

const props = defineProps<{ document: { id: string; title: string; kind: string }; context: any; sendShortcut?: string; consumeCapture?: (value: { documentId: string; selection: any }) => void }>()
const emit = defineEmits<{ jump: [value: { page: number; rect?: any; line?: number }]; close: []; settings: []; error: [value: string]; clearSelection: [] }>()
const settings = ref<any>(loadAiSettings())
const state = shallowRef(chatState(props.document.id))
const messages = computed(() => state.value.messages)
const prompt = computed({ get: () => state.value.draft, set: value => { state.value.draft = value } })
const busy = computed(() => Boolean(state.value.request))
const status = computed(() => state.value.status)
const statusError = computed(() => state.value.error)
const includeDocument = computed({ get: () => state.value.includeDocument, set: value => { state.value.includeDocument = value } })
const includeSelection = computed({ get: () => state.value.includeSelection, set: value => { state.value.includeSelection = value } })
const messageList = ref<HTMLElement>()
const input = ref<HTMLTextAreaElement>()
let renderFrame = 0
const providerSummary = computed(() => `${getProvider(settings.value.provider)?.name || 'AI'} · ${settings.value.model || '默认模型'}`)
const selected = computed(() => props.context?.selection || {})
const hasSelection = computed(() => Boolean(selected.value.text || selected.value.image))
function restoreScroll() { if (messageList.value) messageList.value.scrollTop = state.value.scrollTop }
watch(() => props.document.id, (id) => {
  rememberScroll()
  state.value = chatState(id)
  settings.value = loadAiSettings()
  void nextTick(() => { if (id === props.document.id) restoreScroll() })
}, { flush: 'sync' })
watch(() => props.context?.selection, selection => { includeSelection.value = Boolean(selection?.text || selection?.image) }, { immediate: true })
function rememberScroll() { if (messageList.value) state.value.scrollTop = messageList.value.scrollTop }
watch(() => [props.document.id, messages.value.at(-1)?.id, messages.value.at(-1)?.content], (value, previous) => { if (value[0] === previous[0]) scheduleScroll() })
onMounted(restoreScroll)
function focusPrompt() { void nextTick(() => input.value?.focus()) }
function jump(source: any) { emit('jump', { page: source.page, rect: source.rect, ...(source.line ? { line: source.line } : {}) }) }
function renderAnswer(element: HTMLElement, message: Message) {
  renderMessage(element, message.content, katex)
  const sourceMap = new Map(message.sources.map(source => [source.sourceId, source]))
  if (!sourceMap.size) return
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), nodes: Node[] = []
  while (walker.nextNode()) if (!(walker.currentNode.parentElement?.closest('.message-code,.message-math,button'))) nodes.push(walker.currentNode)
  for (const node of nodes) {
    const text = node.textContent || '', pattern = /\[(S[a-zA-Z0-9]+-\d+)\]/g, fragment = document.createDocumentFragment()
    let match: RegExpExecArray | null, last = 0
    while ((match = pattern.exec(text))) {
      const source: any = sourceMap.get(match[1]); if (!source) continue
      fragment.append(document.createTextNode(text.slice(last, match.index)))
      const button = document.createElement('button')
      button.className = 'inline-citation'; button.textContent = source.line ? `第 ${source.line} 行` : `第 ${source.page} 页`; button.title = source.text
      button.onclick = () => jump(source); fragment.append(button); last = pattern.lastIndex
    }
    if (last) { fragment.append(document.createTextNode(text.slice(last))); node.parentNode?.replaceChild(fragment, node) }
  }
}
const vAnswer = { mounted: (el: HTMLElement, binding: any) => renderAnswer(el, binding.value), updated: (el: HTMLElement, binding: any) => renderAnswer(el, binding.value) }
function scroll() { nextTick(() => { if (messageList.value) messageList.value.scrollTop = messageList.value.scrollHeight }) }
function scheduleScroll() { if (!renderFrame) renderFrame = requestAnimationFrame(() => { renderFrame = 0; scroll() }) }
function stop() { stopChat(props.document.id) }
function clear() { if (!busy.value) { state.value.messages = []; state.value.draft = ''; state.value.status = '' } }
function applySettings(value: any) { settings.value = value; configureRequests(value); state.value.status = 'AI 设置已保存。'; state.value.error = false }
async function copy(text: string) {
  try { await navigator.clipboard.writeText(text) } catch { state.value.status = '复制失败，请手动选择文字。'; state.value.error = true }
}
function send() {
  const id = props.document.id
  const selection = props.context?.selection
  const usesImage = includeSelection.value && Boolean(selection?.image)
  const consumeCapture = props.consumeCapture
  return sendChat({ ...props.document }, { ...props.context }, () => { if (id === props.document.id) emit('settings') }, () => {
    // The request can be accepted after this pane closes or switches files.
    if (usesImage) consumeCapture?.({ documentId: id, selection })
  })
}
onBeforeUnmount(() => { rememberScroll(); if (renderFrame) cancelAnimationFrame(renderFrame) })
defineExpose({ send, stop, applySettings, focusPrompt })
</script>

<template>
  <aside class="ai-pane" aria-label="AI 阅读助手">
      <div class="model-bar"><span class="model-summary" :title="providerSummary">{{ providerSummary }}</span><span v-if="taskSummary.running || taskSummary.queued" class="task-summary" :title="`同时最多 ${taskSummary.limits.concurrent} 题，Codex ${taskSummary.limits.codex} 题`">{{ taskSummary.running }} 运行<template v-if="taskSummary.queued"> · {{ taskSummary.queued }} 等待</template></span><button class="secondary-action model-change" title="AI 设置" data-glass-interactive :disabled="busy" @click="emit('settings')">更改</button><button class="close-assistant" title="关闭阅读助手" aria-label="关闭阅读助手" data-glass-interactive @click="emit('close')">×</button></div>
      <div ref="messageList" class="ai-messages" aria-live="polite" @scroll="rememberScroll">
        <div v-if="!messages.length" class="ai-welcome"><p>可询问当前内容，也可选取文字或框选图表。</p><div class="suggestions"><button @click="prompt = '概括当前内容的核心观点，并说明它与整篇文档的关系。'">梳理核心观点</button><button @click="prompt = '解释当前页中的关键概念与公式，引用原文依据。'">解释概念与公式</button><button @click="prompt = '找出文档中的主要假设、适用条件与局限。'">查找假设与局限</button></div></div>
        <article v-for="message in messages" :key="message.id" class="ai-message" :class="message.role">
          <div class="message-label"><strong>{{ message.role === 'user' ? '你' : '阅读助手' }}</strong><button v-if="message.content" @click="copy(message.content)">复制</button></div>
          <details v-if="message.reasoning" class="reasoning"><summary>思考过程</summary><p>{{ message.reasoning }}</p></details>
          <div v-if="message.role === 'assistant'" v-answer="message" class="answer-body" />
          <p v-else class="user-question">{{ message.content }}</p>
          <details v-if="message.sources.length" class="source-list"><summary>参考原文 · {{ message.sources.length }} 段</summary><button v-for="source in message.sources" :key="source.sourceId" @click="jump(source)"><span>{{ source.line ? `第 ${source.line} 行` : `第 ${source.page} 页` }}</span><small>{{ source.text }}</small></button></details>
        </article>
      </div>
      <div class="ai-composer">
        <div v-if="hasSelection" class="ai-selection-context"><div class="context-heading"><label><input v-model="includeSelection" type="checkbox" :disabled="busy" />{{ selected.image ? `使用第 ${selected.page} 页截图` : '使用所选文字' }}</label><button class="reset-button" @click="emit('clearSelection')" title="清除选区">×</button></div><p v-if="selected.text">{{ selected.text.slice(0, 140) }}</p><img v-if="selected.image" :src="selected.image" alt="选取的截图预览" /></div>
        <label class="document-context"><input v-model="includeDocument" type="checkbox" :disabled="busy" /> 当前页上下文与文档检索</label>
        <textarea ref="input" v-model="prompt" rows="3" placeholder="询问这份文档…" aria-label="向 AI 提问" />
        <div class="composer-actions"><button class="reset-button secondary-action clear-conversation" data-glass-interactive :disabled="busy || !messages.length" @click="clear">清空对话</button><span v-if="sendShortcut" :title="sendShortcut">{{ sendShortcut }}</span><button v-if="busy" class="send-button stop" @click="stop">停止</button><button v-else class="send-button" :disabled="!prompt.trim()" @click="send">发送 ↑</button></div>
        <p v-if="status" class="ai-status" :class="{ error: statusError }" role="status">{{ status }}</p>
      </div>
  </aside>
</template>

<style scoped>
/* 阅读助手：厚玻璃面板，浮在阅读区右侧。
   玻璃只作用于面板自身，消息正文保持实底文字，对比度不打折。 */
.ai-pane{display:flex;flex-direction:column;height:100%;min-width:290px;width:360px;flex-shrink:0;background-color:var(--glass-2);background-image:var(--glass-sheen);-webkit-backdrop-filter:blur(var(--glass-2-blur)) saturate(var(--glass-sat));backdrop-filter:blur(var(--glass-2-blur)) saturate(var(--glass-sat));border-left:1px solid var(--line);border-radius:0;box-shadow:var(--shadow-pane);color:var(--ink);overflow:hidden}
button{font:inherit;cursor:pointer;color:var(--control-ink)}
.model-bar{display:flex;gap:8px;align-items:center;flex-shrink:0;padding:10px 14px;border-bottom:1px solid var(--line);font-size:11px;color:var(--muted);background:color-mix(in srgb,var(--accent) 4%,transparent)}
.model-summary{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.model-bar .task-summary{flex:0 0 auto;padding:3px 5px;border:1px solid color-mix(in srgb,var(--accent) 15%,transparent);border-radius:0;background:color-mix(in srgb,var(--accent) 7%,transparent);font-size:10px;color:var(--secondary);white-space:nowrap}
.model-bar button,.message-label button,.reset-button{font-size:11px;border:0;background:none;color:var(--control-ink);padding:0;border-radius:var(--r-xs);transition:background-color var(--dur-1) var(--ease-soft)}
.model-bar button:hover:not(:disabled),.message-label button:hover:not(:disabled),.reset-button:hover:not(:disabled){background-color:var(--control-hover);color:var(--control-ink)}
.model-bar .close-assistant{flex:0 0 32px;width:32px;height:32px;padding:0;border:1px solid var(--glass-outline);border-radius:0;background-color:var(--glass-1);background-image:var(--glass-sheen);box-shadow:var(--glass-control-shadow);font-size:20px;line-height:20px;color:var(--control-ink)}
.model-bar .close-assistant:hover:not(:disabled){background-color:var(--control-hover);border-color:var(--glass-outline);color:var(--control-ink)}
/* 设置入口与清空动作保持完整的命中面积；选区 × 继续使用紧凑的 reset-button。 */
.model-bar .secondary-action,.composer-actions .secondary-action{flex-shrink:0;min-height:36px;padding:7px 12px;border:1px solid var(--glass-outline);border-radius:0;background-color:var(--glass-2);background-image:var(--glass-sheen);box-shadow:var(--glass-control-shadow);font-size:12px;font-weight:550;line-height:20px;color:var(--control-ink);white-space:nowrap;transition:background-color var(--dur-1) var(--ease-soft),border-color var(--dur-1) var(--ease-soft),box-shadow var(--dur-1) var(--ease-soft)}
.model-bar .secondary-action:hover:not(:disabled),.composer-actions .secondary-action:hover:not(:disabled){background-color:var(--control-hover);border-color:var(--glass-outline);color:var(--control-ink)}
.model-bar .secondary-action:active:not(:disabled),.composer-actions .secondary-action:active:not(:disabled){box-shadow:var(--glass-pressed-shadow)}
.ai-messages{flex:1;overflow:auto;padding:22px;min-height:0}
.ai-welcome{padding-top:38px}
.ai-welcome p{font-size:13px;line-height:1.9;color:var(--muted);margin:0}
.suggestions{display:flex;flex-direction:column;align-items:flex-start;gap:8px;margin-top:23px}
/* 建议按钮用中档玻璃，与面板区分层次，同时保持可点性明确。 */
.suggestions button{font-size:12px;background-color:var(--glass-2);background-image:var(--glass-sheen);color:var(--control-ink);border:1px solid var(--line);padding:9px 12px;border-radius:var(--r-sm);box-shadow:var(--glass-control-shadow);transition:background-color var(--dur-1) var(--ease-soft),box-shadow var(--dur-1) var(--ease-soft),transform var(--dur-1) var(--ease-out)}
.suggestions button:hover:not(:disabled){background-color:var(--control-hover);color:var(--control-ink);transform:translateX(2px)}
.ai-message{margin-bottom:28px;animation:zg-rise-in var(--dur-3) var(--ease-out) both}
.message-label{display:flex;justify-content:space-between;align-items:center;font-size:11px;margin-bottom:12px;color:var(--muted)}
.message-label strong{font-weight:500}
.user-question,.answer-body{font-size:13px;line-height:1.9;margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
/* 用户气泡用墨绿软底，与助手的白底回答在视觉上分开。 */
.user .user-question{padding:12px 14px;background:var(--accent-soft);border:1px solid color-mix(in srgb,var(--accent) 14%,transparent);border-radius:var(--r-md);color:var(--surface-ink);text-shadow:none}
.answer-body :deep(.inline-citation){border:0;border-radius:var(--r-xs);padding:2px 6px;margin:0 2px;font-size:10px;background:var(--control-selected);color:var(--control-ink);font-weight:550;transition:background var(--dur-1) var(--ease-soft)}
.answer-body :deep(.inline-citation:hover){background:var(--control-selected-hover);color:var(--control-ink)}
.answer-body :deep(.message-code){font-size:12px;border-radius:var(--r-xs);background:var(--surface-3);color:var(--surface-ink);text-shadow:none;padding:3px 5px;white-space:pre-wrap;font-family:var(--font-mono)}
.answer-body :deep(pre.message-code){padding:12px;overflow:auto}
.answer-body :deep(.display-math){overflow:auto}
.answer-body :deep(.katex){font-size:1.1em}
.reasoning,.source-list{font-size:11px;color:var(--muted);margin:8px 0 13px}
.reasoning summary,.source-list summary{cursor:pointer;color:var(--control-ink);transition:background-color var(--dur-1) var(--ease-soft)}
.reasoning summary:hover,.source-list summary:hover{background-color:var(--control-hover);color:var(--control-ink)}
.reasoning p{white-space:pre-wrap;line-height:1.8}
.source-list button{display:block;text-align:left;border:1px solid var(--line);border-radius:var(--r-sm);background-color:var(--glass-2);background-image:var(--glass-sheen);width:100%;color:var(--control-ink);padding:9px;margin-top:8px;transition:background var(--dur-1) var(--ease-soft)}
.source-list button:hover:not(:disabled){background:var(--control-hover);color:var(--control-ink)}
.source-list span{font-size:11px;color:var(--control-ink);font-weight:550}
.source-list small{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;margin-top:5px;font-size:11px;line-height:1.7}
.ai-composer{padding:15px 18px 18px;border-top:1px solid var(--line);flex-shrink:0;background:color-mix(in srgb,var(--accent) 3%,transparent)}
.document-context,.ai-selection-context label{font-size:11px;color:var(--muted);display:flex;align-items:center;gap:7px;line-height:1.7}
.document-context input,.ai-selection-context input{margin:0;accent-color:var(--accent)}
textarea{box-sizing:border-box;width:100%;resize:vertical;max-height:180px;min-height:70px;background-color:var(--glass-2);background-image:var(--glass-sheen);border:1px solid var(--line);color:var(--control-ink);border-radius:var(--r-md);font:inherit;font-size:13px;line-height:1.6;padding:12px;margin-top:12px;outline:none;box-shadow:var(--glass-edge);transition:border-color var(--dur-1) var(--ease-soft),box-shadow var(--dur-1) var(--ease-soft)}
textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-ring),var(--glass-edge)}
.composer-actions{display:flex;align-items:center;gap:8px;min-width:0;margin-top:10px}
.composer-actions span{flex:1;min-width:0;margin-left:auto;font-size:10px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right}
/* 发送键用轻微灰度底色强调，文字与其他按键保持一致。 */
.send-button{flex-shrink:0;white-space:nowrap;border:1px solid var(--glass-outline);border-radius:var(--r-sm);color:var(--control-ink);background-color:var(--control-selected);background-image:var(--glass-sheen);padding:8px 13px;font-size:12px;font-weight:550;box-shadow:var(--glass-control-shadow);transition:background-color var(--dur-1) var(--ease-soft),box-shadow var(--dur-1) var(--ease-soft)}
.send-button:hover:not(:disabled){background-color:var(--control-selected-hover);color:var(--control-ink);box-shadow:var(--glass-control-shadow)}
.send-button.stop{background-color:color-mix(in srgb,var(--danger) 12%,var(--glass-2));border-color:color-mix(in srgb,var(--danger) 35%,var(--glass-outline));color:var(--control-ink);box-shadow:none}
.send-button.stop:hover:not(:disabled){background-color:color-mix(in srgb,var(--danger) 18%,var(--glass-2));color:var(--control-ink)}
button:disabled{opacity:.4;cursor:default}
.ai-status{font-size:11px;line-height:1.6;color:var(--muted);margin:12px 0 0;overflow-wrap:anywhere}
.ai-status.error{color:var(--danger)}
.ai-selection-context{--ink:var(--surface-ink);--control-ink:var(--surface-ink);--secondary:var(--surface-secondary);--muted:var(--surface-muted);--control-hover:color-mix(in srgb,var(--surface-ink) 7%,var(--surface-2));--glass-label-shadow:none;padding:9px;background:var(--surface-2);color:var(--surface-ink);text-shadow:none;border:1px solid var(--line);border-radius:var(--r-sm);margin-bottom:10px}
.ai-selection-context p{font-size:11px;line-height:1.6;margin:5px 0 0;color:var(--muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ai-selection-context img{max-height:90px;max-width:100%;object-fit:contain;margin-top:6px;border-radius:var(--r-xs)}
@media(prefers-reduced-motion:reduce){.ai-message{animation:none}}
</style>
