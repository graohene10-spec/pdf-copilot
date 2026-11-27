import { reactive, shallowRef } from 'vue'
import { getNativeModels, getNativeStatus, getProvider, registerNativeModels } from './providers.mjs'

// Both AI settings and the composer observe the same session inventory. Merely
// inspecting models never changes the user's saved model, provider or budgets.
export const nativeModelInventory = shallowRef<any[]>(getProvider('codex')?.models || [])

/** 走本机登录的服务：不用 API Key，模型清单从本机读。 */
export const isNative = (provider: string) => provider === 'codex' || provider === 'antigravity'
export const antigravityInventory = shallowRef<any[]>([])
export const inventoryOf = (provider: string): any[] => provider === 'antigravity' ? antigravityInventory.value : nativeModelInventory.value
export function registerInventory(provider: string, models: any[]) {
  if (provider !== 'antigravity') { registerNativeModelInventory(models); return }
  getProvider('antigravity')!.models = models; antigravityInventory.value = models
}
/** 从本机读一次这家的模型清单并记下。 */
export async function loadInventory(provider: string, signal?: AbortSignal): Promise<any[]> {
  const list: any[] = await getNativeModels(signal, provider === 'antigravity' ? 'antigravity' : '')
  registerInventory(provider, list)
  return list
}
// 本机 Antigravity 的登录检查：只在设置里点了才跑。
export const antigravityCheck = reactive({ state: 'idle' as 'idle' | 'checking' | 'ok' | 'failed', text: '' })
let checking: Promise<boolean> | undefined
export function checkAntigravity(): Promise<boolean> {
  if (!(globalThis as any).__TAURI_INTERNALS__) return Promise.resolve(false)
  checking ??= (async () => {
    antigravityCheck.state = 'checking'; antigravityCheck.text = '正在检查本机 Antigravity…'
    try {
      const info: any = await getNativeStatus(undefined, 'antigravity')
      if (!info.installed) throw new Error('未找到 Antigravity CLI（agy）。')
      if (!info.loggedIn) throw new Error('Antigravity 尚未登录。请先在终端运行 agy 并登录。')
      const list = await loadInventory('antigravity')
      antigravityCheck.text = `Antigravity CLI ${info.version || ''} · 已登录 · ${list.length} 个模型`
      antigravityCheck.state = 'ok'
      return true
    } catch (cause: any) { antigravityCheck.text = cause?.message || String(cause); antigravityCheck.state = 'failed'; return false }
    finally { checking = undefined }
  })()
  return checking
}

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
