import { describe, it, expect } from 'vitest';
import { fromIntervals, toIntervalHull } from '@/core/zonotope/zonotope';
import { propagateNonlinear } from '@/core/zonotope/propagation';
import { computeReachableSet, containsPoint } from '@/core/zonotope/reachability';

describe('Zonotope Propagation', () => {
  it('linear function propagates exactly (zero error bound)', () => {
    // f(x) = 2x, J = [2]
    const z = fromIntervals([{ lower: 1, upper: 3 }]);
    const result = propagateNonlinear(
      z,
      ([x]) => [2 * x],
      [[2]],
      [{ lower: 0, upper: 0 }]
    );
    const hull = toIntervalHull(result);
    expect(hull[0].lower).toBeCloseTo(2);
    expect(hull[0].upper).toBeCloseTo(6);
  });

  it('error bound widens the output interval', () => {
    const z = fromIntervals([{ lower: 1, upper: 3 }]);
    const withoutError = propagateNonlinear(
      z, ([x]) => [x], [[1]], [{ lower: 0, upper: 0 }]
    );
    const withError = propagateNonlinear(
      z, ([x]) => [x], [[1]], [{ lower: -0.5, upper: 0.5 }]
    );
    const h1 = toIntervalHull(withoutError);
    const h2 = toIntervalHull(withError);
    expect(h2[0].upper).toBeGreaterThan(h1[0].upper - 1e-10);
    expect(h2[0].lower).toBeLessThan(h1[0].lower + 1e-10);
  });
});

describe('Reachable Set', () => {
  it('containsPoint: center always inside', () => {
    const z = fromIntervals([{ lower: 1, upper: 5 }, { lower: 2, upper: 6 }]);
    const rs = computeReachableSet(z);
    expect(containsPoint(rs, [3, 4])).toBe(true); // center = [3, 4]
  });

  it('containsPoint: exterior point outside', () => {
    const z = fromIntervals([{ lower: 1, upper: 3 }]);
    const rs = computeReachableSet(z);
    expect(containsPoint(rs, [10])).toBe(false);
  });
});
