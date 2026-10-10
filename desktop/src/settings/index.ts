import { computed, ref, shallowRef } from 'vue'
import { library } from '../sdk'
import { SETTINGS_KEY, defaultPreferences, normalizePreferences, preferenceErrors, type AppPreferences, type AppearancePreferences } from './model'
export * from './model'
export * from './background'

const preferences = ref<AppPreferences>(defaultPreferences())
const loaded = ref(false)
const appearancePreview = shallowRef<AppearancePreferences | null>(null)
export const effectiveAppearance = computed(() => appearancePreview.value ?? preferences.value.appearance)
export function previewAppearance(value: AppearancePreferences | null): void {
  appearancePreview.value = value ? { ...value, background: value.background ? { ...value.background } : null } : null
}
let pendingLoad: Promise<AppPreferences> | null = null
export async function loadSettings(): Promise<AppPreferences> {
  if (loaded.value) return preferences.value
  if (pendingLoad) return pendingLoad
  pendingLoad = (async () => {
    const stored = await library.getSetting(SETTINGS_KEY)
    let parsed: unknown
    try { parsed = stored ? JSON.parse(stored) : undefined } catch { parsed = undefined }
    const legacyTheme = stored ? null : await library.getSetting('appearance.theme')
    preferences.value = normalizePreferences(parsed, legacyTheme)
    loaded.value = true
    return preferences.value
  })()
  try { return await pendingLoad } finally { pendingLoad = null }
}
export async function saveSettings(value: AppPreferences): Promise<AppPreferences> {
  const errors = preferenceErrors(value)
  if (errors.length) throw new Error(errors.join('\n'))
  const next = normalizePreferences(value)
  await library.setSetting(SETTINGS_KEY, JSON.stringify(next))
  preferences.value = next; loaded.value = true
  return next
}
export function useSettings() { return { preferences, loaded, effectiveAppearance, previewAppearance, load: loadSettings, save: saveSettings } }
