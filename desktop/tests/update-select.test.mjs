import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseVersion, formatVersion, compareVersionText, selectRelease, checksumFor, setupAsset, truncateNotes, toUpdateInfo, isReleasePage, isRepoPage, shouldOffer, MAX_NOTES_CHARS } from '../src/ui/update-select.ts'

const release = (tag, extra = {}) => ({ tag_name: tag, draft: false, prerelease: false, html_url: `https://github.com/graohene10-spec/pdf-copilot/releases/tag/${tag}`, assets: [], ...extra })

test('semver parsing and precedence follow SemVer 2.0, including beta.N ordering', () => {
  assert.deepEqual(parseVersion('0.3.0-beta.2'), { major: 0, minor: 3, patch: 0, pre: ['beta', 2] })
  assert.equal(formatVersion(parseVersion('1.2.3-rc.1+build.5')), '1.2.3-rc.1')
  for (const bad of ['', '1.2', '01.2.3', '1.2.3-', '1.2.3-beta..1', '1.2.3-beta.01', 'v1.2.3', '1.2.3 x']) assert.equal(parseVersion(bad), null, bad)
  const ordered = ['0.2.2', '0.2.10', '0.3.0-alpha', '0.3.0-alpha.1', '0.3.0-beta', '0.3.0-beta.2', '0.3.0-beta.10', '0.3.0-rc.1', '0.3.0', '1.0.0']
  for (let index = 1; index < ordered.length; index++) {
    assert.ok(compareVersionText(ordered[index - 1], ordered[index]) < 0, `${ordered[index - 1]} < ${ordered[index]}`)
    assert.ok(compareVersionText(ordered[index], ordered[index - 1]) > 0)
  }
  assert.equal(compareVersionText('0.2.2', '0.2.2'), 0)
  assert.equal(compareVersionText('1.0.0+a', '1.0.0+b'), 0)
})

test('release selection ignores extension tags, drafts and test builds unless allowed', () => {
  const releases = [
    release('v0.3.3'), release('v9.9.9'), release('desktop-v0.2.2'), release('desktop-v0.2.1'), release('desktop-v0.2.10'),
    release('desktop-v0.3.0-beta.2', { prerelease: true }), release('desktop-v0.3.0-beta.10', { prerelease: true }),
    release('desktop-v0.9.0', { draft: true }), release('desktop-vnext'), release('desktop-v0.4.0-rc.1'),
  ]
  assert.equal(formatVersion(selectRelease(releases, '0.2.2', false).version), '0.2.10')
  assert.equal(formatVersion(selectRelease(releases, '0.2.2', true).version), '0.4.0-rc.1')
  assert.equal(selectRelease(releases, '0.4.0', true), null)
  assert.equal(selectRelease(releases.slice(0, 4), '0.2.2', true), null)
  // A tester on a beta moves to the stable release of the same version.
  assert.equal(formatVersion(selectRelease([release('desktop-v0.3.0'), release('desktop-v0.3.0-beta.2', { prerelease: true })], '0.3.0-beta.1', false).version), '0.3.0')
  assert.equal(selectRelease(releases, 'not a version', true), null)
  assert.equal(selectRelease(null, '0.2.2', true), null)
})

test('installer metadata uses the setup asset and its SHA256SUMS entry', () => {
  const sums = '6D7AB464B7EB83313671108742CDFAB2B3AC81F5B5E4D71B924C77C6184C19A9  kaizhi_0.2.2_x64-setup.exe\r\nb9ebfe51c3fc5e8f014e59a3bee9140c1c80eb2d3717a9a14f3b187fed03764e *kaizhi_0.2.2_x64-portable.zip\n'
  assert.equal(checksumFor(sums, 'kaizhi_0.2.2_x64-setup.exe'), '6d7ab464b7eb83313671108742cdfab2b3ac81f5b5e4d71b924c77c6184c19a9')
  assert.equal(checksumFor(sums, 'kaizhi_0.2.2_x64-portable.zip'), 'b9ebfe51c3fc5e8f014e59a3bee9140c1c80eb2d3717a9a14f3b187fed03764e')
  assert.equal(checksumFor(sums, 'x64-setup.exe'), null)
  assert.equal(checksumFor('abc  kaizhi_0.2.2_x64-setup.exe', 'kaizhi_0.2.2_x64-setup.exe'), null)
  const assets = [{ name: 'kaizhi_0.2.2_x64-portable.zip', size: 1, browser_download_url: 'x' }, { name: 'kaizhi_0.2.2_x64-setup.exe', size: 2, browser_download_url: 'y' }]
  assert.equal(setupAsset(release('desktop-v0.2.2', { assets })).name, 'kaizhi_0.2.2_x64-setup.exe')
  assert.equal(setupAsset(release('desktop-v0.2.2')), null)
})

test('update info is bounded, labels test builds and only links to the repository', () => {
  const found = selectRelease([release('desktop-v0.3.0-beta.1', { name: '  ', body: '字'.repeat(MAX_NOTES_CHARS + 10), published_at: '2026-10-16T15:37:29Z', html_url: 'https://evil.example/' })], '0.2.2', true)
  const info = toUpdateInfo(found.release, found.version, null)
  assert.equal(info.version, '0.3.0-beta.1')
  assert.equal(info.name, '开智 0.3.0-beta.1')
  assert.equal(info.prerelease, true)
  assert.equal(info.htmlUrl, 'https://github.com/graohene10-spec/pdf-copilot/releases/tag/desktop-v0.3.0-beta.1')
  assert.equal([...info.notes].length, MAX_NOTES_CHARS + 3)
  assert.equal(truncateNotes('短'), '短')
  assert.ok(isReleasePage('https://github.com/graohene10-spec/pdf-copilot/releases/tag/desktop-v0.2.2'))
  assert.ok(isRepoPage('https://github.com/graohene10-spec/pdf-copilot/blob/desktop-v0.2.2/desktop/README.md'))
  for (const url of ['https://github.com/graohene10-spec/pdf-copilot/blob/main/README.md', 'http://github.com/graohene10-spec/pdf-copilot/releases', 'https://github.com/graohene10-spec/pdf-copilot-evil/releases', 'https://github.com.evil/graohene10-spec/pdf-copilot/releases', 'https://github.com/graohene10-spec/pdf-copilot/releases?x=1', 'https://github.com/graohene10-spec/pdf-copilot/releases/%22', 'javascript:alert(1)']) {
    assert.equal(isReleasePage(url), false, url)
  }
  assert.equal(isRepoPage('https://github.com/graohene10-spec/pdf-copilot/../other/repo'), false)
})

test('automatic checks respect a skipped version; manual checks offer it again', () => {
  const info = { version: '0.3.0' }
  assert.equal(shouldOffer(info, '0.3.0', false), false)
  assert.equal(shouldOffer(info, '0.3.0', true), true)
  assert.equal(shouldOffer(info, '0.2.9', false), true)
  assert.equal(shouldOffer(null, null, true), false)
})
