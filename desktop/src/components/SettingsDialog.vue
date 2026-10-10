<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick, defineAsyncComponent } from 'vue'
import AppIcon from './AppIcon.vue'
import { useSettings, defaultPreferences, normalizePreferences, preferenceErrors, importBackgroundImage, SHORTCUTS, DEFAULT_SHORTCUTS, shortcutLabel, shortcutFromEvent, type AppPreferences, type ShortcutAction } from '../settings'

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
function switchTab(value: Tab) { tab.value = value; if (value === 'ai') aiVisited.value = true; recording.value = null; captureError.value = ''; status.value = '' }
function startRecording(action: ShortcutAction) { recording.value = action; captureError.value = '' }
function record(event: KeyboardEvent, action: ShortcutAction) {
  event.stopPropagation()
  if (event.key === 'Escape') { event.preventDefault(); if (!recording.value) close(); recording.value = null; captureError.value = ''; return }
  if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) return
  if (event.isComposing || event.keyCode === 229 || ['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return
  const binding = shortcutFromEvent(event)
  if (!binding) { captureError.value = '使用 Ctrl、Alt 或 Meta 加其他按键；浏览器保留快捷键不可使用。'; return }
  event.preventDefault()
  draft.value.shortcuts[action] = binding
  recording.value = null; captureError.value = ''
}
function disable(action: ShortcutAction) { draft.value.shortcuts[action] = ''; recording.value = null; captureError.value = '' }
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
  if (saving.value || importingImage.value || !ready.value || disposed || closing) return
  if (errors.value.length) { status.value = errors.value[0]; return }
  saving.value = true; status.value = ''
  try {
    let ai: any
    if (aiVisited.value) {
      if (!aiSettings.value) return
      ai = await aiSettings.value.save()
      if (!ai) { tab.value = 'ai'; return }
    }
    if (tab.value !== 'ai' || JSON.stringify(draft.value) !== baseline) {
      const value = await shared.save(draft.value)
      emit('saved', value)
    }
    if (ai) emit('ai-saved', ai)
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
  if (event.key === 'Escape' && !recording.value) { event.preventDefault(); close() }
}
</script>

<template>
  <div class="settings-backdrop" @click.self="close">
    <section ref="dialog" class="settings-dialog" data-glass-interactive="panel" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabindex="-1" @keydown="dialogKeydown">
      <header class="dialog-header"><h2 id="settings-title">设置</h2><button class="settings-close" :disabled="saving" @click="close" aria-label="关闭设置"><AppIcon name="close" :size="18" /></button></header>
      <div class="settings-body">
        <nav class="settings-tabs" aria-label="设置分类"><button v-for="item in tabs" :key="item.id" :class="{ selected: tab === item.id }" @click="switchTab(item.id)" :aria-current="tab === item.id ? 'page' : undefined"><AppIcon :name="item.icon" :size="17" />{{ item.label }}</button></nav>
        <div class="settings-content">
          <p v-if="!ready" class="settings-help">{{ status || '正在读取设置…' }}</p>
          <template v-else-if="tab === 'appearance'">
            <h3>外观</h3>
            <label class="setting-row"><span>主题</span><select v-model="draft.appearance.theme" :disabled="saving" aria-label="主题"><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
            <label class="setting-row"><span>默认文档视图</span><select v-model="draft.appearance.libraryView" :disabled="saving" aria-label="默认文档视图"><option value="grid">卡片</option><option value="list">列表</option></select></label>
            <div class="setting-row transparency-row"><label for="glass-transparency">玻璃透明度</label><div class="transparency-control"><input id="glass-transparency" v-model.number="draft.appearance.glassTransparency" :disabled="saving" type="range" min="0" max="100" step="1" aria-label="玻璃透明度" :aria-valuetext="`${draft.appearance.glassTransparency}%`" /><output for="glass-transparency">{{ draft.appearance.glassTransparency }}%</output><span class="slider-endpoints" aria-hidden="true"><span>实色</span><span>清透</span></span></div></div>
            <div class="background-setting"><div class="background-heading"><span>底板图片</span><button type="button" :disabled="saving || importingImage" @click="imageInput?.click()">{{ importingImage ? '正在处理…' : draft.appearance.background ? '替换图片' : '选择图片' }}</button><button v-if="draft.appearance.background" type="button" :disabled="saving || importingImage" @click="restoreBackground" aria-label="恢复默认底板">恢复默认</button></div><input ref="imageInput" class="background-file" type="file" accept="image/png,image/jpeg,image/webp" tabindex="-1" aria-label="底板图片文件" @change="chooseBackground" /><div v-if="draft.appearance.background" class="background-preview"><img :src="draft.appearance.background.dataUrl" alt="底板图片预览" /><span :title="draft.appearance.background.name">{{ draft.appearance.background.name }}</span></div><p v-else class="settings-help background-default">使用默认底板</p><p v-if="imageError" class="settings-error" role="status">{{ imageError }}</p><p class="settings-help">支持 PNG、JPEG、WebP；图片保存在本机，自动适应窗口。调节后可预览，点击保存生效。</p></div>
            <p class="settings-help">透明度仅影响侧栏、工具栏与面板，正文保持实色。系统开启「减少透明度」时自动使用实色。</p>
          </template>
          <template v-else-if="tab === 'reading'">
            <h3>PDF</h3>
            <label class="setting-row"><span>初始缩放</span><select v-model="zoomMode" aria-label="PDF 初始缩放模式"><option value="fit-width">适应宽度</option><option value="custom">自定义</option></select></label>
            <label v-if="zoomMode === 'custom'" class="setting-row"><span>缩放比例</span><span class="number-control"><input v-model.number="draft.pdf.initialZoom" type="number" min="25" max="400" step="5" aria-label="PDF 初始缩放比例" /><span>%</span></span></label>
            <label class="setting-row"><span>缩放步长</span><span class="number-control"><input v-model.number="draft.pdf.zoomStep" type="number" min="5" max="50" step="1" aria-label="PDF 缩放步长" /><span>%</span></span></label>
            <label class="setting-check"><input v-model="draft.pdf.fitOnPanelOverflow" type="checkbox" aria-label="侧栏打开后页面超宽时适应宽度" /><span>侧栏打开后，仅在页面超宽时适应宽度</span></label>
            <label class="setting-check"><input v-model="draft.pdf.openAssistantOnCapture" type="checkbox" aria-label="PDF 框选后自动打开阅读助手" /><span>PDF 框选后自动打开阅读助手</span></label>
            <h3 class="section-heading">Markdown</h3>
            <label class="setting-row"><span>默认字号</span><span class="number-control"><input v-model.number="draft.markdown.fontSize" type="number" min="13" max="28" step="1" aria-label="Markdown 默认字号" /><span>px</span></span></label>
            <label class="setting-row"><span>内容宽度</span><span class="number-control"><input v-model.number="draft.markdown.contentWidth" type="number" min="600" max="1400" step="20" aria-label="Markdown 内容宽度" /><span>px</span></span></label>
          </template>
          <template v-else-if="tab === 'shortcuts'">
            <div class="shortcuts-heading"><h3>快捷键</h3><button class="text-action" @click="restoreAll">恢复全部默认</button></div>
            <p class="settings-help">点击按键组合后录入。Esc 取消录入；已禁用的动作仍可通过按钮使用。</p>
            <div v-for="item in SHORTCUTS" :key="item.action" class="shortcut-row"><label :for="`shortcut-${item.action}`">{{ item.label }}</label><input :id="`shortcut-${item.action}`" :value="recording === item.action ? '按下快捷键…' : shortcutLabel(draft.shortcuts[item.action])" :class="{ recording: recording === item.action }" readonly :aria-label="`${item.label}快捷键`" data-shortcut-capture @focus="startRecording(item.action)" @click="startRecording(item.action)" @keydown="record($event, item.action)" @blur="recording === item.action && (recording = null)" /><button @click="disable(item.action)" :aria-label="`禁用${item.label}快捷键`" :disabled="!draft.shortcuts[item.action]">禁用</button><button @click="restoreShortcut(item.action)" :aria-label="`恢复${item.label}默认快捷键`">默认</button></div>
            <p v-if="captureError" class="settings-error" role="status">{{ captureError }}</p>
          </template>
          <AiSettings v-if="ready && aiVisited" v-show="tab === 'ai'" ref="aiSettings" embedded />
          <p v-if="ready && errors.length" class="settings-error" role="status">{{ errors[0] }}</p>
          <p v-if="ready && status" class="settings-error" role="status">{{ status }}</p>
        </div>
      </div>
      <footer class="settings-footer"><button v-if="tab !== 'ai'" class="text-action" @click="resetTab" :disabled="saving || importingImage || !ready">恢复默认</button><span class="footer-space"></span><button @click="close" :disabled="saving">取消</button><button class="settings-save" @click="save" :disabled="saving || importingImage || !ready || !!errors.length">{{ saving ? '保存中…' : '保存' }}</button></footer>
    </section>
  </div>
</template>

<style scoped>
/* 设置为一张悬浮镜片；表单仍保持稳定对比度。 */
.settings-backdrop{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--canvas-deep) 27%,transparent);z-index:80;padding:25px}
.settings-dialog{position:relative;width:760px;max-width:100%;height:640px;max-height:90vh;background-color:var(--popup-glass);background-image:var(--popup-sheen);-webkit-backdrop-filter:blur(var(--popup-blur)) saturate(var(--glass-sat));backdrop-filter:blur(var(--popup-blur)) saturate(var(--glass-sat));border:1px solid var(--glass-outline);border-radius:0;box-shadow:0 24px 80px color-mix(in srgb,var(--canvas-deep) 24%,transparent),var(--shadow-3),var(--glass-edge);display:flex;flex-direction:column;color:var(--ink);overflow:hidden;transform-origin:50% 65%}
:global(:root[data-glass='solid']) .settings-dialog,:global(:root[data-contrast='high']) .settings-dialog{background-color:var(--surface);background-image:none;-webkit-backdrop-filter:none;backdrop-filter:none}
@media(prefers-reduced-transparency:reduce),(prefers-contrast:more),(forced-colors:active){.settings-dialog{background-color:var(--surface);background-image:none;-webkit-backdrop-filter:none;backdrop-filter:none}}
button{color:var(--control-ink)}
.dialog-header{display:flex;align-items:center;justify-content:space-between;padding:15px 17px;margin:8px 8px 0;background-color:var(--glass-1);background-image:var(--glass-sheen);border:1px solid var(--glass-outline);border-radius:0;box-shadow:var(--glass-edge)}
.dialog-header h2{font-size:17px;font-weight:600;margin:0}
.settings-close{padding:7px;border:1px solid var(--glass-outline);background-color:var(--glass-1);background-image:var(--glass-sheen);color:var(--control-ink);border-radius:0;box-shadow:var(--glass-control-shadow);transition:background-color var(--dur-1) var(--ease-soft)}
.settings-close:hover:not(:disabled){background-color:var(--control-hover);color:var(--control-ink)}
.settings-body{display:flex;flex:1;min-height:0}
.settings-tabs{flex:0 0 144px;padding:10px 8px;margin:9px 0 9px 8px;background-color:var(--glass-1);background-image:var(--glass-sheen);border:1px solid var(--glass-outline);border-radius:0;box-shadow:var(--glass-edge);display:flex;flex-direction:column;gap:6px}
.settings-tabs button{font-size:12px;justify-content:flex-start;gap:10px;background:none;border:0;padding:11px 13px;color:var(--control-ink);border-radius:var(--r-sm);transition:background-color var(--dur-1) var(--ease-soft)}
.settings-tabs button:hover:not(:disabled){background-color:var(--control-hover);color:var(--control-ink)}
/* 选中的分类页仅调整灰度底色，保持统一文字颜色。 */
.settings-tabs button.selected{background-color:var(--control-selected);background-image:var(--glass-sheen);color:var(--control-ink);font-weight:550;box-shadow:var(--glass-control-shadow)}
.settings-tabs button.selected:hover:not(:disabled){background-color:var(--control-selected-hover);color:var(--control-ink)}
.settings-content{flex:1;min-width:0;overflow:auto;padding:25px 29px}
.settings-content h3{font-size:14px;font-weight:600;margin:0 0 19px}
.setting-row{display:flex;align-items:center;justify-content:space-between;gap:15px;padding:12px 0;font-size:12px;color:var(--secondary);border-bottom:1px solid var(--line-soft)}
.setting-row select{width:170px;font-size:12px;padding:7px 9px;background-color:var(--glass-2);border-color:var(--glass-outline);border-radius:var(--r-sm);color:var(--control-ink);box-shadow:var(--glass-edge)}
.number-control{display:flex;align-items:center;gap:9px;justify-content:flex-end;width:170px;color:var(--muted);font-size:11px}
.number-control input{width:107px;font-size:12px;padding:7px 9px;background-color:var(--glass-2);border-color:var(--glass-outline);border-radius:var(--r-sm);color:var(--control-ink);box-shadow:var(--glass-edge)}
.number-control>span{width:19px}
.setting-check{display:flex;align-items:flex-start;gap:8px;font-size:12px;color:var(--secondary);line-height:1.8;margin-top:19px}
.setting-check input{margin-top:5px;accent-color:var(--accent)}
.settings-content .section-heading{margin-top:34px}
.shortcuts-heading{display:flex;align-items:center;justify-content:space-between;gap:15px}
.shortcuts-heading h3{margin-bottom:0}
.text-action{padding:5px 0;border:0;background:none;color:var(--control-ink);font-size:11px}
.text-action:hover:not(:disabled){background-color:var(--control-hover);color:var(--control-ink)}
.settings-help{font-size:11px;color:var(--muted);line-height:1.8;margin:14px 0 16px}
.shortcut-row{display:flex;align-items:center;gap:6px;padding:9px 0;border-bottom:1px solid var(--line-soft)}
.shortcut-row>label{flex:1;min-width:95px;font-size:11px;color:var(--secondary)}
.shortcut-row input{width:145px;font-size:11px;padding:7px 9px;text-align:center;cursor:pointer;color:var(--control-ink);background:var(--surface-2);border-radius:var(--r-sm)}
.shortcut-row input.recording{border-color:var(--accent);background:var(--control-selected);color:var(--control-ink)}
.shortcut-row button{border:0;background:none;color:var(--control-ink);font-size:10px;padding:5px;border-radius:var(--r-xs)}
.shortcut-row button:hover:not(:disabled){background-color:var(--control-hover);color:var(--control-ink)}
.transparency-row{align-items:flex-start;padding-bottom:17px}
.transparency-row>label{padding-top:7px}
.transparency-control{display:grid;grid-template-columns:minmax(120px,1fr) 43px;align-items:center;gap:3px 9px;width:250px;max-width:65%}
.transparency-control input{width:100%;min-width:0;height:30px;margin:0;cursor:pointer;accent-color:var(--control-ink);background:transparent;border:0;box-shadow:none;padding:0}
.transparency-control output{font-size:12px;font-variant-numeric:tabular-nums;text-align:right;color:var(--control-ink)}
.slider-endpoints{display:flex;justify-content:space-between;grid-column:1;font-size:10px;color:var(--muted)}
.background-setting{padding:17px 0 0;font-size:12px;color:var(--secondary)}
.background-heading{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.background-heading>span{flex:1}
.background-heading button{min-height:33px;padding:6px 12px;font-size:11px;background-color:var(--glass-2);background-image:var(--glass-sheen);border:1px solid var(--glass-outline);border-radius:0;box-shadow:var(--glass-control-shadow);color:var(--control-ink)}
.background-heading button:hover:not(:disabled){background-color:var(--control-hover);color:var(--control-ink)}
.background-file{display:none}
.background-preview{margin-top:12px;display:flex;align-items:center;gap:13px;min-width:0}
.background-preview img{width:114px;height:64px;object-fit:cover;flex-shrink:0;border:1px solid var(--glass-outline);box-shadow:var(--shadow-1)}
.background-preview>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--control-ink);font-size:11px}
.background-default{margin-bottom:0}
.settings-error{font-size:11px;line-height:1.8;color:var(--danger);margin:17px 0 0;white-space:pre-line}
.settings-footer{margin:0 8px 8px;border:1px solid var(--glass-outline);border-radius:0;background-color:var(--glass-1);background-image:var(--glass-sheen);box-shadow:var(--glass-edge);padding:12px 15px;display:flex;align-items:center;gap:9px}
.footer-space{flex:1}
.settings-footer button{font-size:12px;padding:8px 17px;border-color:var(--glass-outline);border-radius:var(--r-sm);background-color:var(--glass-2);background-image:var(--glass-sheen);color:var(--control-ink);box-shadow:var(--glass-control-shadow)}
.settings-footer button:hover:not(:disabled){background-color:var(--control-hover);border-color:var(--glass-outline);color:var(--control-ink)}
.settings-footer .text-action{padding:5px 0;font-size:11px}
.settings-footer .settings-save{background-color:var(--control-selected);background-image:var(--glass-sheen);border-color:var(--glass-outline);color:var(--control-ink);font-weight:550;box-shadow:var(--glass-control-shadow)}
.settings-footer .settings-save:hover:not(:disabled){background-color:var(--control-selected-hover);border-color:var(--glass-outline);color:var(--control-ink)}
@media(max-width:670px){.settings-backdrop{padding:12px}.settings-tabs{flex-basis:105px;padding:16px 7px}.settings-tabs button{padding:10px 8px;gap:6px}.settings-content{padding:23px 18px}.shortcut-row{flex-wrap:wrap}.shortcut-row>label{flex-basis:100%;margin-bottom:3px}.shortcut-row input{flex:1;max-width:200px}.setting-row select,.number-control{width:130px}.settings-dialog{max-height:94vh}.settings-content h3{font-size:13px}.transparency-control{grid-template-columns:minmax(80px,1fr) 36px;width:175px}.transparency-row{gap:9px}.background-heading>span{flex-basis:100%}.background-preview img{width:86px;height:52px}}
</style>
