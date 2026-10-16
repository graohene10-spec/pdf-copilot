<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick, defineAsyncComponent } from 'vue'
import AppIcon from './AppIcon.vue'
import { vLiquidSelection } from '../ui/liquid-selection'
import { useSettings, defaultPreferences, normalizePreferences, preferenceErrors, importBackgroundImage, defaultQuickPrompts, quickPromptLabelLength, limitQuickPromptLabel, QUICK_PROMPT_LABEL_LIMIT, QUICK_PROMPT_QUESTION_LIMIT, SHORTCUTS, DEFAULT_SHORTCUTS, shortcutLabel, shortcutFromEvent, shortcutFromWheelEvent, type AppPreferences, type ShortcutAction } from '../settings'

type Tab = 'appearance' | 'reading' | 'shortcuts' | 'ai'
const props = withDefaults(defineProps<{ initialTab?: Tab }>(), { initialTab: 'appearance' })
const emit = defineEmits<{ close: []; saved: [value: AppPreferences]; 'ai-saved': [value: any] }>()
const AiSettings = defineAsyncComponent(() => import('./AiSettings.vue'))
const shared = useSettings()
const draft = ref<AppPreferences>(normalizePreferences(shared.preferences.value))
let baseline = JSON.stringify(draft.value)
const tab = ref<Tab>(props.initialTab)
const aiVisited = ref(props.initialTab === 'ai')
const ready = ref(false)
const saving = ref(false)
const importingImage = ref(false)
const imageError = ref('')
const imageInput = ref<HTMLInputElement>()
let disposed = false
let closing = false
let imageRequest = 0
const status = ref('')
const recording = ref<ShortcutAction | null>(null)
const captureError = ref('')
const composingLabel = ref<number | null>(null)
const aiSettings = ref<any>()
const dialog = ref<HTMLElement>()
const previousFocus = document.activeElement as HTMLElement | null
const errors = computed(() => preferenceErrors(draft.value))
const zoomMode = computed({ get: () => draft.value.pdf.initialZoom === 'fit-width' ? 'fit-width' : 'custom', set: value => { draft.value.pdf.initialZoom = value === 'fit-width' ? 'fit-width' : 100 } })
const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: 'appearance', label: '外观', icon: 'sun' }, { id: 'reading', label: '阅读', icon: 'book' },
  { id: 'shortcuts', label: '快捷键', icon: 'settings' }, { id: 'ai', label: 'AI', icon: 'sparkle' },
]
onMounted(async () => {
  await nextTick(); dialog.value?.focus()
  try {
    await shared.load()
    if (disposed || closing) return
    draft.value = normalizePreferences(shared.preferences.value)
    baseline = JSON.stringify(draft.value)
    ready.value = true
    shared.previewAppearance(draft.value.appearance)
  } catch (cause: any) { if (!disposed && !closing) status.value = cause.message || String(cause) }
})
watch(() => draft.value.appearance, value => {
  if (ready.value && !disposed && !closing) shared.previewAppearance(value)
}, { deep: true, flush: 'sync' })
onBeforeUnmount(() => {
  disposed = true; imageRequest++
  shared.previewAppearance(null)
  if (previousFocus?.isConnected) previousFocus.focus()
})
function close() {
  if (saving.value || closing) return
  closing = true; imageRequest++
  shared.previewAppearance(null)
  emit('close')
}
async function chooseBackground(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || saving.value || !ready.value || disposed || closing) return
  const request = ++imageRequest
  importingImage.value = true; imageError.value = ''; status.value = ''
  try {
    const background = await importBackgroundImage(file)
    if (!disposed && !closing && request === imageRequest) draft.value.appearance.background = background
  } catch (cause: any) {
    if (!disposed && !closing && request === imageRequest) imageError.value = cause.message || String(cause)
  } finally {
    if (!disposed && !closing && request === imageRequest) importingImage.value = false
  }
}
function restoreBackground() {
  imageRequest++; importingImage.value = false; imageError.value = ''
  draft.value.appearance.background = null
}
function switchTab(value: Tab) { tab.value = value; if (value === 'ai') aiVisited.value = true; recording.value = null; captureError.value = ''; composingLabel.value = null; status.value = '' }
function editQuickPromptLabel(event: Event, index: number) {
  if (saving.value) return
  const input = event.target as HTMLInputElement
  // Keep the controlled value synchronized during IME composition. Deferring
  // the draft update would let any other reactive change overwrite candidates.
  if ((event as InputEvent).isComposing || composingLabel.value === index) {
    draft.value.assistant.quickPrompts[index].label = input.value
    return
  }
  const label = limitQuickPromptLabel(input.value)
  if (input.value !== label) input.value = label
  draft.value.assistant.quickPrompts[index].label = label
}
function finishQuickPromptLabel(event: CompositionEvent, index: number) {
  composingLabel.value = null
  editQuickPromptLabel(event, index)
}
function restoreQuickPrompt(index: number) {
  draft.value.assistant.quickPrompts[index] = defaultQuickPrompts()[index]
  composingLabel.value = null; status.value = ''
}
function restoreQuickPrompts() {
  draft.value.assistant.quickPrompts = defaultQuickPrompts()
  composingLabel.value = null; status.value = ''
}
function startRecording(action: ShortcutAction) { recording.value = action; captureError.value = '' }
function record(event: KeyboardEvent, action: ShortcutAction) {
  event.stopPropagation()
  if (event.key === 'Escape') { event.preventDefault(); if (!recording.value) close(); recording.value = null; captureError.value = ''; return }
  if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) return
  if (event.isComposing || event.keyCode === 229 || ['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return
  const binding = shortcutFromEvent(event)
  if (!binding) { captureError.value = '使用 F11 或 Ctrl、Alt、Meta 加其他按键；浏览器保留快捷键不可使用。'; return }
  event.preventDefault()
  draft.value.shortcuts[action] = binding
  recording.value = null; captureError.value = ''
}
function disable(action: ShortcutAction) { draft.value.shortcuts[action] = ''; recording.value = null; captureError.value = '' }
function recordWheel(event: WheelEvent, action: ShortcutAction) {
  if (recording.value !== action || !['zoomIn', 'zoomOut'].includes(action)) return
  event.preventDefault(); event.stopPropagation()
  const binding = shortcutFromWheelEvent(event)
  if (!binding) { captureError.value = '按住 Ctrl、Alt 或 Meta，再滚动鼠标滚轮。'; return }
  draft.value.shortcuts[action] = binding; recording.value = null; captureError.value = ''
}
function restoreShortcut(action: ShortcutAction) { draft.value.shortcuts[action] = DEFAULT_SHORTCUTS[action]; recording.value = null; captureError.value = '' }
function restoreAll() { draft.value.shortcuts = { ...DEFAULT_SHORTCUTS }; recording.value = null; captureError.value = '' }
function resetTab() {
  const defaults = defaultPreferences()
  if (tab.value === 'appearance') { restoreBackground(); draft.value.appearance = defaults.appearance }
  if (tab.value === 'reading') { draft.value.pdf = defaults.pdf; draft.value.markdown = defaults.markdown }
  if (tab.value === 'shortcuts') restoreAll()
  status.value = ''
}
async function save() {
  if (saving.value || importingImage.value || composingLabel.value !== null || !ready.value || disposed || closing) return
  if (errors.value.length) { status.value = errors.value[0]; return }
  saving.value = true; status.value = ''
  try {
    let ai: any
    if (aiVisited.value && aiSettings.value?.hasChanges()) {
      ai = await aiSettings.value.save()
      if (!ai) { tab.value = 'ai'; return }
      emit('ai-saved', ai)
    }
    if (tab.value !== 'ai' || JSON.stringify(draft.value) !== baseline) {
      const value = await shared.save(draft.value)
      emit('saved', value)
    }
    shared.previewAppearance(null)
    closing = true; imageRequest++
    emit('close')
  } catch (cause: any) { status.value = cause.message || String(cause) }
  finally { saving.value = false }
}
function dialogKeydown(event: KeyboardEvent) {
  event.stopPropagation()
  if (event.key === 'Tab') {
    const controls = [...(dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]') || [])].filter(element => element.offsetParent !== null)
    const first = controls[0], last = controls.at(-1)
    if (!first) return
    if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.value)) { event.preventDefault(); first.focus() }
    else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) { event.preventDefault(); last?.focus() }
  }
  if (event.key === 'Escape' && !recording.value && !event.isComposing && event.keyCode !== 229 && composingLabel.value === null) { event.preventDefault(); close() }
}
</script>

