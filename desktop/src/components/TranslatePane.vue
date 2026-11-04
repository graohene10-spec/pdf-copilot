<script setup lang="ts">
// 左侧的翻译栏：像阅读助手一样的一列，译文按卡片从上往下排，底下可以直接输入要翻译的文字。
// 与阅读助手共用外壳的主题样式（.ai-pane），内部元素用 tp- 前缀，互不干扰。
import { nextTick, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { renderMarkdown } from '../ai/render'
import { translator, translate, stopTranslation, removeTranslation, clearTranslations, TARGETS, type Translation } from '../ai/translate'

defineProps<{ shortcut?: string }>()
const emit = defineEmits<{ close: [] }>()
const draft = ref('')
const list = ref<HTMLElement>()
const field = ref<HTMLTextAreaElement>()
const copied = ref('')
const LABEL: Record<string, string> = { zh: '中文', en: 'English', ja: '日本語' }

// 新译文出现、或正在翻译的那条变长时，滚到底部。
watch(() => [translator.items.length, translator.items.at(-1)?.result.length], () => {
  void nextTick(() => { const element = list.value; if (element) element.scrollTop = element.scrollHeight })
}, { immediate: true })

function submit() {
  const text = draft.value.trim()
  if (!text) return
  draft.value = ''
  void translate(text)
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); submit() }
  else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); emit('close') }
}
async function copy(item: Translation) {
  try { await navigator.clipboard.writeText(item.result); copied.value = item.id; setTimeout(() => { if (copied.value === item.id) copied.value = '' }, 1400) } catch { /* 剪贴板不可用时什么也不做 */ }
}
function again(item: Translation) { void translate(item.source) }
function focus() { void nextTick(() => field.value?.focus()) }
defineExpose({ focus })
</script>

<template>
  <aside class="ai-pane translate-pane" role="complementary" aria-label="翻译">
    <header class="tp-header">
      <span class="tp-title"><AppIcon name="translate" :size="17" />翻译</span>
      <div class="tp-targets" role="radiogroup" aria-label="译成">
        <button v-for="item in TARGETS" :key="item.value" type="button" role="radio" :aria-checked="translator.target === item.value" :class="{ on: translator.target === item.value }" @click="translator.target = item.value">{{ item.label }}</button>
      </div>
      <button type="button" class="tp-icon" :disabled="!translator.items.length" aria-label="清空翻译记录" data-tip="清空翻译记录" @click="clearTranslations"><AppIcon name="trash" :size="15" /></button>
      <button type="button" class="tp-icon" aria-label="关闭翻译栏" data-tip="关闭翻译栏" :data-tip-key="shortcut" @click="emit('close')"><AppIcon name="close" :size="15" /></button>
    </header>

    <div ref="list" class="tp-list" data-glass-still>
      <div v-if="!translator.items.length" class="tp-empty">
        <AppIcon name="translate" :size="34" />
        <p>在文档里选中一段文字，右键选「机翻」<template v-if="shortcut">，或按 <kbd>{{ shortcut }}</kbd></template>。</p>
        <p class="tp-muted">也可以把文字粘贴到下面的输入框里。</p>
      </div>
      <article v-for="item in translator.items" :key="item.id" class="tp-card" :class="item.status">
        <p class="tp-source" :title="item.source">{{ item.source }}</p>
        <div class="tp-arrow" aria-hidden="true"><span>{{ LABEL[item.target] }}</span></div>
        <div v-if="item.result" class="tp-result" v-html="renderMarkdown(item.result)"></div>
        <p v-else-if="item.status === 'running'" class="tp-pending"><span class="tp-dot"></span><span class="tp-dot"></span><span class="tp-dot"></span></p>
        <p v-if="item.status === 'error'" class="tp-error">{{ item.error || '翻译失败' }}</p>
        <div class="tp-actions">
          <button v-if="item.status === 'running'" type="button" class="tp-icon" aria-label="停止" data-tip="停止" @click="stopTranslation(item.id)"><AppIcon name="stop" :size="14" /></button>
          <template v-else>
            <button type="button" class="tp-icon" :disabled="!item.result" :aria-label="copied === item.id ? '已复制' : '复制译文'" :data-tip="copied === item.id ? '已复制' : '复制译文'" @click="copy(item)"><AppIcon :name="copied === item.id ? 'check' : 'copy'" :size="14" /></button>
            <button type="button" class="tp-icon" aria-label="重新翻译" data-tip="按当前语言重新翻译" @click="again(item)"><AppIcon name="retry" :size="14" /></button>
          </template>
          <button type="button" class="tp-icon" aria-label="删除这条" data-tip="删除这条" @click="removeTranslation(item.id)"><AppIcon name="close" :size="14" /></button>
        </div>
      </article>
    </div>

    <form class="tp-composer" @submit.prevent="submit">
      <textarea ref="field" v-model="draft" rows="3" placeholder="输入或粘贴要翻译的文字，回车翻译" aria-label="要翻译的文字" @keydown="keydown"></textarea>
      <button type="submit" class="tp-send" :disabled="!draft.trim()" aria-label="开始翻译" data-tip="翻译（回车）"><AppIcon name="arrow-up" :size="16" /></button>
    </form>
  </aside>
