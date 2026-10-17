/**
 * App-wide update state: one store shared by the floating UpdateCard and the
 * settings section. Checks run quietly in the background; only an available
 * update (or a failed download/install) surfaces in the card.
 */
import { computed, reactive, readonly } from 'vue'
import { cancelUpdateDownload, checkForUpdate, downloadUpdate, installUpdate, openRepoPage, updateStatus, type DownloadProgress, type UpdateInfo, type UpdateStatus } from '../sdk/updater'
import { shouldOffer } from './update-select'

export type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'installing' | 'error' | 'up-to-date'
export type UpdateState = {
  phase: UpdatePhase
  info: UpdateInfo | null
  status: UpdateStatus | null
  progress: DownloadProgress | null
  error: string
  /** Which step failed: check errors stay in settings, the others show in the card. */
  errorSource: 'check' | 'download' | 'install' | null
  lastChecked: number | null
  skippedVersion: string | null
  /** A newer version found by an automatic check but not offered because it was skipped. */
  skippedAvailable: string | null
  /** 「稍后」: hidden until the next manual check or a newer version. */
  dismissedVersion: string | null
  includePrerelease: boolean
}

const SKIPPED_KEY = 'kaizhi.update.skipped'
const LAST_CHECKED_KEY = 'kaizhi.update.lastChecked'
export const INITIAL_CHECK_DELAY = 8_000
export const CHECK_INTERVAL = 6 * 60 * 60 * 1000

function load(key: string): string | null {
  try { return window.localStorage.getItem(key) } catch { return null }
}
function store(key: string, value: string | null) {
  try { value === null ? window.localStorage.removeItem(key) : window.localStorage.setItem(key, value) } catch { /* storage unavailable: keep in memory */ }
}
const storedChecked = Number(load(LAST_CHECKED_KEY))

const state = reactive<UpdateState>({
  phase: 'idle', info: null, status: null, progress: null, error: '', errorSource: null,
  lastChecked: Number.isFinite(storedChecked) && storedChecked > 0 ? storedChecked : null,
  skippedVersion: load(SKIPPED_KEY), skippedAvailable: null, dismissedVersion: null, includePrerelease: false,
})
let installerPath: { version: string; path: string } | null = null
let pending: Promise<void> | null = null
const busy = () => state.phase === 'downloading' || state.phase === 'installing'

const visible = computed(() => !!state.info && state.dismissedVersion !== state.info.version && (
  state.phase === 'available' || state.phase === 'downloading' || state.phase === 'ready' || state.phase === 'installing'
  || (state.phase === 'error' && state.errorSource !== 'check')))

function message(error: unknown) { return error instanceof Error ? error.message : String(error) }

async function runCheck(manual: boolean, includePrerelease: boolean) {
  // A background re-check while an update is on screen must not flicker or hide the card.
  const quiet = !manual && !!state.info
  if (!quiet) { state.phase = 'checking'; state.error = ''; state.errorSource = null }
  state.skippedAvailable = null
  try {
    state.status ||= await updateStatus()
    const info = await checkForUpdate(includePrerelease)
    state.lastChecked = Date.now(); store(LAST_CHECKED_KEY, String(state.lastChecked))
    if (!info) { state.info = null; state.phase = 'up-to-date'; return }
    if (!shouldOffer(info, state.skippedVersion, manual)) { state.info = null; state.skippedAvailable = info.version; state.phase = 'idle'; return }
    if (manual || state.info?.version !== info.version) state.dismissedVersion = null
    state.info = info
    state.phase = installerPath?.version === info.version ? 'ready' : 'available'
  } catch (error) {
    if (!quiet) { state.phase = 'error'; state.errorSource = 'check'; state.error = message(error) }
  }
}

