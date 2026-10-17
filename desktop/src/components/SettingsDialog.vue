<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick, defineAsyncComponent } from 'vue'
import AppIcon from './AppIcon.vue'
import { vLiquidSelection } from '../ui/liquid-selection'
import { useSettings, defaultPreferences, normalizePreferences, preferenceErrors, importBackgroundImage, defaultQuickPrompts, defaultCaptureQuestions, newCaptureQuestion, quickPromptLabelLength, limitQuickPromptLabel, QUICK_PROMPT_LABEL_LIMIT, QUICK_PROMPT_QUESTION_LIMIT, CAPTURE_QUESTION_MIN, CAPTURE_QUESTION_MAX, BACKDROPS, UI_FONTS, READING_FONTS, MAX_GALLERY, SHORTCUTS, DEFAULT_SHORTCUTS, shortcutLabel, shortcutFromEvent, shortcutFromWheelEvent, type AppPreferences, type BackdropPreset, type BackgroundImage, type ShortcutAction } from '../settings'

type Tab = 'appearance' | 'reading' | 'shortcuts' | 'ai' | 'updates'
const props = withDefaults(defineProps<{ initialTab?: Tab }>(), { initialTab: 'appearance' })
const emit = defineEmits<{ close: []; saved: [value: AppPreferences]; 'ai-saved': [value: any] }>()
const AiSettings = defineAsyncComponent(() => import('./AiSettings.vue'))
const UpdateSettings = defineAsyncComponent(() => import('./UpdateSettings.vue'))
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
const composingLabel = ref<string | null>(null)
const aiSettings = ref<any>()
const dialog = ref<HTMLElement>()
const previousFocus = document.activeElement as HTMLElement | null
const errors = computed(() => preferenceErrors(draft.value))
const zoomMode = computed({ get: () => draft.value.pdf.initialZoom === 'fit-width' ? 'fit-width' : 'custom', set: value => { draft.value.pdf.initialZoom = value === 'fit-width' ? 'fit-width' : 100 } })
const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: 'appearance', label: '外观', icon: 'sun' }, { id: 'reading', label: '阅读', icon: 'book' },
  { id: 'shortcuts', label: '快捷键', icon: 'settings' }, { id: 'ai', label: 'AI', icon: 'sparkle' },
  { id: 'updates', label: '更新', icon: 'import' },
]
onMounted(async () => {
  await nextTick(); dialog.value?.focus()
  try {
    await shared.load()
    if (disposed || closing) return
    draft.value = normalizePreferences(shared.preferences.value)
    captureKeys.value = draft.value.assistant.captureQuestions.map(() => ++captureKeySeed)
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
    if (disposed || closing || request !== imageRequest) return
    // A new picture joins the gallery and becomes the backdrop; earlier ones stay available.
    const gallery = draft.value.appearance.gallery
    const existing = gallery.find(item => item.dataUrl === background.dataUrl)
    if (!existing && gallery.length >= MAX_GALLERY) { imageError.value = `图库最多保存 ${MAX_GALLERY} 张图片，请先删除一张。`; return }
    if (!existing) gallery.push(background)
    draft.value.appearance.background = existing || background
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
function chooseGalleryImage(image: BackgroundImage) {
  if (saving.value) return
  imageRequest++; importingImage.value = false; imageError.value = ''
  draft.value.appearance.background = image
}
function removeGalleryImage(image: BackgroundImage) {
  if (saving.value) return
  draft.value.appearance.gallery = draft.value.appearance.gallery.filter(item => item.dataUrl !== image.dataUrl)
  if (draft.value.appearance.background?.dataUrl === image.dataUrl) draft.value.appearance.background = null
}
// Fonts: detect which choices are installed by comparing rendered widths with a fallback.
const installed = ref<Record<string, boolean>>({})
function fontInstalled(families: string[]) {
  if (!families.length) return true
  const canvas = document.createElement('canvas').getContext('2d')
  if (!canvas) return true
  const sample = '阅读的乐趣 Reading 123'
  return families.some(family => ['monospace', 'serif'].some(base => {
    canvas.font = `20px ${base}`; const plain = canvas.measureText(sample).width
    canvas.font = `20px '${family}', ${base}`; return Math.abs(canvas.measureText(sample).width - plain) > .5
  }))
}
onMounted(() => { installed.value = Object.fromEntries([...UI_FONTS, ...READING_FONTS].map(item => [item.id, fontInstalled(item.families)])) })
const uiFontStack = computed(() => UI_FONTS.find(item => item.id === draft.value.appearance.uiFont)?.stack)
const readingFontStack = computed(() => READING_FONTS.find(item => item.id === draft.value.appearance.readingFont)?.stack || uiFontStack.value)
function chooseBackdrop(id: BackdropPreset) {
  if (saving.value) return
  restoreBackground()
  draft.value.appearance.backdrop = id
}
function switchTab(value: Tab) { tab.value = value; if (value === 'ai') aiVisited.value = true; recording.value = null; captureError.value = ''; composingLabel.value = null; status.value = '' }
type PromptList = 'quickPrompts' | 'captureQuestions'
function editQuickPromptLabel(event: Event, index: number, list: PromptList = 'quickPrompts') {
  if (saving.value) return
  const input = event.target as HTMLInputElement
  const item = draft.value.assistant[list][index]
  if (!item) return
  // Keep the controlled value synchronized during IME composition. Deferring
  // the draft update would let any other reactive change overwrite candidates.
  if ((event as InputEvent).isComposing || composingLabel.value === `${list}:${index}`) {
    item.label = input.value
    return
  }
  const label = limitQuickPromptLabel(input.value)
  if (input.value !== label) input.value = label
  item.label = label
}
function finishQuickPromptLabel(event: CompositionEvent, index: number, list: PromptList = 'quickPrompts') {
  composingLabel.value = null
  editQuickPromptLabel(event, index, list)
}
// 框选提问：每一项一个稳定键，删除中间项时编辑框不会串位。
let captureKeySeed = 0
const captureKeys = ref<number[]>(draft.value.assistant.captureQuestions.map(() => ++captureKeySeed))
watch(() => draft.value.assistant.captureQuestions.length, length => {
  while (captureKeys.value.length < length) captureKeys.value.push(++captureKeySeed)
  if (captureKeys.value.length > length) captureKeys.value = captureKeys.value.slice(0, length)
})
function addCaptureQuestion() {
  if (saving.value || draft.value.assistant.captureQuestions.length >= CAPTURE_QUESTION_MAX) return
  captureKeys.value.push(++captureKeySeed)
  draft.value.assistant.captureQuestions.push(newCaptureQuestion())
  status.value = ''
  void nextTick(() => dialog.value?.querySelector<HTMLInputElement>(`#capture-question-label-${draft.value.assistant.captureQuestions.length - 1}`)?.select())
}
// A removed editor stays only for its exit animation; take it out of focus order and the accessibility tree.
function retireEditor(element: Element) { element.setAttribute('aria-hidden', 'true'); (element as HTMLElement).inert = true }
function removeCaptureQuestion(index: number) {
  if (saving.value || draft.value.assistant.captureQuestions.length <= CAPTURE_QUESTION_MIN) return
  captureKeys.value.splice(index, 1)
  draft.value.assistant.captureQuestions.splice(index, 1)
  composingLabel.value = null; status.value = ''
}
function restoreCaptureQuestions() {
  draft.value.assistant.captureQuestions = defaultCaptureQuestions()
  captureKeys.value = draft.value.assistant.captureQuestions.map(() => ++captureKeySeed)
  composingLabel.value = null; status.value = ''
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
  if (tab.value === 'updates') draft.value.updates = defaults.updates
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
            <div class="setting-row transparency-row"><label for="glass-blur">模糊程度</label><div class="transparency-control"><input id="glass-blur" v-model.number="draft.appearance.glassBlur" :style="{ '--value': draft.appearance.glassBlur }" :disabled="saving || draft.appearance.glassTransparency === 0" type="range" min="0" max="100" step="1" aria-label="模糊程度" :aria-valuetext="`${draft.appearance.glassBlur}%`" /><output for="glass-blur">{{ draft.appearance.glassBlur }}%</output><span class="slider-endpoints" aria-hidden="true"><span>清晰</span><span>朦胧</span></span></div></div>
            </div>
            <h3 class="section-heading">底板</h3>
            <div class="settings-group background-setting">
              <div class="backdrop-grid" role="radiogroup" aria-label="底板">
                <button v-for="(item, index) in BACKDROPS" :key="item.id" type="button" role="radio" class="backdrop-swatch" :style="{ '--swatch': `var(--bd-${item.id})`, '--swatch-brand': `var(--bd-${item.id}-brand)`, '--i': index }" :aria-checked="!draft.appearance.background && draft.appearance.backdrop === item.id" :aria-label="`${item.label}底板`" :disabled="saving" @click="chooseBackdrop(item.id)"><span class="swatch-art" :class="{ ripples: item.id === 'paper' }"><i class="swatch-bar"></i><i class="swatch-dot"></i><span class="swatch-check"><AppIcon name="check" :size="12" /></span></span><span class="swatch-label">{{ item.label }}</span></button>
              </div>
              <div class="gallery-heading"><span>我的图片</span><small>{{ draft.appearance.gallery.length }} / {{ MAX_GALLERY }}</small></div>
              <div class="backdrop-grid gallery-grid" role="radiogroup" aria-label="我的图片">
                <div v-for="(image, index) in draft.appearance.gallery" :key="image.dataUrl.slice(-48)" class="gallery-item" :style="{ '--i': index }">
                  <button type="button" role="radio" class="backdrop-swatch" :aria-checked="draft.appearance.background?.dataUrl === image.dataUrl" :aria-label="`使用图片 ${image.name}`" :data-tip="image.name" :disabled="saving" @click="chooseGalleryImage(image)"><span class="swatch-art"><img :src="image.dataUrl" alt="" /><span class="swatch-check"><AppIcon name="check" :size="12" /></span></span><span class="swatch-label">{{ image.name }}</span></button>
                  <button type="button" class="gallery-remove" :aria-label="`从图库删除 ${image.name}`" data-tip="从图库删除" :disabled="saving" @click="removeGalleryImage(image)"><AppIcon name="close" :size="11" /></button>
                </div>
                <button v-if="draft.appearance.gallery.length < MAX_GALLERY" type="button" class="backdrop-swatch custom-swatch" :style="{ '--i': draft.appearance.gallery.length }" aria-label="添加图片到图库" :disabled="saving || importingImage" @click="imageInput?.click()"><span class="swatch-art"><AppIcon name="plus" :size="20" /></span><span class="swatch-label">{{ importingImage ? '处理中…' : '添加图片' }}</span></button>
              </div>
              <div v-if="draft.appearance.background" class="background-heading"><img class="background-current" :src="draft.appearance.background.dataUrl" alt="底板图片预览" /><span class="background-name" :data-tip="draft.appearance.background.name">{{ draft.appearance.background.name }}</span><button type="button" :disabled="saving || importingImage" @click="imageInput?.click()">替换图片</button><button type="button" :disabled="saving || importingImage" @click="restoreBackground" aria-label="恢复默认底板">改用预设</button></div>
              <div v-else class="background-heading"><span class="background-name">选择预设，或从图库挑一张图片</span><button type="button" :disabled="saving || importingImage" @click="imageInput?.click()">{{ importingImage ? '正在处理…' : '选择图片' }}</button></div>
              <input ref="imageInput" class="background-file" type="file" accept="image/png,image/jpeg,image/webp" tabindex="-1" aria-label="底板图片文件" @change="chooseBackground" />
              <p v-if="imageError" class="settings-error" role="status">{{ imageError }}</p>
              <p class="settings-help">每套底板带一套协调的主色与徽记颜色；图片底板沿用当前预设的主色。图库最多 {{ MAX_GALLERY }} 张，切换预设不会删除图片。支持 PNG、JPEG、WebP，图片保存在本机。</p>
            </div>
            <h3 class="section-heading">字体</h3>
            <div class="settings-group">
              <label class="setting-row"><span>界面字体</span><select v-model="draft.appearance.uiFont" :disabled="saving" aria-label="界面字体"><option v-for="item in UI_FONTS" :key="item.id" :value="item.id">{{ item.label }}{{ installed[item.id] === false ? '（未安装）' : '' }}</option></select></label>
              <label class="setting-row"><span>阅读字体</span><select v-model="draft.appearance.readingFont" :disabled="saving" aria-label="阅读字体"><option v-for="item in READING_FONTS" :key="item.id" :value="item.id">{{ item.label }}{{ installed[item.id] === false ? '（未安装）' : '' }}</option></select></label>
              <div class="font-preview"><p :style="{ fontFamily: uiFontStack }">界面：文档库 · 阅读助手 · 设置</p><p :style="{ fontFamily: readingFontStack }">正文：学而不思则罔，思而不学则殆。Reading 1234</p></div>
            </div>
            <p class="settings-help">阅读字体用于 Markdown 正文与阅读助手的回答；PDF 保持原排版。未安装的字体会自动退回系统字体。</p>
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
          <UpdateSettings v-if="ready && tab === 'updates'" v-model:auto-check="draft.updates.autoCheck" v-model:prerelease="draft.updates.prerelease" :disabled="saving" />
          <AiSettings v-if="ready && aiVisited" v-show="tab === 'ai'" ref="aiSettings" embedded />
          <section v-if="ready && tab === 'ai'" class="quick-prompts-section" aria-label="快捷提问设置">
            <div class="quick-prompts-heading"><h3>快捷提问</h3><button type="button" class="text-action" :disabled="saving" @click="restoreQuickPrompts" aria-label="恢复全部快捷提问默认">恢复默认</button></div>
            <p class="settings-help">点击侧栏按钮即可发送对应提示词。按钮介绍最多 {{ QUICK_PROMPT_LABEL_LIMIT }} 字，提示词最多 {{ QUICK_PROMPT_QUESTION_LIMIT }} 个字符；保存后生效。</p>
            <section v-for="(item, index) in draft.assistant.quickPrompts" :key="index" class="quick-prompt-editor settings-group" :aria-labelledby="`quick-prompt-heading-${index}`">
              <div class="quick-prompt-heading"><h4 :id="`quick-prompt-heading-${index}`">按钮 {{ index + 1 }}</h4><button type="button" :disabled="saving" @click="restoreQuickPrompt(index)" :aria-label="`恢复快捷提问 ${index + 1} 默认`">恢复默认</button></div>
              <label :for="`quick-prompt-label-${index}`">按钮介绍 <span class="quick-prompt-counter" :id="`quick-prompt-count-${index}`">{{ quickPromptLabelLength(item.label) }} / {{ QUICK_PROMPT_LABEL_LIMIT }}</span></label>
              <input :id="`quick-prompt-label-${index}`" :value="item.label" :disabled="saving" type="text" :aria-label="`快捷提问 ${index + 1} 按钮介绍`" :aria-describedby="`quick-prompt-count-${index}`" @input="editQuickPromptLabel($event, index)" @compositionstart="composingLabel = `quickPrompts:${index}`" @compositionend="finishQuickPromptLabel($event, index)" />
              <label :for="`quick-prompt-question-${index}`">提示词</label>
              <textarea :id="`quick-prompt-question-${index}`" v-model="item.question" :disabled="saving" :maxlength="QUICK_PROMPT_QUESTION_LIMIT" rows="3" :aria-label="`快捷提问 ${index + 1} 提示词`" />
            </section>
          </section>
          <section v-if="ready && tab === 'ai'" class="quick-prompts-section capture-questions-section" aria-label="框选快捷提问设置">
            <div class="quick-prompts-heading"><h3>框选快捷提问</h3><button type="button" class="text-action" :disabled="saving" @click="restoreCaptureQuestions" aria-label="恢复框选提问默认">恢复默认</button></div>
            <div class="settings-group"><label class="setting-check"><input v-model="draft.pdf.quickAskOnCapture" type="checkbox" :disabled="saving" aria-label="PDF 框选后显示快捷提问" aria-describedby="capture-quick-ask-help" /><span>PDF 框选后聚焦选区并弹出快捷提问</span></label></div>
            <p id="capture-quick-ask-help" class="settings-help">框选后选区以外的画面会虚化，选区旁弹出思考气泡；按气泡旁的数字键即可发送。「提问概括」显示在气泡上，「提问内容」是实际发送给 AI 的提示词。</p>
            <TransitionGroup name="editor-list" tag="div" class="capture-question-list" @before-leave="retireEditor">
              <section v-for="(item, index) in draft.assistant.captureQuestions" :key="captureKeys[index]" class="quick-prompt-editor capture-question-editor settings-group" :aria-labelledby="`capture-question-heading-${index}`">
                <div class="quick-prompt-heading"><h4 :id="`capture-question-heading-${index}`"><kbd class="capture-key">{{ index + 1 }}</kbd>提问 {{ index + 1 }}</h4><button type="button" :disabled="saving || draft.assistant.captureQuestions.length <= CAPTURE_QUESTION_MIN" @click="removeCaptureQuestion(index)" :aria-label="`删除框选提问 ${index + 1}`">删除</button></div>
                <label :for="`capture-question-label-${index}`">提问概括 <span class="quick-prompt-counter" :id="`capture-question-count-${index}`">{{ quickPromptLabelLength(item.label) }} / {{ QUICK_PROMPT_LABEL_LIMIT }}</span></label>
                <input :id="`capture-question-label-${index}`" :value="item.label" :disabled="saving" type="text" placeholder="如：为什么？" :aria-label="`框选提问 ${index + 1} 提问概括`" :aria-describedby="`capture-question-count-${index}`" @input="editQuickPromptLabel($event, index, 'captureQuestions')" @compositionstart="composingLabel = `captureQuestions:${index}`" @compositionend="finishQuickPromptLabel($event, index, 'captureQuestions')" />
                <label :for="`capture-question-text-${index}`">提问内容</label>
                <textarea :id="`capture-question-text-${index}`" v-model="item.question" :disabled="saving" :maxlength="QUICK_PROMPT_QUESTION_LIMIT" rows="3" :aria-label="`框选提问 ${index + 1} 提问内容`" />
              </section>
            </TransitionGroup>
            <button type="button" class="add-capture-question" :disabled="saving || draft.assistant.captureQuestions.length >= CAPTURE_QUESTION_MAX" @click="addCaptureQuestion"><AppIcon name="plus" :size="15" />添加提问<span>{{ draft.assistant.captureQuestions.length }} / {{ CAPTURE_QUESTION_MAX }}</span></button>
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
.settings-tabs button{height:40px;font-size:13px;justify-content:flex-start;gap:10px;background:none;border:0;box-shadow:none;padding:9px 14px;color:var(--control-ink);border-radius:var(--r-control);transition:background-color var(--dur-1) var(--ease-soft)}
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
/* 底板色板：一排圆角缩略图，选中的一张带主色描边与对勾。 */
.backdrop-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px 14px}
.backdrop-swatch{display:flex;flex-direction:column;align-items:stretch;gap:7px;height:auto;padding:0;border:0;background:none;box-shadow:none;border-radius:var(--r-md);font-size:12px;font-weight:550;color:var(--secondary);animation:zg-settle-in var(--dur-smooth) var(--spring-smooth) both;animation-delay:calc(var(--i, 0) * 35ms)}
.backdrop-swatch:hover:not(:disabled){background:none;border:0}
.swatch-art{position:relative;display:grid;place-items:center;height:64px;border-radius:var(--r-md);background:var(--swatch, var(--fill-3));border:1px solid var(--glass-outline);box-shadow:var(--shadow-1),inset 0 1px 0 rgb(255 255 255 / .5);overflow:hidden;color:var(--muted);transition:transform var(--dur-press) var(--spring-press),box-shadow var(--dur-2) var(--ease-out)}
.swatch-art.ripples::after{content:'';position:absolute;inset:0;background:url('../assets/white-ripples.svg') center/cover;opacity:.8}
:global(:root[data-theme='dark']) .swatch-art.ripples::after{opacity:.1}
.swatch-art img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.backdrop-swatch:hover:not(:disabled) .swatch-art{transform:translateY(-2px);box-shadow:var(--shadow-2),inset 0 1px 0 rgb(255 255 255 / .5)}
.backdrop-swatch:active:not(:disabled) .swatch-art{transform:scale(.96)}
/* 色板内一条玻璃小条与一颗主色圆点，示意这套底板上的界面。 */
.swatch-bar{position:absolute;left:9px;right:30px;top:9px;height:9px;border-radius:999px;background:rgb(255 255 255 / .62);box-shadow:inset 0 0 0 .5px rgb(0 0 0 / .06);z-index:1}
.swatch-dot{position:absolute;left:9px;bottom:9px;width:16px;height:16px;border-radius:6px;background:var(--swatch-brand);box-shadow:0 3px 6px -2px rgb(0 0 0 / .25),inset 0 1px 0 rgb(255 255 255 / .4);z-index:1}
.swatch-check{position:absolute;right:7px;bottom:7px;display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:var(--accent);color:var(--accent-on);box-shadow:0 2px 6px rgb(0 0 0 / .2);opacity:0;scale:.4;transition:opacity var(--dur-2) var(--ease-out),scale var(--dur-bounce) var(--spring-bouncy);z-index:2}
.backdrop-swatch[aria-checked='true'] .swatch-art{box-shadow:0 0 0 2px var(--surface),0 0 0 4px var(--accent),var(--shadow-1)}
.backdrop-swatch[aria-checked='true'] .swatch-check{opacity:1;scale:1}
.backdrop-swatch[aria-checked='true'] .swatch-label{color:var(--control-ink);font-weight:650}
.backdrop-swatch:focus-visible{outline:none}
.backdrop-swatch:focus-visible .swatch-art{outline:2px solid var(--accent);outline-offset:3px}
.custom-swatch .swatch-art{background:var(--fill-3);border-style:dashed}
.custom-swatch[aria-checked='true'] .swatch-art{border-style:solid}
:global(:root[data-theme='dark']) .swatch-bar{background:rgb(255 255 255 / .14)}
.background-heading{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:14px}
.background-current{width:44px;height:30px;border-radius:7px;object-fit:cover;border:1px solid var(--glass-outline)}
.gallery-heading{display:flex;align-items:baseline;justify-content:space-between;margin:18px 2px 10px;font-size:12px;font-weight:600;color:var(--secondary)}
.gallery-heading small{font-weight:500;color:var(--muted);font-variant-numeric:tabular-nums}
.gallery-item{position:relative;animation:zg-settle-in var(--dur-smooth) var(--spring-smooth) both;animation-delay:calc(var(--i, 0) * 35ms)}
.gallery-item>.backdrop-swatch{width:100%;animation:none}
.gallery-item .swatch-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gallery-remove{position:absolute;top:-6px;right:-6px;z-index:3;display:grid;place-items:center;width:22px;height:22px;padding:0;border:1px solid var(--line);border-radius:50%;background:var(--surface);box-shadow:var(--shadow-1);color:var(--surface-ink);opacity:0;scale:.7;transition:opacity var(--dur-2) var(--ease-out),scale var(--dur-bounce) var(--spring-bouncy)}
.gallery-item:hover .gallery-remove,.gallery-remove:focus-visible{opacity:1;scale:1}
.gallery-remove:hover:not(:disabled){background:var(--danger);border-color:transparent;color:#fff}
.font-preview{padding:12px 0 14px;border-top:1px solid var(--separator)}
.font-preview p{margin:0;font-size:14px;line-height:1.8;color:var(--control-ink)}
.font-preview p+p{font-size:15px}
.background-heading>span{flex:1}
.background-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--secondary);font-size:12px}
.background-heading button{min-height:34px;padding:6px 15px;font-size:12px;font-weight:600;background-color:var(--glass-2);background-image:var(--glass-sheen);border:1px solid var(--glass-outline);border-radius:var(--r-control);box-shadow:var(--glass-control-shadow);color:var(--control-ink)}
.background-heading button:hover:not(:disabled){background-color:var(--control-hover);color:var(--control-ink)}
.background-file{display:none}
.background-setting .settings-help{margin:12px 0 0}
.quick-prompts-section{margin-top:24px;padding-top:20px;border-top:1px solid var(--separator)}
.quick-prompts-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:4px}
.quick-prompts-heading h3{margin:0 0 0 14px}
.quick-prompt-editor{padding:14px 16px 16px;margin:0 0 12px;min-width:0}
.quick-prompt-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}
.quick-prompt-heading h4{font-size:13px;font-weight:650;margin:0;color:var(--control-ink)}
.quick-prompt-heading button{height:30px;padding:4px 13px;font-size:11.5px;font-weight:600;border:1px solid var(--glass-outline);border-radius:var(--r-control);background-color:var(--glass-2);color:var(--control-ink);box-shadow:var(--glass-control-shadow)}
.quick-prompt-heading button:hover:not(:disabled){background-color:var(--control-hover)}
.quick-prompt-editor>label{display:flex;align-items:center;justify-content:space-between;gap:12px;color:var(--secondary);font-size:11.5px;margin-bottom:6px}
.quick-prompt-counter{color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.quick-prompt-editor>input,.quick-prompt-editor>textarea{box-sizing:border-box;display:block;width:100%;min-width:0;font:inherit;font-size:12.5px;line-height:1.7;padding:7px 13px;color:var(--control-ink);text-shadow:none}
.quick-prompt-editor>input{height:36px;margin-bottom:12px}
.quick-prompt-editor>textarea{resize:vertical;min-height:84px;max-height:240px;border-radius:var(--r-md);padding:9px 13px}
.capture-questions-section .settings-group:first-of-type{margin-top:4px}
.capture-question-list{position:relative}
.capture-question-editor .quick-prompt-heading h4{display:flex;align-items:center;gap:8px}
.capture-key{display:inline-grid;place-items:center;min-width:22px;height:22px;padding:0 6px;border-radius:7px;font:600 11.5px var(--font-mono);color:var(--control-ink);background:var(--fill-3);box-shadow:inset 0 -1px 0 var(--separator),0 0 0 .5px var(--separator)}
.add-capture-question{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:42px;font-size:12.5px;font-weight:600;border:1px dashed color-mix(in srgb,var(--control-ink) 22%,transparent);background:var(--fill-4);box-shadow:none;border-radius:var(--r-lg);color:var(--control-ink)}
.add-capture-question:hover:not(:disabled){background:var(--fill-3);border-color:color-mix(in srgb,var(--accent) 45%,transparent)}
.add-capture-question>span{color:var(--muted);font-weight:500;font-variant-numeric:tabular-nums}
.editor-list-enter-active{transition:opacity var(--dur-3) var(--ease-out),transform var(--dur-bounce) var(--spring-bouncy)}
.editor-list-leave-active{transition:opacity var(--dur-2) var(--ease-out),transform var(--dur-2) var(--ease-out);position:absolute;left:0;right:0}
.editor-list-enter-from{opacity:0;transform:translateY(-8px) scale(.97)}
.editor-list-leave-to{opacity:0;transform:scale(.96)}
.editor-list-move{transition:transform var(--dur-smooth) var(--spring-smooth)}
.settings-error{font-size:11.5px;line-height:1.8;color:var(--danger);margin:14px 14px 0;white-space:pre-line}
.settings-footer{padding:12px 16px 16px 22px;display:flex;align-items:center;gap:10px;border-top:1px solid var(--separator)}
.footer-space{flex:1}
.settings-footer button{min-width:86px;height:40px;font-size:13px;font-weight:600;padding:8px 20px;border-color:var(--glass-outline);border-radius:var(--r-control);background-color:var(--glass-2);background-image:var(--glass-sheen);color:var(--control-ink);box-shadow:var(--glass-control-shadow)}
.settings-footer button:hover:not(:disabled){background-color:var(--control-hover);border-color:var(--glass-outline);color:var(--control-ink)}
.settings-footer .text-action{min-width:0;height:34px;padding:5px 12px;font-size:12px;background:none;border:0;box-shadow:none;color:var(--accent)}
.settings-footer .text-action:hover:not(:disabled){background-color:color-mix(in srgb,var(--accent) 10%,transparent);color:var(--accent)}
/* 保存：着色玻璃主操作。 */
.settings-footer .settings-save{background-color:var(--accent-glass);background-image:var(--glass-tint-sheen);border-color:transparent;color:var(--accent-on);font-weight:650;box-shadow:0 8px 20px -10px color-mix(in srgb,var(--accent) 80%,transparent),inset 0 1px 0 rgb(255 255 255 / .25)}
.settings-footer .settings-save:hover:not(:disabled){background-color:var(--accent-glass-hover);border-color:transparent;color:var(--accent-on)}
@media(max-width:670px){.settings-backdrop{padding:12px}.settings-tabs{flex-basis:112px;padding:10px 0 10px 8px}.settings-tabs button{padding:9px 10px;gap:6px}.settings-content{padding:12px 14px 22px}.shortcut-row{flex-wrap:wrap}.shortcut-row>label{flex-basis:100%;margin-bottom:3px}.shortcut-row input{flex:1;max-width:200px}.setting-row select,.number-control{width:130px}.settings-dialog{max-height:94vh}.transparency-control{grid-template-columns:minmax(80px,1fr) 36px;width:175px}.transparency-row{gap:9px}.background-heading>span{flex-basis:100%}.backdrop-grid{grid-template-columns:repeat(3,1fr)}}
@media(prefers-reduced-transparency:reduce),(prefers-contrast:more){.settings-content{-webkit-mask-image:none;mask-image:none}}
</style>