</template>

<style scoped>
.translate-pane{display:flex;flex-direction:column;width:100%;height:100%;min-width:0;background-color:var(--glass-3);background-image:var(--glass-sheen);-webkit-backdrop-filter:var(--glass-filter-3);backdrop-filter:var(--glass-filter-3);border:1px solid var(--glass-outline);border-radius:var(--r-xl);box-shadow:var(--shadow-pane),var(--glass-edge);color:var(--ink);overflow:hidden;font-family:var(--font-ui)}
.tp-header{display:flex;align-items:center;gap:6px;height:52px;padding:0 10px 0 16px;border-bottom:.5px solid var(--hairline,var(--line-soft));flex-shrink:0}
.tp-title{display:inline-flex;align-items:center;gap:7px;font-weight:650;font-size:14px;margin-right:auto;white-space:nowrap}
.tp-targets{display:flex;gap:2px;padding:2px;border-radius:var(--r-control);background:color-mix(in srgb,var(--surface-ink) 6%,transparent)}
.tp-targets button{height:24px;padding:0 8px;border:0;border-radius:calc(var(--r-control) - 2px);background:none;box-shadow:none;font-size:11.5px;color:var(--secondary);white-space:nowrap}
.tp-targets button.on{background:var(--surface);color:var(--surface-ink);box-shadow:0 1px 2px rgb(0 0 0 / .12)}
.tp-icon{display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:8px;background:none;box-shadow:none;color:var(--secondary)}
.tp-icon:hover:not(:disabled){background:color-mix(in srgb,var(--surface-ink) 8%,transparent);color:var(--ink)}
.tp-icon:disabled{opacity:.4}
.tp-list{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:14px 14px 6px;scrollbar-width:thin;will-change:transform}
.tp-empty{display:grid;justify-items:center;gap:8px;margin-top:22vh;padding:0 18px;text-align:center;color:var(--secondary);font-size:13px;line-height:1.6}
.tp-empty p{margin:0}
.tp-muted{color:var(--muted)}
.tp-empty kbd{padding:1px 5px;border-radius:5px;background:color-mix(in srgb,var(--surface-ink) 8%,transparent);font-size:11px}
.tp-card{position:relative;margin-bottom:12px;padding:11px 13px 8px;border-radius:12px;background:color-mix(in srgb,var(--surface) 72%,transparent);border:.5px solid var(--line-soft);animation:tp-in var(--dur-3) var(--spring-snappy) backwards}
@keyframes tp-in{from{opacity:0;translate:0 10px;scale:.98}}
.tp-source{margin:0;color:var(--secondary);font-size:12.5px;line-height:1.55;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap}
.tp-arrow{display:flex;align-items:center;gap:8px;margin:7px 0 5px;color:var(--muted);font-size:10.5px;letter-spacing:.04em}
.tp-arrow::before,.tp-arrow::after{content:'';flex:1;height:.5px;background:var(--line-soft)}
.tp-result{font-family:var(--font-answer,var(--font-reading));font-size:14.5px;line-height:1.7;overflow-wrap:anywhere}
.tp-result :deep(p){margin:0 0 .6em}
.tp-result :deep(>:last-child){margin-bottom:0}
.tp-pending{display:flex;gap:5px;margin:6px 0 2px}
.tp-dot{width:6px;height:6px;border-radius:50%;background:var(--muted);animation:tp-blink 1.1s ease-in-out infinite}
.tp-dot:nth-child(2){animation-delay:.15s}.tp-dot:nth-child(3){animation-delay:.3s}
@keyframes tp-blink{0%,100%{opacity:.25}50%{opacity:1}}
.tp-error{margin:4px 0 0;color:var(--danger);font-size:12px}
.tp-actions{display:flex;justify-content:flex-end;gap:2px;margin-top:4px;opacity:.55;transition:opacity var(--dur-1) var(--ease-soft)}
.tp-card:hover .tp-actions,.tp-card:focus-within .tp-actions{opacity:1}
.tp-actions .tp-icon{width:26px;height:24px}
.tp-composer{position:relative;flex-shrink:0;margin:8px 12px 12px;border-radius:14px;border:.5px solid var(--line-soft);background:color-mix(in srgb,var(--surface) 80%,transparent)}
.tp-composer textarea{display:block;width:100%;min-height:64px;max-height:180px;padding:10px 44px 10px 12px;border:0;background:none;resize:none;color:inherit;font:inherit;font-size:13.5px;line-height:1.55;outline:none}
.tp-send{position:absolute;right:8px;bottom:8px;display:grid;place-items:center;width:30px;height:30px;padding:0;border:0;border-radius:50%;background:var(--surface-ink);color:var(--surface);box-shadow:none}
.tp-send:disabled{opacity:.3}
@media(prefers-reduced-motion:reduce){.tp-card,.tp-dot{animation:none}}
</style>