<template>
  <div class="settings-backdrop" @click.self="close">
    <section ref="dialog" class="settings-dialog" data-glass-interactive="panel" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabindex="-1" @keydown="dialogKeydown">
      <header class="dialog-header"><h2 id="settings-title">设置</h2><button class="settings-close" :disabled="saving" @click="close" aria-label="关闭设置"><AppIcon name="close" :size="18" /></button></header>
      <div class="settings-body">
        <nav v-liquid-selection class="settings-tabs" aria-label="设置分类"><button v-for="item in tabs" :key="item.id" :class="{ selected: tab === item.id }" @click="switchTab(item.id)" :aria-current="tab === item.id ? 'page' : undefined"><AppIcon :name="item.icon" :size="17" />{{ item.label }}</button></nav>
        <div class="settings-content">
          <p v-if="!ready" class="settings-help">{{ status || '正在读取设置…' }}</p>
          <template v-else-if="tab === 'appearance'">
            <h3>外观</h3>
            <div class="settings-group">
            <label class="setting-row"><span>主题</span><select v-model="draft.appearance.theme" :disabled="saving" aria-label="主题"><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
            <label class="setting-row"><span>默认文档视图</span><select v-model="draft.appearance.libraryView" :disabled="saving" aria-label="默认文档视图"><option value="grid">卡片</option><option value="list">列表</option></select></label>
            <div class="setting-row transparency-row"><label for="glass-transparency">玻璃透明度</label><div class="transparency-control"><input id="glass-transparency" v-model.number="draft.appearance.glassTransparency" :style="{ '--value': draft.appearance.glassTransparency }" :disabled="saving" type="range" min="0" max="100" step="1" aria-label="玻璃透明度" :aria-valuetext="`${draft.appearance.glassTransparency}%`" /><output for="glass-transparency">{{ draft.appearance.glassTransparency }}%</output><span class="slider-endpoints" aria-hidden="true"><span>实色</span><span>清透</span></span></div></div>
            </div>
            <div class="settings-group background-setting"><div class="background-heading"><span>底板图片</span><button type="button" :disabled="saving || importingImage" @click="imageInput?.click()">{{ importingImage ? '正在处理…' : draft.appearance.background ? '替换图片' : '选择图片' }}</button><button v-if="draft.appearance.background" type="button" :disabled="saving || importingImage" @click="restoreBackground" aria-label="恢复默认底板">恢复默认</button></div><input ref="imageInput" class="background-file" type="file" accept="image/png,image/jpeg,image/webp" tabindex="-1" aria-label="底板图片文件" @change="chooseBackground" /><div v-if="draft.appearance.background" class="background-preview"><img :src="draft.appearance.background.dataUrl" alt="底板图片预览" /><span :data-tip="draft.appearance.background.name">{{ draft.appearance.background.name }}</span></div><p v-else class="settings-help background-default">使用默认底板</p><p v-if="imageError" class="settings-error" role="status">{{ imageError }}</p><p class="settings-help">支持 PNG、JPEG、WebP；图片保存在本机，自动适应窗口。调节后可预览，点击保存生效。</p></div>
            <p class="settings-help">透明度仅影响侧栏、工具栏与面板，正文保持实色。系统开启「减少透明度」时自动使用实色。</p>
          </template>
          <template v-else-if="tab === 'reading'">
            <h3>PDF</h3>
            <div class="settings-group">
            <label class="setting-row"><span>初始缩放</span><select v-model="zoomMode" aria-label="PDF 初始缩放模式"><option value="fit-width">适应宽度</option><option value="custom">自定义</option></select></label>
            <label v-if="zoomMode === 'custom'" class="setting-row"><span>缩放比例</span><span class="number-control"><input v-model.number="draft.pdf.initialZoom" type="number" min="25" max="400" step="5" aria-label="PDF 初始缩放比例" /><span>%</span></span></label>
            <label class="setting-row"><span>缩放步长</span><span class="number-control"><input v-model.number="draft.pdf.zoomStep" type="number" min="5" max="50" step="1" aria-label="PDF 缩放步长" /><span>%</span></span></label>
            <label class="setting-check"><input v-model="draft.pdf.fitOnPanelOverflow" type="checkbox" aria-label="侧栏打开后页面超宽时适应宽度" /><span>侧栏打开后，仅在页面超宽时适应宽度</span></label>
            <label class="setting-check"><input v-model="draft.pdf.openAssistantOnCapture" type="checkbox" aria-label="PDF 框选后自动打开阅读助手" /><span>PDF 框选后自动打开阅读助手</span></label>
            </div>
            <p class="settings-help">启用 AI 页的框选快捷提问后，优先显示选区旁的按钮。</p>
            <h3 class="section-heading">Markdown</h3>
            <div class="settings-group">
            <label class="setting-row"><span>默认字号</span><span class="number-control"><input v-model.number="draft.markdown.fontSize" type="number" min="13" max="28" step="1" aria-label="Markdown 默认字号" /><span>px</span></span></label>
            <label class="setting-row"><span>内容宽度</span><span class="number-control"><input v-model.number="draft.markdown.contentWidth" type="number" min="600" max="1400" step="20" aria-label="Markdown 内容宽度" /><span>px</span></span></label>
            </div>
          </template>
          <template v-else-if="tab === 'shortcuts'">
            <div class="shortcuts-heading"><h3>快捷键</h3><button class="text-action" @click="restoreAll">恢复全部默认</button></div>
            <p class="settings-help">点击后录入按键，支持 F11；缩放也可按住 Ctrl 滚动鼠标录入。Esc 取消录入。</p>
            <div class="settings-group">
            <div v-for="item in SHORTCUTS" :key="item.action" class="shortcut-row"><label :for="`shortcut-${item.action}`">{{ item.label }}</label><input :id="`shortcut-${item.action}`" :value="recording === item.action ? '按下快捷键…' : shortcutLabel(draft.shortcuts[item.action])" :class="{ recording: recording === item.action }" readonly :aria-label="`${item.label}快捷键`" data-shortcut-capture @focus="startRecording(item.action)" @click="startRecording(item.action)" @keydown="record($event, item.action)" @wheel="recordWheel($event, item.action)" @blur="recording === item.action && (recording = null)" /><button @click="disable(item.action)" :aria-label="`禁用${item.label}快捷键`" :disabled="!draft.shortcuts[item.action]">禁用</button><button @click="restoreShortcut(item.action)" :aria-label="`恢复${item.label}默认快捷键`">默认</button></div>
            </div>
            <p v-if="captureError" class="settings-error" role="status">{{ captureError }}</p>
          </template>
          <AiSettings v-if="ready && aiVisited" v-show="tab === 'ai'" ref="aiSettings" embedded />
          <section v-if="ready && tab === 'ai'" class="quick-prompts-section" aria-label="快捷提问设置">
            <div class="quick-prompts-heading"><h3>快捷提问</h3><button type="button" class="text-action" :disabled="saving" @click="restoreQuickPrompts" aria-label="恢复全部快捷提问默认">恢复默认</button></div>
            <p class="settings-help">点击侧栏按钮即可发送对应提示词。按钮介绍最多 {{ QUICK_PROMPT_LABEL_LIMIT }} 字，提示词最多 {{ QUICK_PROMPT_QUESTION_LIMIT }} 个字符；保存后生效。</p>
            <div class="settings-group"><label class="setting-check"><input v-model="draft.pdf.quickAskOnCapture" type="checkbox" :disabled="saving" aria-label="PDF 框选后显示快捷提问" aria-describedby="capture-quick-ask-help" /><span>PDF 框选后显示快捷提问</span></label></div>
            <p id="capture-quick-ask-help" class="settings-help">框选后先显示选区旁的快捷问题，点击继续再打开助手。</p>
            <section v-for="(item, index) in draft.assistant.quickPrompts" :key="index" class="quick-prompt-editor settings-group" :aria-labelledby="`quick-prompt-heading-${index}`">
              <div class="quick-prompt-heading"><h4 :id="`quick-prompt-heading-${index}`">按钮 {{ index + 1 }}</h4><button type="button" :disabled="saving" @click="restoreQuickPrompt(index)" :aria-label="`恢复快捷提问 ${index + 1} 默认`">恢复默认</button></div>
              <label :for="`quick-prompt-label-${index}`">按钮介绍 <span class="quick-prompt-counter" :id="`quick-prompt-count-${index}`">{{ quickPromptLabelLength(item.label) }} / {{ QUICK_PROMPT_LABEL_LIMIT }}</span></label>
              <input :id="`quick-prompt-label-${index}`" :value="item.label" :disabled="saving" type="text" :aria-label="`快捷提问 ${index + 1} 按钮介绍`" :aria-describedby="`quick-prompt-count-${index}`" @input="editQuickPromptLabel($event, index)" @compositionstart="composingLabel = index" @compositionend="finishQuickPromptLabel($event, index)" />
              <label :for="`quick-prompt-question-${index}`">提示词</label>
              <textarea :id="`quick-prompt-question-${index}`" v-model="item.question" :disabled="saving" :maxlength="QUICK_PROMPT_QUESTION_LIMIT" rows="3" :aria-label="`快捷提问 ${index + 1} 提示词`" />
            </section>
          </section>
          <p v-if="ready && errors.length" class="settings-error" role="status">{{ errors[0] }}</p>
          <p v-if="ready && status" class="settings-error" role="status">{{ status }}</p>
        </div>
      </div>
      <footer class="settings-footer"><button v-if="tab !== 'ai'" class="text-action" @click="resetTab" :disabled="saving || importingImage || !ready">恢复默认</button><span class="footer-space"></span><button @click="close" :disabled="saving">取消</button><button class="settings-save" @click="save" :disabled="saving || importingImage || composingLabel !== null || !ready || !!errors.length">{{ saving ? '保存中…' : '保存' }}</button></footer>
    </section>
  </div>
