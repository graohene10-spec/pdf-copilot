import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cropSize, MAX_CROP_EDGE } from '../src/reader/crop.ts'

test('region crops are never upscaled and keep the long edge within the cap', () => {
  assert.deepEqual(cropSize(300, 200), { width: 300, height: 200 })
  assert.deepEqual(cropSize(4096, 1024), { width: MAX_CROP_EDGE, height: 400 })
  assert.deepEqual(cropSize(1000, 5000), { width: 320, height: MAX_CROP_EDGE })
  assert.deepEqual(cropSize(.4, .4), { width: 1, height: 1 })
})
