import { describe, it, expect } from 'vitest';
import { add, subtract, multiply, divide, width, midpoint, contains, intersect, hull } from '@/core/intervals/arithmetic';

describe('Interval Arithmetic', () => {
  it('add: [1,2] + [3,4] = [4,6]', () => {
    const r = add({ lower: 1, upper: 2 }, { lower: 3, upper: 4 });
    expect(r.lower).toBeCloseTo(4);
    expect(r.upper).toBeCloseTo(6);
  });

  it('subtract: [5,7] - [1,3] = [2,6]', () => {
    const r = subtract({ lower: 5, upper: 7 }, { lower: 1, upper: 3 });
    expect(r.lower).toBeCloseTo(2);
    expect(r.upper).toBeCloseTo(6);
  });

  it('multiply: [2,3] * [4,5] = [8,15]', () => {
    const r = multiply({ lower: 2, upper: 3 }, { lower: 4, upper: 5 });
    expect(r.lower).toBeCloseTo(8);
    expect(r.upper).toBeCloseTo(15);
  });

  it('multiply with negatives: [-1,2] * [3,4] = [-4,8]', () => {
    const r = multiply({ lower: -1, upper: 2 }, { lower: 3, upper: 4 });
    expect(r.lower).toBeCloseTo(-4);
    expect(r.upper).toBeCloseTo(8);
  });

  it('divide: [6,8] / [2,4] = [1.5,4]', () => {
    const r = divide({ lower: 6, upper: 8 }, { lower: 2, upper: 4 });
    expect(r.lower).toBeCloseTo(1.5);
    expect(r.upper).toBeCloseTo(4);
  });

  it('divide throws for interval containing zero', () => {
    expect(() => divide({ lower: 1, upper: 2 }, { lower: -1, upper: 1 })).toThrow();
  });

  it('soundness: result always contains true value', () => {
    // For random samples within intervals, operations should be sound
    const a = { lower: 1, upper: 3 };
    const b = { lower: 2, upper: 5 };
    const result = add(a, b);
    // Any a_val + b_val should be in result
    for (let av = 1; av <= 3; av += 0.5) {
      for (let bv = 2; bv <= 5; bv += 0.5) {
        const sum = av + bv;
        expect(sum).toBeGreaterThanOrEqual(result.lower - 1e-10);
        expect(sum).toBeLessThanOrEqual(result.upper + 1e-10);
      }
    }
  });

  it('width', () => {
    expect(width({ lower: 2, upper: 5 })).toBeCloseTo(3);
  });

  it('midpoint', () => {
    expect(midpoint({ lower: 2, upper: 6 })).toBeCloseTo(4);
  });

  it('contains', () => {
    expect(contains({ lower: 1, upper: 5 }, 3)).toBe(true);
    expect(contains({ lower: 1, upper: 5 }, 6)).toBe(false);
  });

  it('intersect: overlapping', () => {
    const r = intersect({ lower: 1, upper: 4 }, { lower: 2, upper: 6 });
    expect(r).not.toBeNull();
    expect(r!.lower).toBeCloseTo(2);
    expect(r!.upper).toBeCloseTo(4);
  });

  it('intersect: non-overlapping returns null', () => {
    expect(intersect({ lower: 1, upper: 2 }, { lower: 3, upper: 4 })).toBeNull();
  });

  it('hull', () => {
    const r = hull({ lower: 1, upper: 3 }, { lower: 5, upper: 7 });
    expect(r.lower).toBeCloseTo(1);
    expect(r.upper).toBeCloseTo(7);
  });
});
