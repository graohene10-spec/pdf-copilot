import { reactive, shallowRef } from 'vue'
import { getNativeModels, getNativeStatus, getProvider, registerNativeModels } from './providers.mjs'

// Both AI settings and the composer observe the same session inventory. Merely
// inspecting models never changes the user's saved model, provider or budgets.
export const nativeModelInventory = shallowRef<any[]>(getProvider('codex')?.models || [])

export function registerNativeModelInventory(models: any[]) {
  registerNativeModels(models)
  nativeModelInventory.value = models
}

// 本机 Codex 的登录检查：打开应用时自己跑一次（只在有功能用到 Codex 时），设置里的按钮是同一件事。
export const codexCheck = reactive({ state: 'idle' as 'idle' | 'checking' | 'ok' | 'failed', text: '' })
let running: Promise<boolean> | undefined
export function checkCodex(): Promise<boolean> {
  if (!(globalThis as any).__TAURI_INTERNALS__) return Promise.resolve(false)
  running ??= (async () => {
    codexCheck.state = 'checking'; codexCheck.text = '正在检查本机 Codex…'
    try {
      const info: any = await getNativeStatus()
      if (!info.compatible || !info.loggedIn) throw new Error(info.diagnostic || (info.loggedIn === false ? 'Codex 尚未登录。请先在 Codex 中登录。' : '未找到可用 Codex。请先安装 Codex 桌面版或 CLI。'))
      const list: any[] = await getNativeModels()
      registerNativeModelInventory(list)
      // 用的是 Codex 桌面版自带的那份，还是单独装的 CLI：看它在哪。
      const desktopApp = /[\\/](OpenAI[\\/]Codex|Programs[\\/][^\\/]*Codex)[\\/]/i.test(String(info.path || ''))
      codexCheck.text = `Codex ${desktopApp ? '桌面版' : 'CLI'} ${String(info.version || '').replace(/^codex-cli\s*/i, '')} · 已登录 · ${list.length} 个模型`
      codexCheck.state = 'ok'
      return true
    } catch (cause: any) { codexCheck.text = cause?.message || String(cause); codexCheck.state = 'failed'; return false }
    finally { running = undefined }
  })()
  return running
}
