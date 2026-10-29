import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spreadRows } from '../src/reader/continuous.mjs'

test('two-page rows pair pages, or keep the cover alone', () => {
  assert.deepEqual(spreadRows(5), [[1, 2], [3, 4], [5]])
  assert.deepEqual(spreadRows(5, true), [[1], [2, 3], [4, 5]])
  assert.deepEqual(spreadRows(1, true), [[1]])
  assert.deepEqual(spreadRows(0), [])
})
