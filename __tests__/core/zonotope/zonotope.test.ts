import { describe, it, expect } from 'vitest';
import { fromIntervals, minkowskiSum, linearTransform, toIntervalHull, reduce } from '@/core/zonotope/zonotope';

describe('Zonotope Operations', () => {
  it('fromIntervals creates correct zonotope', () => {
    const z = fromIntervals([{ lower: 1, upper: 3 }, { lower: 2, upper: 6 }]);
    expect(z.center[0]).toBeCloseTo(2);
    expect(z.center[1]).toBeCloseTo(4);
    expect(z.dimension).toBe(2);
  });

  it('toIntervalHull recovers original intervals', () => {
    const intervals = [{ lower: 1, upper: 3 }, { lower: 2, upper: 6 }];
    const z = fromIntervals(intervals);
    const hull = toIntervalHull(z);
    expect(hull[0].lower).toBeCloseTo(1);
    expect(hull[0].upper).toBeCloseTo(3);
    expect(hull[1].lower).toBeCloseTo(2);
    expect(hull[1].upper).toBeCloseTo(6);
  });

  it('minkowski sum is sound (contains sum of any points)', () => {
    const z1 = fromIntervals([{ lower: 1, upper: 3 }]);
    const z2 = fromIntervals([{ lower: 2, upper: 4 }]);
    const sum = minkowskiSum(z1, z2);
    const hull = toIntervalHull(sum);
    // Any point from z1 + any point from z2 should be in hull
    expect(hull[0].lower).toBeLessThanOrEqual(1 + 2);
    expect(hull[0].upper).toBeGreaterThanOrEqual(3 + 4);
  });

  it('linear transform with identity produces same zonotope', () => {
    const z = fromIntervals([{ lower: 1, upper: 3 }, { lower: -1, upper: 1 }]);
    const identity = [[1, 0], [0, 1]];
    const transformed = linearTransform(z, identity);
    const original = toIntervalHull(z);
    const result = toIntervalHull(transformed);
    expect(result[0].lower).toBeCloseTo(original[0].lower, 5);
    expect(result[0].upper).toBeCloseTo(original[0].upper, 5);
  });

  it('linear transform with scalar 2x doubles the interval width', () => {
    const z = fromIntervals([{ lower: 1, upper: 3 }]);
    const scale2 = [[2]];
    const transformed = linearTransform(z, scale2);
    const hull = toIntervalHull(transformed);
    expect(hull[0].lower).toBeCloseTo(2);
    expect(hull[0].upper).toBeCloseTo(6);
  });

  it('reduce does not shrink zonotope (conservative)', () => {
    const z = fromIntervals([
      { lower: 0, upper: 2 },
      { lower: 1, upper: 3 },
      { lower: 2, upper: 4 },
      { lower: 3, upper: 5 },
    ]);
    const originalHull = toIntervalHull(z);
    const reduced = reduce(z, 3);
    const reducedHull = toIntervalHull(reduced);

    // Reduced hull must contain original hull (conservative)
    for (let i = 0; i < z.dimension; i++) {
      expect(reducedHull[i].lower).toBeLessThanOrEqual(originalHull[i].lower + 1e-10);
      expect(reducedHull[i].upper).toBeGreaterThanOrEqual(originalHull[i].upper - 1e-10);
    }
  });
});
