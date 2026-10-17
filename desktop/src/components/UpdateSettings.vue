<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { isDesktop } from '../sdk'
import { useUpdater } from '../ui/updater'

/** 「更新」 section of the settings dialog; the two toggles are bound to preferences by the parent. */
const props = withDefaults(defineProps<{ disabled?: boolean }>(), { disabled: false })
const autoCheck = defineModel<boolean>('autoCheck', { default: true })
const prerelease = defineModel<boolean>('prerelease', { default: false })
const updater = useUpdater()
const state = updater.state

onMounted(() => { void updater.loadStatus() })

const edition = computed(() => !isDesktop ? '浏览器预览' : state.status ? (state.status.installed ? '安装版' : '免安装版') : '')
const found = computed(() => state.info ? `${state.info.version}${state.info.prerelease ? '（测试版）' : ''}` : '')
const statusText = computed(() => {
  switch (state.phase) {
    case 'checking': return '正在检查…'
    case 'up-to-date': return '已是最新版本'
    case 'available': return `发现新版本 ${found.value}`
    case 'downloading': return `正在下载 ${found.value}…`
    case 'ready': return `${found.value} 已下载，可以安装`
    case 'installing': return '正在启动安装程序…'
    case 'error': return state.errorSource === 'check' ? `检查失败：${state.error}` : `发现新版本 ${found.value}，${state.errorSource === 'install' ? '安装' : '下载'}未完成`
    default: return state.skippedAvailable ? `已跳过 ${state.skippedAvailable}，点「检查更新」可重新查看` : state.lastChecked ? '未发现可提示的新版本' : '尚未检查'
  }
})
const lastChecked = computed(() => state.lastChecked
  ? new Date(state.lastChecked).toLocaleString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '尚未检查')
const hidden = computed(() => !!state.info && state.dismissedVersion === state.info.version)
const checking = computed(() => state.phase === 'checking' || state.phase === 'downloading' || state.phase === 'installing')

function check() { void updater.check({ manual: true, includePrerelease: prerelease.value }) }
</script>

<template>
  <section class="update-settings" aria-labelledby="update-settings-title">
    <h3 id="update-settings-title" class="section-heading">更新</h3>
    <div class="settings-group">
      <div class="setting-row"><span>当前版本</span><span class="update-version">{{ state.status?.current || '—' }}<small v-if="edition">{{ edition }}</small></span></div>
      <div class="setting-row">
        <span class="update-check-status" :class="{ failed: state.phase === 'error' && state.errorSource === 'check' }" role="status" aria-live="polite">{{ statusText }}</span>
        <span class="update-check-actions">
          <button v-if="hidden" type="button" class="text-action" :disabled="props.disabled" @click="updater.show()">查看</button>
          <button type="button" class="update-check" :disabled="props.disabled || checking" aria-label="检查更新" @click="check">{{ state.phase === 'checking' ? '正在检查…' : '检查更新' }}</button>
        </span>
      </div>
      <label class="setting-check"><input v-model="autoCheck" type="checkbox" :disabled="props.disabled" aria-label="自动检查更新" /><span>自动检查更新</span></label>
      <label class="setting-check"><input v-model="prerelease" type="checkbox" :disabled="props.disabled" aria-label="接收测试版更新" aria-describedby="update-prerelease-help" /><span>接收测试版更新</span></label>
    </div>
    <p id="update-prerelease-help" class="settings-help">上次检查：{{ lastChecked }}。测试版供提前试用新功能，可能不够稳定；关闭后，等到更高的正式版发布时再更新。<template v-if="isDesktop && state.status && !state.status.installed">免安装版不能自动安装，发现新版本时请从发布页下载。</template></p>
  </section>
</template>

<style scoped>
/* 与设置对话框的分组、行和开关一致（其样式为 scoped，这里按同样的数值重复）。 */
.update-settings h3{font-size:12px;font-weight:600;letter-spacing:.3px;color:var(--muted);margin:26px 0 8px 14px}
/* 作为单独分类页的第一节时，与其他分类页标题的上边距一致。 */
.update-settings:first-child h3{margin-top:6px}
.settings-group{position:relative;border-radius:var(--r-lg);background-color:color-mix(in srgb,var(--glass-2) 60%,var(--fill-4));background-image:var(--glass-sheen);box-shadow:var(--glass-control-edge);padding:2px 16px;margin-bottom:8px}
.setting-row{display:flex;align-items:center;justify-content:space-between;gap:15px;min-height:50px;padding:8px 0;font-size:13px;color:var(--secondary);border-bottom:1px solid var(--separator)}
.setting-check{display:flex;flex-direction:row-reverse;align-items:center;justify-content:space-between;gap:14px;min-height:50px;padding:8px 0;font-size:13px;color:var(--secondary);line-height:1.6;border-bottom:1px solid var(--separator);cursor:pointer}
.setting-check input{margin:0}
.settings-group>:last-child{border-bottom:0}
.settings-help{font-size:11.5px;color:var(--muted);line-height:1.75;margin:8px 14px 18px}
.update-version{display:flex;align-items:baseline;gap:8px;font-weight:600;color:var(--control-ink);font-variant-numeric:tabular-nums}
.update-version small{font-size:11px;font-weight:500;color:var(--muted)}
.update-check-status{min-width:0;overflow-wrap:anywhere}
.update-check-status.failed{color:var(--danger)}
.update-check-actions{display:flex;align-items:center;gap:6px;flex:0 0 auto}
.update-check{min-height:34px;padding:6px 15px;font-size:12px;font-weight:600;background-color:var(--glass-2);background-image:var(--glass-sheen);border:1px solid var(--glass-outline);border-radius:var(--r-full);box-shadow:var(--glass-control-shadow);color:var(--control-ink)}
.update-check:hover:not(:disabled){background-color:var(--control-hover);color:var(--control-ink)}
.text-action{height:30px;padding:5px 12px;border:0;background:none;box-shadow:none;color:var(--accent);font-size:12px;font-weight:600}
.text-action:hover:not(:disabled){background-color:color-mix(in srgb,var(--accent) 10%,transparent);color:var(--accent)}
</style>
