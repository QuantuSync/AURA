import { describe, it, expect } from 'vitest';
import { pairwiseConflict, conflictMatrix, assessConflict } from '@/core/dempster-shafer/conflict';
import { createBPAFromGaussian, createIgnorantBPA } from '@/core/dempster-shafer/bpa';
import { FrameOfDiscernment } from '@/core/dempster-shafer/types';

const frame: FrameOfDiscernment = {
  variable: 'precipitation',
  unit: 'mm/h',
  hypotheses: [
    { label: 'none', lower: 0, upper: 5 },
    { label: 'light', lower: 5, upper: 15 },
    { label: 'moderate', lower: 15, upper: 30 },
    { label: 'heavy', lower: 30, upper: 60 },
    { label: 'torrential', lower: 60, upper: Infinity },
  ],
};

describe('Pairwise Conflict', () => {
  it('zero conflict between identical BPAs with single focal element', () => {
    // A BPA with all mass on one singleton has no disjoint pairs → K=0
    const bpa = createBPAFromGaussian(frame, 20, 0.01, 0, 'test'); // very concentrated
    // All mass on "moderate" singleton → no disjoint pairs with itself
    const k = pairwiseConflict(bpa, bpa);
    // With a single dominant focal element, self-conflict ≈ 0
    expect(k).toBeLessThan(0.01);
  });

  it('low conflict between agreeing sources', () => {
    const bpa1 = createBPAFromGaussian(frame, 20, 5, 0, 's1');
    const bpa2 = createBPAFromGaussian(frame, 22, 4, 0, 's2');
    expect(pairwiseConflict(bpa1, bpa2)).toBeLessThan(0.3);
  });

  it('high conflict between contradicting sources', () => {
    const bpa1 = createBPAFromGaussian(frame, 2, 1, 0, 's1');   // clear "none"
    const bpa2 = createBPAFromGaussian(frame, 50, 1, 0, 's2');  // clear "heavy"
    expect(pairwiseConflict(bpa1, bpa2)).toBeGreaterThan(0.7);
  });

  it('zero conflict with ignorant BPA (Θ intersects everything)', () => {
    const bpa1 = createBPAFromGaussian(frame, 20, 5, 0, 'test');
    const ignorant = createIgnorantBPA(frame, 'ignorant');
    expect(pairwiseConflict(bpa1, ignorant)).toBeCloseTo(0, 5);
  });

  it('conflict matrix is symmetric', () => {
    const bpa1 = createBPAFromGaussian(frame, 5, 3, 0, 's1');
    const bpa2 = createBPAFromGaussian(frame, 25, 3, 0, 's2');
    const bpa3 = createBPAFromGaussian(frame, 45, 3, 0, 's3');
    const matrix = conflictMatrix([bpa1, bpa2, bpa3]);
    expect(matrix[0][1]).toBeCloseTo(matrix[1][0], 10);
    expect(matrix[0][2]).toBeCloseTo(matrix[2][0], 10);
    expect(matrix[1][2]).toBeCloseTo(matrix[2][1], 10);
  });

  it('conflict matrix has zero diagonal', () => {
    const bpa1 = createBPAFromGaussian(frame, 20, 5, 0, 's1');
    const bpa2 = createBPAFromGaussian(frame, 30, 5, 0, 's2');
    const matrix = conflictMatrix([bpa1, bpa2]);
    expect(matrix[0][0]).toBe(0);
    expect(matrix[1][1]).toBe(0);
  });
});

describe('assessConflict', () => {
  it('selects Dempster for low conflict', () => {
    const bpa1 = createBPAFromGaussian(frame, 20, 5, 0, 's1');
    const bpa2 = createBPAFromGaussian(frame, 21, 5, 0, 's2');
    const result = assessConflict([bpa1, bpa2]);
    expect(result.method).toBe('dempster');
    expect(result.level).toBe('low');
  });

  it('selects envelope for high conflict', () => {
    const bpa1 = createBPAFromGaussian(frame, 2, 1, 0, 's1');
    const bpa2 = createBPAFromGaussian(frame, 55, 1, 0, 's2');
    const result = assessConflict([bpa1, bpa2]);
    expect(result.method).toBe('envelope');
    expect(result.level).toBe('high');
  });
});
