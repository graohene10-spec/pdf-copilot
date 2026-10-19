<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'
import { renderMarkdown } from '../ai/render'
import { useUpdater } from '../ui/updater'
import { isRepoPage } from '../ui/update-select'
import { openRepoPage } from '../sdk/updater'

const updater = useUpdater()
const state = updater.state
const visible = updater.visible
const info = computed(() => state.info)
const notes = computed(() => info.value?.notes.trim() ? renderMarkdown(info.value.notes) : '')
const canInstall = computed(() => !!info.value?.installer)
const published = computed(() => {
  const time = info.value?.publishedAt ? new Date(info.value.publishedAt) : null
  return time && !Number.isNaN(time.getTime()) ? time.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }) : ''
})
const percent = computed(() => {
  const progress = state.progress
  return progress?.total ? Math.min(100, Math.round(progress.downloaded / progress.total * 100)) : null
})
const megabytes = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`
const progressText = computed(() => {
  const progress = state.progress
  if (!progress) return '正在连接…'
  return progress.total ? `${megabytes(progress.downloaded)} / ${megabytes(progress.total)}` : megabytes(progress.downloaded)
})
const hint = computed(() => {
  if (canInstall.value || !info.value) return ''
  return '此版本没有可校验的更新包，请在发布页下载。'
})

function retry() { void updater.update() }
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && state.phase !== 'installing' && state.phase !== 'downloading') { event.stopPropagation(); updater.later() }
}
// Release notes link to README / release notes of this repository; open those in the browser.
function notesClick(event: MouseEvent) {
  const anchor = (event.target as HTMLElement | null)?.closest?.('a')
  if (!anchor) return
  event.preventDefault()
  const href = anchor.getAttribute('href') || ''
  if (isRepoPage(href)) void openRepoPage(href).catch(() => {})
}
</script>

<template>
  <Transition name="update-card">
    <section v-if="visible && info" class="update-card" role="dialog" aria-label="应用更新" aria-describedby="update-card-meta" @keydown="keydown">
      <header class="update-head">
        <span class="update-mark" aria-hidden="true"><AppIcon name="sparkle" :size="16" /></span>
        <div class="update-title">
          <h2>新版本 {{ info.version }}<span v-if="info.prerelease" class="update-badge">测试版</span></h2>
          <p id="update-card-meta">当前 {{ state.status?.current || '—' }}<template v-if="published"> · {{ published }}发布</template></p>
        </div>
      </header>

      <div v-if="notes" class="update-notes" tabindex="0" aria-label="更新说明" v-html="notes" @click="notesClick" />

      <div v-if="state.phase === 'downloading'" class="update-progress">
        <div class="update-track" role="progressbar" aria-label="下载更新" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="percent ?? undefined" :aria-valuetext="progressText" :class="{ indeterminate: percent === null }">
          <i :style="{ width: percent === null ? undefined : `${percent}%` }" />
        </div>
        <p><span>正在下载 {{ percent === null ? '' : `${percent}%` }}</span><span>{{ progressText }}</span></p>
      </div>
      <p v-else-if="state.phase === 'ready'" class="update-status" role="status">更新包已下载并通过校验，正在安装…</p>
      <p v-else-if="state.phase === 'installing'" class="update-status" role="status">正在安装更新，开智会自动关闭并重新打开…</p>
      <p v-else-if="state.phase === 'error'" class="update-status update-error" role="alert">{{ state.error }}</p>
      <p v-else-if="hint" class="update-status">{{ hint }}</p>

      <footer class="update-actions">
        <template v-if="state.phase === 'downloading'">
          <span class="update-space" />
          <button type="button" @click="updater.cancelDownload()" aria-label="取消下载更新">取消</button>
        </template>
        <template v-else-if="state.phase !== 'installing' && state.phase !== 'ready'">
          <button type="button" class="update-text" @click="updater.skip()" aria-label="跳过此版本，不再自动提示">跳过此版本</button>
          <span class="update-space" />
          <button type="button" @click="updater.later()" aria-label="稍后提醒">稍后</button>
          <button v-if="!canInstall" type="button" class="update-primary" @click="updater.openPage()" aria-label="前往发布页面下载"><AppIcon name="external" :size="14" />前往下载页</button>
          <button v-else-if="state.phase === 'error'" type="button" class="update-primary" @click="retry" aria-label="重试更新">重试</button>
          <button v-else type="button" class="update-primary" @click="updater.update()" aria-label="立即更新，完成后自动重启">立即更新</button>
        </template>
      </footer>
    </section>
  </Transition>
</template>

<style scoped>
/* 更新提示：右下角一块厚玻璃卡片，叠在提示条之上；文字较多，用弹窗玻璃保证可读。 */
.update-card{position:fixed;right:20px;bottom:20px;z-index:calc(var(--z-toast) + 1);box-sizing:border-box;width:min(360px,calc(100vw - 32px));max-height:calc(100vh - 40px);display:flex;flex-direction:column;gap:12px;padding:16px 16px 14px;border-radius:16px;color:var(--surface-ink);font-family:var(--font-ui);background-color:var(--popup-glass);background-image:var(--popup-sheen);--lens-blur:var(--popup-blur);--lens-saturate:var(--glass-sat);-webkit-backdrop-filter:var(--refraction, blur(var(--popup-blur)) saturate(var(--glass-sat)));backdrop-filter:var(--refraction, blur(var(--popup-blur)) saturate(var(--glass-sat)));border:1px solid var(--glass-outline);box-shadow:var(--shadow-3),var(--glass-edge);transform-origin:100% 100%}
.update-head{display:flex;align-items:center;gap:11px}
.update-mark{flex:0 0 auto;display:grid;place-items:center;width:34px;height:34px;border-radius:11px;background:var(--brand-gradient);color:var(--brand-ink);box-shadow:0 4px 12px -4px color-mix(in srgb,var(--accent) 60%,transparent),inset 0 1px 0 rgb(255 255 255 / .3)}
.update-title{min-width:0}
.update-title h2{display:flex;align-items:center;gap:8px;margin:0;font-family:var(--font-display);font-size:15px;font-weight:700;letter-spacing:-.1px;line-height:1.3}
.update-title p{margin:2px 0 0;font-size:11.5px;color:var(--surface-muted);font-variant-numeric:tabular-nums}
.update-badge{display:inline-flex;align-items:center;height:19px;padding:0 8px;border-radius:var(--r-full);font-size:10.5px;font-weight:650;letter-spacing:.3px;color:var(--warning);background:color-mix(in srgb,var(--warning) 14%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--warning) 28%,transparent)}
.update-notes{max-height:180px;overflow:auto;overscroll-behavior:contain;margin:0 -4px;padding:8px 12px;border-radius:12px;background:var(--fill-4);font-size:12.5px;line-height:1.7;color:var(--surface-secondary);overflow-wrap:anywhere;scrollbar-width:thin}
.update-notes:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.update-notes :deep(:first-child){margin-top:0}
.update-notes :deep(:last-child){margin-bottom:0}
.update-notes :deep(h1),.update-notes :deep(h2),.update-notes :deep(h3),.update-notes :deep(h4){margin:10px 0 4px;font-size:12.5px;font-weight:650;color:var(--surface-ink)}
.update-notes :deep(p){margin:4px 0}
.update-notes :deep(ul),.update-notes :deep(ol){margin:4px 0;padding-left:18px}
.update-notes :deep(li+li){margin-top:2px}
.update-notes :deep(code){padding:1px 5px;border-radius:5px;font:11.5px var(--font-mono);background:var(--fill-3)}
.update-notes :deep(a){color:var(--accent);text-decoration:none}
.update-notes :deep(a:hover){text-decoration:underline}
.update-notes :deep(.answer-code-head),.update-notes :deep(.answer-copy){display:none}
.update-notes :deep(pre){margin:6px 0;padding:8px 10px;border-radius:8px;background:var(--fill-3);overflow:auto}
.update-progress p{display:flex;justify-content:space-between;gap:10px;margin:6px 2px 0;font-size:11.5px;color:var(--surface-muted);font-variant-numeric:tabular-nums}
.update-track{position:relative;height:6px;border-radius:var(--r-full);background:var(--fill-2);overflow:hidden}
.update-track i{position:absolute;inset:0 auto 0 0;border-radius:inherit;background:var(--accent);transition:width var(--dur-2) var(--ease-out)}
.update-track.indeterminate i{width:35%;animation:update-indeterminate 1.2s var(--ease-soft) infinite}
@keyframes update-indeterminate{from{transform:translateX(-100%)}to{transform:translateX(290%)}}
.update-status{margin:0 2px;font-size:12px;line-height:1.65;color:var(--surface-secondary)}
.update-error{color:var(--danger)}
.update-actions{display:flex;align-items:center;gap:8px}
.update-space{flex:1}
.update-actions button{height:34px;padding:0 14px;font-size:12.5px;font-weight:600;white-space:nowrap;transition:background-color var(--dur-1) var(--ease-soft),transform var(--dur-press) var(--spring-press)}
.update-actions button:active:not(:disabled){transform:scale(.96)}
.update-actions .update-text{padding:0 8px;border:0;background:none;box-shadow:none;color:var(--surface-muted);font-weight:550}
.update-actions .update-text:hover:not(:disabled){background-color:var(--fill-3);color:var(--surface-ink)}
/* 主操作：着色玻璃，与设置中的「保存」一致。 */
.update-actions .update-primary{background-color:var(--accent-glass);background-image:var(--glass-tint-sheen);border-color:transparent;color:var(--accent-on);box-shadow:0 8px 20px -10px color-mix(in srgb,var(--accent) 80%,transparent),inset 0 1px 0 rgb(255 255 255 / .25)}
.update-actions .update-primary:hover:not(:disabled){background-color:var(--accent-glass-hover);border-color:transparent;color:var(--accent-on)}
/* 入场：从右下角弹出；离场：轻微下沉淡出。 */
.update-card-enter-active{animation:update-card-in var(--dur-bounce) var(--spring-snappy) both}
.update-card-leave-active{transition:opacity var(--dur-2) var(--ease-out),transform var(--dur-2) var(--ease-out)}
.update-card-leave-to{opacity:0;transform:translateY(10px) scale(.97)}
@keyframes update-card-in{from{opacity:0;transform:translateY(18px) scale(.94)}to{opacity:1;transform:none}}
:root[data-glass='solid'] .update-card,:root[data-contrast='high'] .update-card{background-color:var(--surface);background-image:none;-webkit-backdrop-filter:none;backdrop-filter:none}
@media(prefers-reduced-transparency:reduce),(prefers-contrast:more),(forced-colors:active){.update-card{background-color:var(--surface);background-image:none;-webkit-backdrop-filter:none;backdrop-filter:none}}
@media(prefers-reduced-motion:reduce){.update-card-enter-active,.update-track.indeterminate i{animation:none}.update-card-leave-active,.update-track i,.update-actions button{transition:none}}
</style>
