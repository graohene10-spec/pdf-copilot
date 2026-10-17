import { invoke, Channel } from '@tauri-apps/api/core'
import { isDesktop } from './index'
import { version as packageVersion } from '../../package.json'
import { RELEASES_API, isRepoPage, selectRelease, toUpdateInfo, type GithubRelease, type UpdateInfo, type UpdateInstaller, type UpdateStatus } from '../ui/update-select'
export type { UpdateInfo, UpdateInstaller, UpdateStatus } from '../ui/update-select'
export type DownloadProgress = { downloaded: number; total: number | null }

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try { return await invoke<T>(command, args) }
  catch (error) { throw error instanceof Error ? error : new Error(String(error)) }
}

/** Running version, and whether this copy is an NSIS install that can update itself. */
export async function updateStatus(): Promise<UpdateStatus> {
  return isDesktop ? call<UpdateStatus>('update_status') : { current: packageVersion, installed: false }
}

/** Newest desktop release above the running version, or null when up to date. */
export async function checkForUpdate(includePrerelease: boolean): Promise<UpdateInfo | null> {
  if (isDesktop) return call<UpdateInfo | null>('update_check', { includePrerelease })
  // Browser preview: same selection over the public API, without install support.
  let response: Response
  try { response = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' }) }
  catch { throw new Error('无法连接 GitHub，请检查网络或代理设置') }
  if (response.headers.get('x-ratelimit-remaining') === '0' || response.status === 429) throw new Error('GitHub 请求次数已达上限，请稍后再试')
  if (!response.ok) throw new Error(`GitHub 返回了错误（HTTP ${response.status}）`)
  const releases = await response.json().catch(() => { throw new Error('GitHub 返回的发布信息无法识别') }) as GithubRelease[]
  const found = selectRelease(releases, packageVersion, includePrerelease)
  return found ? toUpdateInfo(found.release, found.version, null) : null
}

/** Downloads and SHA-256-verifies the installer; resolves to its local path. */
export async function downloadUpdate(installer: UpdateInstaller, onProgress: (progress: DownloadProgress) => void): Promise<string> {
  if (!isDesktop) throw new Error('浏览器预览不能下载安装包，请前往发布页面')
  const channel = new Channel<DownloadProgress>()
  channel.onmessage = onProgress
  return call<string>('update_download', { url: installer.url, sha256: installer.sha256, onProgress: channel })
}

export async function cancelUpdateDownload(): Promise<void> {
  if (isDesktop) await call('update_cancel')
}

/** Starts the silent installer and quits; the updated app reopens afterwards. */
export async function installUpdate(path: string): Promise<void> {
  if (!isDesktop) throw new Error('浏览器预览不能安装更新')
  await call('update_install', { path })
}

/** Opens a page of this repository (release page or a linked document) in the browser. */
export async function openRepoPage(url: string): Promise<void> {
  if (!isRepoPage(url)) throw new Error('只能打开开智在 GitHub 上的页面')
  if (isDesktop) await call('update_open_page', { url })
  else window.open(url, '_blank', 'noopener,noreferrer')
}
