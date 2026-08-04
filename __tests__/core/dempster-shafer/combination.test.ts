import { describe, it, expect } from 'vitest';
import { dempsterCombine, cautiousCombine, envelopeCombine, fuse } from '@/core/dempster-shafer/combination';
import { createBPAFromGaussian } from '@/core/dempster-shafer/bpa';
import { buildCredalSet, verifyCoverage } from '@/core/dempster-shafer/credal-set';
import { FrameOfDiscernment } from '@/core/dempster-shafer/types';

const precipFrame: FrameOfDiscernment = {
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

describe('Dempster Combination', () => {
  it('fused masses sum to 1', () => {
    const bpa1 = createBPAFromGaussian(precipFrame, 20, 5, 0, 'source1');
    const bpa2 = createBPAFromGaussian(precipFrame, 22, 4, 0, 'source2');
    const { combined } = dempsterCombine(bpa1, bpa2);
    const total = combined.focalElements.reduce((s, fe) => s + fe.mass, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it('agreeing sources reinforce each other', () => {
    const bpa1 = createBPAFromGaussian(precipFrame, 20, 5, 0, 'source1');
    const bpa2 = createBPAFromGaussian(precipFrame, 22, 4, 0, 'source2');
    const { combined, conflict } = dempsterCombine(bpa1, bpa2);

    // Low conflict when sources agree
    expect(conflict).toBeLessThan(0.3);

    // "moderate" hypothesis should have high mass after fusion
    const moderateMass = combined.focalElements.find(
      (fe) => fe.indices.length === 1 && fe.indices[0] === 2
    )?.mass ?? 0;
    expect(moderateMass).toBeGreaterThan(0.7);
  });
});

describe('Cautious Combination', () => {
  it('fused masses sum to 1', () => {
    const bpa1 = createBPAFromGaussian(precipFrame, 20, 5, 0.1, 'source1');
    const bpa2 = createBPAFromGaussian(precipFrame, 40, 5, 0.2, 'source2');
    const fused = cautiousCombine([bpa1, bpa2], [0.1, 0.2]);
    const total = fused.focalElements.reduce((s, fe) => s + fe.mass, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it('lower failure rate gets higher weight', () => {
    // Source 1: δ=0.1 → higher weight
    // Source 2: δ=0.4 → lower weight
    const bpa1 = createBPAFromGaussian(precipFrame, 10, 3, 0.1, 'reliable');
    const bpa2 = createBPAFromGaussian(precipFrame, 40, 3, 0.4, 'unreliable');
    const fused = cautiousCombine([bpa1, bpa2], [0.1, 0.4]);

    // "light" [5,15) should have more mass than "heavy" [30,60)
    const lightMass = fused.focalElements
      .filter((fe) => fe.indices.length === 1 && fe.indices[0] === 1)
      .reduce((s, fe) => s + fe.mass, 0);
    const heavyMass = fused.focalElements
      .filter((fe) => fe.indices.length === 1 && fe.indices[0] === 3)
      .reduce((s, fe) => s + fe.mass, 0);

    expect(lightMass).toBeGreaterThan(heavyMass);
  });
});

describe('Envelope Combination', () => {
  it('fused masses sum to 1', () => {
    const bpa1 = createBPAFromGaussian(precipFrame, 10, 3, 0, 'source1');
    const bpa2 = createBPAFromGaussian(precipFrame, 45, 3, 0, 'source2');
    const fused = envelopeCombine([bpa1, bpa2]);
    const total = fused.focalElements.reduce((s, fe) => s + fe.mass, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it('high ignorance when sources strongly disagree', () => {
    const bpa1 = createBPAFromGaussian(precipFrame, 5, 2, 0, 'source1');
    const bpa2 = createBPAFromGaussian(precipFrame, 50, 2, 0, 'source2');
    const fused = envelopeCombine([bpa1, bpa2]);

    // Should have significant mass on Θ (ignorance)
    const thetaMass = fused.focalElements.find(
      (fe) => fe.indices.length === precipFrame.hypotheses.length
    )?.mass ?? 0;
    expect(thetaMass).toBeGreaterThan(0.5);
  });
});

describe('Integrated Fusion (fuse function)', () => {
  it('uses Dempster for agreeing sources', () => {
    const bpa1 = createBPAFromGaussian(precipFrame, 20, 5, 0.05, 'source1');
    const bpa2 = createBPAFromGaussian(precipFrame, 22, 4, 0.05, 'source2');
    const result = fuse([bpa1, bpa2], [0.05, 0.05]);
    expect(result.method).toBe('dempster');
    expect(result.maxConflict).toBeLessThan(0.3);
  });

  it('uses envelope for contradicting sources', () => {
    const bpa1 = createBPAFromGaussian(precipFrame, 3, 2, 0, 'satellite');
    const bpa2 = createBPAFromGaussian(precipFrame, 50, 2, 0, 'gauge');
    const result = fuse([bpa1, bpa2], [0, 0]);
    expect(result.method).toBe('envelope');
    expect(result.maxConflict).toBeGreaterThan(0.7);
  });

  it('credal set always satisfies Bel ≤ Pl (Proposición 3.5)', () => {
    // Test with various conflict levels
    const scenarios = [
      [20, 22], // agreeing
      [10, 30], // moderate disagreement
      [3, 55],  // strong disagreement
    ];

    for (const [v1, v2] of scenarios) {
      const bpa1 = createBPAFromGaussian(precipFrame, v1, 5, 0.1, 's1');
      const bpa2 = createBPAFromGaussian(precipFrame, v2, 5, 0.1, 's2');
      const result = fuse([bpa1, bpa2], [0.1, 0.1]);
      const credalSet = buildCredalSet(result);
      expect(verifyCoverage(credalSet)).toBe(true);
    }
  });

  it('continuous interval covers measurement values when sources agree', () => {
    const bpa1 = createBPAFromGaussian(precipFrame, 20, 3, 0.05, 's1');
    const bpa2 = createBPAFromGaussian(precipFrame, 22, 4, 0.05, 's2');
    const result = fuse([bpa1, bpa2], [0.05, 0.05]);
    const credalSet = buildCredalSet(result);

    // Both measurements should be within the continuous interval
    expect(credalSet.continuousInterval.lower).toBeLessThanOrEqual(20);
    expect(credalSet.continuousInterval.upper).toBeGreaterThanOrEqual(22);
  });
});
