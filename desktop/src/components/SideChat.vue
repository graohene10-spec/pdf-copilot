<script setup lang="ts">
// 侧边对话（像 Codex 的侧边提问）：挂在一段主对话旁边，围绕从回答里选出来的片段追问，不打断主线。
// 数据是一段独立保存的对话（sideOf 指向主对话），换回这段主对话时侧边的内容还在。
import { computed, nextTick, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { renderMarkdown } from '../ai/render'
import { sendChat, stopChat, sideConversation } from '../ai/workspace'

const props = defineProps<{ document: { id: string; title: string; kind: string }; mainId: string; context: any }>()
const emit = defineEmits<{ close: []; settings: [] }>()
const quote = defineModel<string>('quote', { default: '' })
const state = computed(() => sideConversation(props.document.id, props.mainId, true)!)
const messages = computed(() => state.value.messages)
const busy = computed(() => Boolean(state.value.request))
const draft = computed({ get: () => state.value.draft, set: value => { state.value.draft = value } })
const list = ref<HTMLElement>()
const input = ref<HTMLTextAreaElement>()

watch(() => [messages.value.length, messages.value.at(-1)?.content.length], () => {
  void nextTick(() => { const element = list.value; if (element) element.scrollTop = element.scrollHeight })
}, { immediate: true })

function send() {
  const question = draft.value.trim()
  if (!question || busy.value) return
  const sentQuote = quote.value
  void sendChat({ ...props.document }, { ...props.context, selection: {} }, () => emit('settings'), () => { if (quote.value === sentQuote) quote.value = ''; if (draft.value.trim() === question) draft.value = '' }, question, { conversationId: state.value.id, includeDocument: false, includeSelection: false, quote: sentQuote })
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); send() }
}
const live = (index: number) => busy.value && index === messages.value.length - 1 && messages.value[index]!.role === 'assistant' && !messages.value[index]!.finishedAt
function focus() { void nextTick(() => input.value?.focus()) }
defineExpose({ focus, list })
</script>

<template>
  <section class="side-chat" aria-label="侧边对话">
    <header class="side-head">
      <span class="side-title"><AppIcon name="branch" :size="13" />侧边对话</span>
      <span class="side-hint">选中回答里的文字可以接着问</span>
      <button type="button" class="side-icon" aria-label="收起侧边对话" data-tip="收起侧边对话（内容会保留）" @click="emit('close')"><AppIcon name="close" :size="13" /></button>
    </header>
    <div ref="list" class="side-list" data-glass-still>
      <p v-if="!messages.length" class="side-empty">在左边的回答里选中一段，点「在侧边对话提问」或按 <kbd>Ctrl</kbd> + <kbd>→</kbd>，就在这里接着问，不打断主对话。</p>
      <article v-for="(message, index) in messages" :key="message.id" class="side-message" :class="message.role" :data-id="message.id">
        <template v-if="message.role === 'user'">
          <p v-if="message.ask?.quote" class="side-quote">{{ message.ask.quote }}</p>
          <div class="side-question">{{ message.content }}</div>
        </template>
        <template v-else>
          <p v-if="live(index) && !message.content" class="side-thinking"><span></span><span></span><span></span></p>
          <div v-if="message.content" class="side-answer answer-body" v-html="renderMarkdown(message.content)"></div>
          <p v-if="message.failed && !message.stopped" class="side-error">未完成</p>
        </template>
      </article>
      <p v-if="state.error" class="side-error">{{ state.status }}</p>
    </div>
    <div class="side-composer">
      <div v-if="quote" class="side-chip"><AppIcon name="branch" :size="11" /><span>{{ quote }}</span><button type="button" aria-label="移除引用" data-tip="移除引用" @click="quote = ''"><AppIcon name="close" :size="10" /></button></div>
      <textarea ref="input" v-model="draft" rows="2" placeholder="追问这一段…" aria-label="在侧边对话提问" @keydown="keydown"></textarea>
      <button v-if="busy" type="button" class="side-send stop" aria-label="停止" data-tip="停止" @click="stopChat(document.id, state.id)"><span class="stop-square"></span></button>
      <button v-else type="button" class="side-send" :disabled="!draft.trim()" aria-label="发送到侧边对话" data-tip="发送" @click="send"><AppIcon name="arrow-up" :size="15" /></button>
    </div>
  </section>
