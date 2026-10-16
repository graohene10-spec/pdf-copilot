import { shallowRef } from 'vue'
import { getProvider, registerNativeModels } from './providers.mjs'

// Both AI settings and the composer observe the same session inventory. Merely
// inspecting models never changes the user's saved model, provider or budgets.
export const nativeModelInventory = shallowRef<any[]>(getProvider('codex')?.models || [])

export function registerNativeModelInventory(models: any[]) {
  registerNativeModels(models)
  nativeModelInventory.value = models
}
