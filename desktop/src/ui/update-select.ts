/**
 * Pure update helpers shared by the browser preview check and the UI: semver
 * comparison, desktop release selection and checksum lookup. The desktop app
 * performs the same selection natively (src-tauri/src/updater.rs).
 */
export const RELEASES_API = 'https://api.github.com/repos/graohene10-spec/pdf-copilot/releases?per_page=30'
export const REPO_PAGE = 'https://github.com/graohene10-spec/pdf-copilot'
export const RELEASES_PAGE = `${REPO_PAGE}/releases`
export const DESKTOP_TAG_PREFIX = 'desktop-v'
export const SETUP_SUFFIX = '_x64-setup.exe'
export const MAX_NOTES_CHARS = 20_000

export type UpdateInstaller = { name: string; url: string; size: number; sha256: string }
export type UpdateInfo = {
  version: string
  tag: string
  name: string
  notes: string
  publishedAt: string | null
  htmlUrl: string
  prerelease: boolean
  /** null: no verifiable installer, the UI links to the release page instead. */
  installer: UpdateInstaller | null
}
export type UpdateStatus = { current: string; installed: boolean }
export type GithubAsset = { name: string; size?: number; browser_download_url: string }
export type GithubRelease = {
  tag_name: string
  name?: string | null
  body?: string | null
  draft?: boolean
  prerelease?: boolean
  published_at?: string | null
  html_url?: string
  assets?: GithubAsset[]
}

export type Version = { major: number; minor: number; patch: number; pre: (string | number)[] }

const NUMERIC = /^(0|[1-9]\d*)$/
const IDENTIFIER = /^[0-9A-Za-z-]+$/

/** Semantic version 2.0 (`1.2.3`, `1.2.3-beta.4`, build metadata ignored). */
export function parseVersion(text: string): Version | null {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(text || '').trim())
  if (!match) return null
  const pre: (string | number)[] = []
  if (match[4] !== undefined) {
    for (const part of match[4].split('.')) {
      if (!part || !IDENTIFIER.test(part)) return null
      if (/^\d+$/.test(part)) { if (!NUMERIC.test(part)) return null; pre.push(Number(part)) }
      else pre.push(part)
    }
  }
  const [major, minor, patch] = [match[1], match[2], match[3]].map(Number)
  if (![major, minor, patch].every(Number.isSafeInteger)) return null
  return { major, minor, patch, pre }
}

export function formatVersion(version: Version): string {
  return `${version.major}.${version.minor}.${version.patch}${version.pre.length ? `-${version.pre.join('.')}` : ''}`
}

/** Negative when a < b, positive when a > b, 0 when equal (semver precedence). */
export function compareVersions(a: Version, b: Version): number {
  for (const key of ['major', 'minor', 'patch'] as const) if (a[key] !== b[key]) return a[key] - b[key]
  if (!a.pre.length || !b.pre.length) return (a.pre.length ? -1 : 0) - (b.pre.length ? -1 : 0)
  for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index++) {
    const left = a.pre[index], right = b.pre[index]
    if (left === undefined) return -1
    if (right === undefined) return 1
    if (left === right) continue
    if (typeof left === 'number' && typeof right === 'number') return left - right
    if (typeof left === 'number') return -1
    if (typeof right === 'number') return 1
    return left < right ? -1 : 1
  }
  return 0
}

export function compareVersionText(a: string, b: string): number {
  const left = parseVersion(a), right = parseVersion(b)
  if (!left || !right) throw new Error(`无法比较版本：${a} / ${b}`)
  return compareVersions(left, right)
}

export function releaseVersion(tag: string): Version | null {
  return tag.startsWith(DESKTOP_TAG_PREFIX) ? parseVersion(tag.slice(DESKTOP_TAG_PREFIX.length)) : null
}

/** Highest non-draft `desktop-v*` release strictly newer than `current`. */
export function selectRelease(releases: GithubRelease[], current: string, includePrerelease: boolean): { release: GithubRelease; version: Version } | null {
  const base = parseVersion(current)
  if (!base) return null
  let best: { release: GithubRelease; version: Version } | null = null
  for (const release of Array.isArray(releases) ? releases : []) {
    if (!release || release.draft || typeof release.tag_name !== 'string') continue
    const version = releaseVersion(release.tag_name)
    if (!version) continue
    // A pre-release suffix marks a test build even when GitHub's flag is unset.
    if (!includePrerelease && (release.prerelease || version.pre.length)) continue
    if (compareVersions(version, base) <= 0) continue
    if (!best || compareVersions(version, best.version) > 0) best = { release, version }
  }
  return best
}

/** Looks up a file in `sha256sum` output (`<hex>  name` or `<hex> *name`). */
export function checksumFor(sums: string, name: string): string | null {
  for (const line of String(sums || '').split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line.trim())
    if (match && match[2] === name) return match[1].toLowerCase()
  }
  return null
}

export function setupAsset(release: GithubRelease): GithubAsset | null {
  return release.assets?.find(asset => asset.name.endsWith(SETUP_SUFFIX)) || null
}

export function truncateNotes(notes: string, limit = MAX_NOTES_CHARS): string {
  const characters = [...String(notes || '')]
  return characters.length > limit ? `${characters.slice(0, limit).join('')}\n\n…` : characters.join('')
}

function isPageUnder(address: string, prefix: string): boolean {
  if (typeof address !== 'string' || address.length > 2048 || /[\u0000-\u001f\u007f"^% ]/.test(address)) return false
  let url: URL
  try { url = new URL(address) } catch { return false }
  const path = new URL(prefix).pathname
  return url.protocol === 'https:' && url.host === 'github.com' && !url.username && !url.password && !url.search && !url.hash
    && (url.pathname === path || url.pathname.startsWith(`${path}/`))
}

/** This repository's release pages (the update's `htmlUrl`). */
export function isReleasePage(url: string): boolean { return isPageUnder(url, RELEASES_PAGE) }

/** Any page of this repository, e.g. a README linked from release notes. */
export function isRepoPage(url: string): boolean { return isPageUnder(url, REPO_PAGE) }

export function toUpdateInfo(release: GithubRelease, version: Version, installer: UpdateInstaller | null): UpdateInfo {
  const text = formatVersion(version)
  return {
    version: text,
    tag: release.tag_name,
    name: release.name?.trim() || `开智 ${text}`,
    notes: truncateNotes(release.body || ''),
    publishedAt: release.published_at || null,
    htmlUrl: release.html_url && isReleasePage(release.html_url) ? release.html_url : `${RELEASES_PAGE}/tag/${release.tag_name}`,
    prerelease: !!release.prerelease || version.pre.length > 0,
    installer,
  }
}

/** Auto checks are quiet: a skipped version is not offered again unless checked manually. */
export function shouldOffer(info: UpdateInfo | null, skipped: string | null, manual: boolean): boolean {
  return !!info && (manual || info.version !== skipped)
}