</template>

<style scoped>
.side-chat{display:flex;flex-direction:column;min-width:0;min-height:0;height:100%}
.side-head{display:flex;align-items:center;gap:8px;height:36px;padding:0 8px 0 14px;flex-shrink:0;color:var(--secondary);font-size:12px}
.side-title{display:inline-flex;align-items:center;gap:6px;font-weight:650;color:var(--ink)}
.side-hint{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-size:11px}
.side-icon{display:grid;place-items:center;width:24px;height:24px;padding:0;border:0;border-radius:7px;background:none;box-shadow:none;color:var(--secondary)}
.side-icon:hover{background:color-mix(in srgb,var(--ink) 8%,transparent);color:var(--ink)}
.side-list{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:8px 16px 8px 14px;scrollbar-width:none;will-change:transform}
.side-empty{margin:28% 6px 0;color:var(--muted);font-size:12.5px;line-height:1.7;text-align:center}
.side-empty kbd{padding:0 4px;border-radius:4px;background:color-mix(in srgb,var(--ink) 8%,transparent);font-size:11px}
.side-message{margin-bottom:16px;animation:side-in var(--dur-3) var(--ease-out) backwards}
@keyframes side-in{from{opacity:0;translate:0 8px}}
.side-quote{margin:0 0 6px auto;max-width:92%;padding:4px 9px;border-left:2px solid color-mix(in srgb,var(--accent) 60%,transparent);color:var(--secondary);font-size:12px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap}
.side-question{margin-left:auto;width:fit-content;max-width:92%;padding:7px 12px;border-radius:14px 14px 4px 14px;background:color-mix(in srgb,var(--ink) 7%,transparent);font-size:13.5px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}
.side-answer{font-size:14px;line-height:1.7;overflow-wrap:anywhere;font-family:var(--font-answer, var(--font-reading))}
.side-answer :deep(>:first-child){margin-top:0}
.side-answer :deep(>:last-child){margin-bottom:0}
.side-thinking{display:flex;gap:4px;margin:4px 0}
.side-thinking span{width:5px;height:5px;border-radius:50%;background:var(--muted);animation:side-blink 1.1s ease-in-out infinite}
.side-thinking span:nth-child(2){animation-delay:.15s}.side-thinking span:nth-child(3){animation-delay:.3s}
@keyframes side-blink{0%,100%{opacity:.25}50%{opacity:1}}
.side-error{color:var(--danger);font-size:12px}
.side-composer{position:relative;flex-shrink:0;margin:6px 10px 10px;border-radius:14px;border:.5px solid var(--hairline,var(--line-soft));background:var(--bar-glass,color-mix(in srgb,var(--surface) 80%,transparent))}
.side-chip{display:flex;align-items:center;gap:5px;margin:7px 8px 0;padding:3px 6px 3px 8px;border-radius:8px;background:color-mix(in srgb,var(--accent) 10%,transparent);color:var(--secondary);font-size:11.5px}
.side-chip span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.side-chip button{display:grid;place-items:center;width:16px;height:16px;padding:0;border:0;border-radius:50%;background:none;box-shadow:none;color:inherit}
.side-composer textarea{display:block;width:100%;min-height:52px;max-height:160px;padding:9px 42px 9px 12px;border:0;background:none;resize:none;color:var(--ink);font:inherit;font-size:13.5px;line-height:1.5;outline:none}
.side-send{position:absolute;right:7px;bottom:7px;display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:50%;background:var(--ink);color:var(--surface);box-shadow:none}
.side-send:disabled{opacity:.3}
.side-send.stop .stop-square{width:9px;height:9px;border-radius:2px;background:currentColor}
@media(prefers-reduced-motion:reduce){.side-message,.side-thinking span{animation:none}}
</style>
