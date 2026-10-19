import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeGlowRadius } from '../../web/src/components/orbGeometry.js';

test('computeGlowRadius never returns a negative radius across canvas sizes', () => {
  for (const scale of [0, 0.01, 0.1, 0.28, 1, 2.5]) {
    for (let t = 0; t < 1000; t += 1) {
      const radius = computeGlowRadius(scale, t);
      assert.ok(Number.isFinite(radius), `radius must be finite for scale=${scale} t=${t}`);
      assert.ok(radius >= 0, `radius must be >= 0 for scale=${scale} t=${t} (got ${radius})`);
    }
  }
});

test('computeGlowRadius clamps a zero-sized canvas to a non-negative radius', () => {
  for (let t = 0; t < 1000; t += 1) {
    assert.ok(computeGlowRadius(0, t) >= 0);
  }
});

test('the unclamped formula would have produced negative radii (regression origin)', () => {
  const unclamped = (scale, t) => 80 * scale + 20 * Math.sin(t * 0.01);
  assert.ok(unclamped(0, 0) >= 0);
  let sawNegative = false;
  for (let t = 0; t < 1000; t += 1) {
    if (unclamped(0, t) < 0) {
      sawNegative = true;
      break;
    }
  }
  assert.equal(sawNegative, true);
});
