import { ref, onMounted, onBeforeUnmount } from 'vue'
import type { Window as NativeWindow } from '@tauri-apps/api/window'

export function useFullscreen(native: boolean, report: (message: string) => void) {
  const fullscreen = ref(false)
  const fullscreenPending = ref(false)
  let disposed = false
  let stateRead = 0
  let windowPromise: Promise<NativeWindow> | undefined
  const listeners: (() => void)[] = []
  const currentWindow = () => windowPromise ||= import('@tauri-apps/api/window').then(api => api.getCurrentWindow())

  async function syncNative() {
    const revision = ++stateRead
    try {
      const value = await (await currentWindow()).isFullscreen()
      if (!disposed && revision === stateRead) fullscreen.value = value
    } catch { /* A window may close while its resize event is being handled. */ }
  }
  function syncBrowser() { fullscreen.value = Boolean(document.fullscreenElement) }

  async function changeFullscreen(exit = false) {
    if (disposed || fullscreenPending.value) return
    fullscreenPending.value = true
    try {
      if (native) {
        const window = await currentWindow()
        if (disposed) return
        const current = await window.isFullscreen()
        if (disposed) return
        if (current || !exit) await window.setFullscreen(exit ? false : !current)
        await syncNative()
      } else {
        // Invoke before awaiting anything, preserving the click/key user gesture.
        if (document.fullscreenElement) await document.exitFullscreen()
        else if (!exit) await document.documentElement.requestFullscreen()
        if (!disposed) syncBrowser()
      }
    } catch (error: any) {
      if (!disposed) report(`全屏切换失败：${error?.message || String(error)}`)
    } finally {
      if (!disposed) fullscreenPending.value = false
    }
  }

  onMounted(async () => {
    if (!native) {
      syncBrowser()
      document.addEventListener('fullscreenchange', syncBrowser)
      listeners.push(() => document.removeEventListener('fullscreenchange', syncBrowser))
      return
    }
    try {
      const window = await currentWindow()
      if (disposed) return
      await syncNative()
      for (const subscribe of [
        () => window.onResized(() => { void syncNative() }),
        () => window.onFocusChanged(() => { void syncNative() }),
      ]) {
        const unlisten = await subscribe()
        if (disposed) unlisten(); else listeners.push(unlisten)
      }
    } catch (error: any) {
      if (!disposed) report(`全屏功能暂不可用：${error?.message || String(error)}`)
    }
  })
  onBeforeUnmount(() => {
    disposed = true; ++stateRead
    for (const unlisten of listeners) unlisten()
  })
  return { fullscreen, fullscreenPending, toggleFullscreen: () => changeFullscreen(), exitFullscreen: () => changeFullscreen(true) }
}
