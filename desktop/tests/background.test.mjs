import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeBackground, backgroundErrors, importBackgroundImage } from '../src/settings/background.ts'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
const stored = (bytes = png, mime = 'image/png', name = '示例.png') => ({ name, dataUrl: `data:${mime};base64,${bytes.toString('base64')}` })

test('backgrounds preserve safe local pixels and normalize display names', () => {
  assert.deepEqual(normalizeBackground(stored()), stored())
  assert.equal(normalizeBackground(stored(png, 'image/png', 'C:\\private\\\u202eripple\u0000.png')).name, 'ripple.png')
  assert.equal(normalizeBackground(stored(png, 'image/png', 'x'.repeat(200))).name.length, 120)
  assert.equal(normalizeBackground(stored(png, 'image/png', '\n')).name, '自定义底板')
  assert.deepEqual(backgroundErrors(null), [])
  assert.deepEqual(backgroundErrors(undefined), [])
  assert.deepEqual(backgroundErrors(stored()), [])
})

test('backgrounds reject remote paths, SVG, invalid base64 and MIME spoofing', () => {
  for (const dataUrl of [
    'https://example.org/image.png', 'file:///C:/private/image.png',
    'data:image/svg+xml;base64,' + Buffer.from('<svg onload="alert(1)"/>').toString('base64'),
    'data:image/png;base64,%%%%', 'data:image/png;base64,a===',
    'data:image/png;base64,' + Buffer.from('<html><script>fetch("https://example.org")</script></html>').toString('base64'),
    stored(png, 'image/jpeg').dataUrl,
    stored().dataUrl + '\n',
  ]) {
    assert.equal(normalizeBackground({ name: 'unsafe', dataUrl }), null)
    assert.equal(backgroundErrors({ name: 'unsafe', dataUrl }).length, 1)
  }
  for (const value of ['', false, [], {}, { name: 4, dataUrl: stored().dataUrl }]) assert.equal(normalizeBackground(value), null)
})

test('persisted image bounds reject oversized rasters and payloads', () => {
  const huge = Buffer.from(png)
  huge.writeUInt32BE(16000, 16)
  huge.writeUInt32BE(16000, 20)
  assert.equal(normalizeBackground(stored(huge)), null)
  const zero = Buffer.from(png)
  zero.writeUInt32BE(0, 16)
  assert.equal(normalizeBackground(stored(zero)), null)
  assert.equal(normalizeBackground(stored(Buffer.alloc(1024 * 1024 + 1, 0))), null)
})

test('upload validation stops empty, huge, SVG and giant dimension files before decoding', async () => {
  await assert.rejects(importBackgroundImage(new File([], 'empty.png')), /有效/)
  await assert.rejects(importBackgroundImage({ size: 20 * 1024 * 1024 + 1 }), /20 MB/)
  await assert.rejects(importBackgroundImage(new File(['<svg/>'], 'image.png', { type: 'image/png' })), /PNG、JPEG 和 WebP/)
  const giant = Buffer.from(png)
  giant.writeUInt32BE(16000, 16)
  giant.writeUInt32BE(16000, 20)
  await assert.rejects(importBackgroundImage(new File([giant], 'giant.png')), /尺寸过大/)
})
