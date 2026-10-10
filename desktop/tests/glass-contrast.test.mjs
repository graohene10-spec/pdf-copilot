import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseGlassInk } from '../src/ui/glass-contrast.ts';

test('glass foreground favors readable ink on light, dark and saturated backgrounds', () => {
  assert.equal(chooseGlassInk([255, 255, 255]), 'dark');
  assert.equal(chooseGlassInk([0, 0, 0]), 'light');
  assert.equal(chooseGlassInk([0, 255, 0]), 'dark');
  assert.equal(chooseGlassInk([0, 0, 255]), 'light');
});

test('foreground hysteresis avoids oscillation around the contrast crossover', () => {
  assert.equal(chooseGlassInk([118, 118, 118], 'dark'), 'dark');
  assert.equal(chooseGlassInk([118, 118, 118], 'light'), 'light');
  assert.equal(chooseGlassInk([255, 255, 255], 'light'), 'dark');
  assert.equal(chooseGlassInk([0, 0, 0], 'dark'), 'light');
});