/** Looks for a newer release. Manual checks also re-offer skipped or postponed versions. */
export function check(options: { manual?: boolean; includePrerelease?: boolean } = {}): Promise<void> {
  if (busy()) return Promise.resolve()
  const includePrerelease = options.includePrerelease ?? state.includePrerelease
  if (pending && !options.manual) return pending
  const run = (pending ? pending.then(() => runCheck(!!options.manual, includePrerelease)) : runCheck(!!options.manual, includePrerelease))
    .finally(() => { if (pending === run) pending = null })
  pending = run
  return run
}

export async function download(): Promise<void> {
  const info = state.info
  if (!info?.installer || busy()) return
  state.phase = 'downloading'; state.error = ''; state.errorSource = null
  state.progress = { downloaded: 0, total: info.installer.size || null }
  try {
    const path = await downloadUpdate(info.installer, progress => { state.progress = progress })
    installerPath = { version: info.version, path }
    if (state.info?.version === info.version) state.phase = 'ready'
  } catch (error) {
    const text = message(error)
    if (text.includes('已取消')) { state.phase = 'available'; state.progress = null }
    else { state.phase = 'error'; state.errorSource = 'download'; state.error = text }
  }
}

export async function cancelDownload(): Promise<void> {
  if (state.phase === 'downloading') await cancelUpdateDownload().catch(() => {})
}

/** Runs the verified installer; on success the app quits and reopens updated. */
export async function install(): Promise<void> {
  if (!installerPath || installerPath.version !== state.info?.version || busy()) return
  state.phase = 'installing'; state.error = ''; state.errorSource = null
  try { await installUpdate(installerPath.path) }
  catch (error) { state.phase = 'error'; state.errorSource = 'install'; state.error = message(error) }
}

/** Never offer this version again in automatic checks. */
export function skip(version = state.info?.version): void {
  if (!version || busy()) return
  state.skippedVersion = version; store(SKIPPED_KEY, version)
  if (state.info?.version === version) { state.info = null; state.phase = 'idle'; state.progress = null }
}

/** 「稍后」: hide the card for this version until a manual check or the next launch. */
export function later(): void {
  if (state.info && state.phase !== 'installing') state.dismissedVersion = state.info.version
}

/** Shows the card again after 「稍后」. */
export function show(): void { state.dismissedVersion = null }

export async function openPage(): Promise<void> {
  if (state.info) await openRepoPage(state.info.htmlUrl)
}

let timer: ReturnType<typeof setTimeout> | undefined
let generation = 0
let sessionChecked = false
let autoPrerelease: boolean | undefined

export function stopAutoCheck(): void { generation++; clearTimeout(timer); timer = undefined }

/**
 * Schedules quiet checks ~8 s after launch and every 6 hours. Call again when
 * preferences change; turning on 测试版 checks again soon.
 */
export function startAutoCheck(options: { includePrerelease: boolean; enabled: boolean }): () => void {
  const channelChanged = autoPrerelease !== undefined && autoPrerelease !== options.includePrerelease
  autoPrerelease = options.includePrerelease
  state.includePrerelease = options.includePrerelease
  stopAutoCheck()
  if (!options.enabled) return stopAutoCheck
  const id = generation
  const tick = (delay: number) => {
    timer = setTimeout(() => {
      sessionChecked = true
      void check({ manual: false }).finally(() => { if (id === generation) tick(CHECK_INTERVAL) })
    }, delay)
  }
  const sinceLast = state.lastChecked ? Date.now() - state.lastChecked : CHECK_INTERVAL
  tick(!sessionChecked || channelChanged ? INITIAL_CHECK_DELAY : Math.max(INITIAL_CHECK_DELAY, CHECK_INTERVAL - sinceLast))
  return stopAutoCheck
}

/** Reads the running version once, for the settings section. */
export async function loadStatus(): Promise<UpdateStatus | null> {
  try { state.status ||= await updateStatus() } catch { /* shown as unknown */ }
  return state.status
}

export function useUpdater() {
  return { state: readonly(state), visible, check, download, cancelDownload, install, skip, later, show, openPage, startAutoCheck, stopAutoCheck, loadStatus }
}
