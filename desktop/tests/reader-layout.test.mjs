import test from 'node:test';
import assert from 'node:assert/strict';
import { availableReadingWidth, shrinkToFitScale, clampPdfScale, readingScrollTarget } from '../src/reader/layout.mjs';

test('fit uses the wider current page and the padded CSS viewport', () => {
  const available = availableReadingWidth(770, '35px', '35px');
  // The first page is 600pt, the current landscape page is 800pt, and the
  // canvas backing store is 2240px on a 2x display. Only 1120 CSS px matters.
  const renderedWidth = 1120;
  const currentScale = 1.4;
  const target = shrinkToFitScale(renderedWidth, available, currentScale);
  assert.equal(available, 700);
  assert.ok(Math.abs(target - .875) < 1e-10);
  assert.ok(Math.abs(renderedWidth * target / currentScale - available) < 1e-10);
});

test('opening a panel only shrinks overflowing pages; closing it cannot enlarge manual zoom', () => {
  assert.equal(shrinkToFitScale(900, 1000, 1.5), null);
  const target = shrinkToFitScale(900, 600, 1.5);
  assert.equal(target, 1);
  assert.equal(shrinkToFitScale(600, 1000, target), null);
  assert.equal(shrinkToFitScale(600.8, 600, 1), null);
});

test('several sidebars can fit below manual 25% without lifting smaller existing scales', () => {
  assert.equal(shrinkToFitScale(1200, 96, 1), .08);
  assert.equal(clampPdfScale(.08), .25);
  assert.equal(shrinkToFitScale(1000, 1, .01), .001);
  assert.equal(shrinkToFitScale(1000, 100, .0005), null);
});

test('unlaid-out and invalid page dimensions do not alter zoom', () => {
  for (const dimensions of [[0, 700, 1], [900, 0, 1], [900, -5, 1], [900, 700, 0], [NaN, 700, 1], [900, Infinity, 1]]) {
    assert.equal(shrinkToFitScale(...dimensions), null);
  }
});

test('Markdown position shortcuts retain reading overlap and stop at document ends', () => {
  assert.equal(readingScrollTarget(300, 500, 2500, 1), 725);
  assert.equal(readingScrollTarget(725, 500, 2500, -1), 300);
  assert.equal(readingScrollTarget(1900, 500, 2500, 1), 2000);
  assert.equal(readingScrollTarget(100, 500, 2500, -1), 0);
  assert.equal(readingScrollTarget(0, 500, 300, 1), 0);
});