</template>

<style scoped>
/* 设置为一张悬浮的厚玻璃；内容按 iOS 的内嵌圆角分组排列，表单保持稳定对比度。 */
.settings-backdrop{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--canvas-deep) 22%,transparent);z-index:80;padding:25px}
.settings-dialog{position:relative;width:780px;max-width:100%;height:648px;max-height:90vh;background-color:var(--popup-glass);background-image:var(--popup-sheen);-webkit-backdrop-filter:blur(var(--popup-blur)) saturate(var(--glass-sat));backdrop-filter:blur(var(--popup-blur)) saturate(var(--glass-sat));border:1px solid var(--glass-outline);border-radius:var(--r-2xl);box-shadow:0 30px 90px -20px color-mix(in srgb,var(--canvas-deep) 30%,rgb(0 0 0 / .35)),var(--shadow-3),var(--glass-edge);display:flex;flex-direction:column;color:var(--ink);overflow:hidden;transform-origin:50% 60%}
:global(:root[data-glass='solid']) .settings-dialog,:global(:root[data-contrast='high']) .settings-dialog{background-color:var(--surface);background-image:none;-webkit-backdrop-filter:none;backdrop-filter:none}
@media(prefers-reduced-transparency:reduce),(prefers-contrast:more),(forced-colors:active){.settings-dialog{background-color:var(--surface);background-image:none;-webkit-backdrop-filter:none;backdrop-filter:none}}
button{color:var(--control-ink)}
.dialog-header{display:flex;align-items:center;justify-content:space-between;padding:16px 16px 6px 26px}
.dialog-header h2{font-family:var(--font-display);font-size:20px;font-weight:700;letter-spacing:-.2px;margin:0}
.settings-close{width:34px;height:34px;padding:0;border:1px solid var(--glass-outline);background-color:var(--glass-2);background-image:var(--glass-sheen);color:var(--control-ink);border-radius:50%;box-shadow:var(--glass-control-shadow)}
.settings-close:hover:not(:disabled){background-color:var(--control-hover);color:var(--control-ink)}
.settings-body{display:flex;flex:1;min-height:0}
/* 分类：一列胶囊，选中的一滴玻璃上下滑动。 */
.settings-tabs{flex:0 0 156px;padding:10px 0 10px 14px;display:flex;flex-direction:column;gap:3px}
.settings-tabs button{height:40px;font-size:13px;justify-content:flex-start;gap:10px;background:none;border:0;box-shadow:none;padding:9px 14px;color:var(--control-ink);border-radius:var(--r-full);transition:background-color var(--dur-1) var(--ease-soft)}
.settings-tabs button:hover:not(:disabled){background-color:var(--control-hover);color:var(--control-ink)}
/* 选中的分类页仅调整灰度底色，保持统一文字颜色。 */
.settings-tabs button.selected{background-color:var(--control-selected);background-image:var(--glass-sheen);color:var(--control-ink);font-weight:600;box-shadow:var(--glass-control-shadow)}
.settings-tabs button.selected:hover:not(:disabled){background-color:var(--control-selected-hover);color:var(--control-ink)}
.settings-tabs.has-indicator button.selected,.settings-tabs.has-indicator button.selected:hover:not(:disabled){background:transparent;box-shadow:none}
.settings-content{flex:1;min-width:0;overflow:auto;padding:14px 26px 26px 22px;scrollbar-width:thin;-webkit-mask-image:linear-gradient(180deg,transparent 0,#000 14px,#000 calc(100% - 14px),transparent 100%);mask-image:linear-gradient(180deg,transparent 0,#000 14px,#000 calc(100% - 14px),transparent 100%)}
.settings-content h3{font-size:12px;font-weight:600;letter-spacing:.3px;color:var(--muted);margin:6px 0 8px 14px}
/* 内嵌分组：一块圆角的浅填充，行间以细线分隔。 */
.settings-group{position:relative;border-radius:var(--r-lg);background-color:color-mix(in srgb,var(--glass-2) 60%,var(--fill-4));background-image:var(--glass-sheen);box-shadow:var(--glass-control-edge);padding:2px 16px;margin-bottom:8px}
.setting-row{display:flex;align-items:center;justify-content:space-between;gap:15px;min-height:50px;padding:8px 0;font-size:13px;color:var(--secondary);border-bottom:1px solid var(--separator)}
.settings-group>:last-child{border-bottom:0}
.setting-row select{width:170px;height:34px;font-size:12.5px;padding:6px 32px 6px 13px;color:var(--control-ink)}
.number-control{display:flex;align-items:center;gap:9px;justify-content:flex-end;width:170px;color:var(--muted);font-size:11.5px}
.number-control input{width:107px;height:34px;font-size:12.5px;padding:6px 13px;color:var(--control-ink);text-align:right;font-variant-numeric:tabular-nums}
.number-control>span{width:19px}
/* 开关行：文字在左，开关在右。 */
.setting-check{display:flex;flex-direction:row-reverse;align-items:center;justify-content:space-between;gap:14px;min-height:50px;padding:8px 0;font-size:13px;color:var(--secondary);line-height:1.6;border-bottom:1px solid var(--separator);cursor:pointer}
.setting-check input{margin:0}
.settings-content .section-heading{margin-top:26px}
.shortcuts-heading{display:flex;align-items:center;justify-content:space-between;gap:15px}
.shortcuts-heading h3{margin-bottom:0}
.text-action{height:30px;padding:5px 12px;border:0;background:none;box-shadow:none;color:var(--accent);font-size:12px;font-weight:600}
.text-action:hover:not(:disabled){background-color:color-mix(in srgb,var(--accent) 10%,transparent);color:var(--accent)}
.settings-help{font-size:11.5px;color:var(--muted);line-height:1.75;margin:8px 14px 18px}
.shortcut-row{display:flex;align-items:center;gap:6px;min-height:48px;padding:7px 0;border-bottom:1px solid var(--separator)}
.shortcut-row>label{flex:1;min-width:95px;font-size:12.5px;color:var(--secondary)}
.shortcut-row input{width:150px;height:32px;font-size:11.5px;padding:5px 12px;text-align:center;cursor:pointer;color:var(--control-ink);background-color:var(--fill-3);font-variant-numeric:tabular-nums}
.shortcut-row input.recording{border-color:color-mix(in srgb,var(--accent) 55%,transparent);background-color:color-mix(in srgb,var(--accent) 10%,transparent);color:var(--control-ink);box-shadow:0 0 0 4px var(--accent-ring)}
.shortcut-row button{height:30px;border:0;background:none;box-shadow:none;color:var(--accent);font-size:11.5px;font-weight:600;padding:5px 10px}
.shortcut-row button:hover:not(:disabled){background-color:color-mix(in srgb,var(--accent) 10%,transparent);color:var(--accent)}
.transparency-row{align-items:center;padding:12px 0}
.transparency-control{display:grid;grid-template-columns:minmax(120px,1fr) 46px;align-items:center;gap:2px 10px;width:270px;max-width:65%}
/* 滑杆：细槽 + 玻璃旋钮，已走过的部分以主色填充。 */
.transparency-control input{--fill:calc(var(--value, 70) * 1%);width:100%;min-width:0;height:28px;margin:0;padding:0;cursor:pointer;-webkit-appearance:none;appearance:none;background:transparent;border:0;border-radius:0;box-shadow:none}
.transparency-control input:hover:not(:disabled):not(:focus),.transparency-control input:focus{background:transparent;border:0;box-shadow:none}
.transparency-control input::-webkit-slider-runnable-track{height:6px;border-radius:999px;background:linear-gradient(90deg,var(--accent) var(--fill),var(--fill-1) var(--fill))}
.transparency-control input::-webkit-slider-thumb{-webkit-appearance:none;width:26px;height:26px;margin-top:-10px;border-radius:50%;background:linear-gradient(180deg,#fff,#f2f4f3);box-shadow:0 0 0 .5px rgb(0 0 0 / .06),0 3px 8px rgb(0 0 0 / .18),inset 0 1px 0 #fff;transition:scale var(--dur-bounce) var(--spring-bouncy)}
.transparency-control input:active::-webkit-slider-thumb{scale:1.18}
.transparency-control input:focus-visible{outline:none}
.transparency-control input:focus-visible::-webkit-slider-thumb{box-shadow:0 0 0 3px var(--accent-ring),0 3px 8px rgb(0 0 0 / .18)}
.transparency-control output{font-size:12.5px;font-weight:600;font-variant-numeric:tabular-nums;text-align:right;color:var(--control-ink)}
.slider-endpoints{display:flex;justify-content:space-between;grid-column:1;font-size:10.5px;color:var(--muted)}
.background-setting{padding:14px 16px;font-size:13px;color:var(--secondary)}
.background-heading{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.background-heading>span{flex:1}
.background-heading button{min-height:34px;padding:6px 15px;font-size:12px;font-weight:600;background-color:var(--glass-2);background-image:var(--glass-sheen);border:1px solid var(--glass-outline);border-radius:var(--r-full);box-shadow:var(--glass-control-shadow);color:var(--control-ink)}
.background-heading button:hover:not(:disabled){background-color:var(--control-hover);color:var(--control-ink)}
.background-file{display:none}
.background-preview{margin-top:12px;display:flex;align-items:center;gap:13px;min-width:0}
.background-preview img{width:120px;height:68px;object-fit:cover;flex-shrink:0;border-radius:var(--r-sm);border:1px solid var(--glass-outline);box-shadow:var(--shadow-1)}
.background-preview>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--control-ink);font-size:12px}
.background-setting .settings-help{margin:10px 0 0}
.background-default{margin-bottom:0}
.quick-prompts-section{margin-top:24px;padding-top:20px;border-top:1px solid var(--separator)}
.quick-prompts-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:4px}
.quick-prompts-heading h3{margin:0 0 0 14px}
.quick-prompt-editor{padding:14px 16px 16px;margin:0 0 12px;min-width:0}
.quick-prompt-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}
.quick-prompt-heading h4{font-size:13px;font-weight:650;margin:0;color:var(--control-ink)}
.quick-prompt-heading button{height:30px;padding:4px 13px;font-size:11.5px;font-weight:600;border:1px solid var(--glass-outline);border-radius:var(--r-full);background-color:var(--glass-2);color:var(--control-ink);box-shadow:var(--glass-control-shadow)}
.quick-prompt-heading button:hover:not(:disabled){background-color:var(--control-hover)}
.quick-prompt-editor>label{display:flex;align-items:center;justify-content:space-between;gap:12px;color:var(--secondary);font-size:11.5px;margin-bottom:6px}
.quick-prompt-counter{color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.quick-prompt-editor>input,.quick-prompt-editor>textarea{box-sizing:border-box;display:block;width:100%;min-width:0;font:inherit;font-size:12.5px;line-height:1.7;padding:7px 13px;color:var(--control-ink);text-shadow:none}
.quick-prompt-editor>input{height:36px;margin-bottom:12px}
.quick-prompt-editor>textarea{resize:vertical;min-height:84px;max-height:240px;border-radius:var(--r-md);padding:9px 13px}
.settings-error{font-size:11.5px;line-height:1.8;color:var(--danger);margin:14px 14px 0;white-space:pre-line}
.settings-footer{padding:12px 16px 16px 22px;display:flex;align-items:center;gap:10px;border-top:1px solid var(--separator)}
.footer-space{flex:1}
.settings-footer button{min-width:86px;height:40px;font-size:13px;font-weight:600;padding:8px 20px;border-color:var(--glass-outline);border-radius:var(--r-full);background-color:var(--glass-2);background-image:var(--glass-sheen);color:var(--control-ink);box-shadow:var(--glass-control-shadow)}
.settings-footer button:hover:not(:disabled){background-color:var(--control-hover);border-color:var(--glass-outline);color:var(--control-ink)}
.settings-footer .text-action{min-width:0;height:34px;padding:5px 12px;font-size:12px;background:none;border:0;box-shadow:none;color:var(--accent)}
.settings-footer .text-action:hover:not(:disabled){background-color:color-mix(in srgb,var(--accent) 10%,transparent);color:var(--accent)}
/* 保存：着色玻璃主操作。 */
.settings-footer .settings-save{background-color:var(--accent-glass);background-image:var(--glass-tint-sheen);border-color:transparent;color:var(--accent-on);font-weight:650;box-shadow:0 8px 20px -10px color-mix(in srgb,var(--accent) 80%,transparent),inset 0 1px 0 rgb(255 255 255 / .25)}
.settings-footer .settings-save:hover:not(:disabled){background-color:var(--accent-glass-hover);border-color:transparent;color:var(--accent-on)}
@media(max-width:670px){.settings-backdrop{padding:12px}.settings-tabs{flex-basis:112px;padding:10px 0 10px 8px}.settings-tabs button{padding:9px 10px;gap:6px}.settings-content{padding:12px 14px 22px}.shortcut-row{flex-wrap:wrap}.shortcut-row>label{flex-basis:100%;margin-bottom:3px}.shortcut-row input{flex:1;max-width:200px}.setting-row select,.number-control{width:130px}.settings-dialog{max-height:94vh}.transparency-control{grid-template-columns:minmax(80px,1fr) 36px;width:175px}.transparency-row{gap:9px}.background-heading>span{flex-basis:100%}.background-preview img{width:86px;height:52px}}
@media(prefers-reduced-transparency:reduce),(prefers-contrast:more){.settings-content{-webkit-mask-image:none;mask-image:none}}
</style>
