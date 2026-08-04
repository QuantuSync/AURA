import { describe, it, expect } from 'vitest';
import { createBPAFromGaussian, createIgnorantBPA, beliefAndPlausibility, allBeliefPlausibility } from '@/core/dempster-shafer/bpa';
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

describe('BPA Construction', () => {
  it('masses sum to 1', () => {
    const bpa = createBPAFromGaussian(precipFrame, 20, 5, 0, 'test');
    const total = bpa.focalElements.reduce((s, fe) => s + fe.mass, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it('mass concentrates near measurement value', () => {
    // Measurement: 20 mm/h, stddev 3 → should concentrate on "moderate" [15, 30)
    const bpa = createBPAFromGaussian(precipFrame, 20, 3, 0, 'test');
    const moderateMass = bpa.focalElements.find(
      (fe) => fe.indices.length === 1 && fe.indices[0] === 2
    )?.mass ?? 0;
    expect(moderateMass).toBeGreaterThan(0.8);
  });

  it('failure rate reserves mass for Θ', () => {
    const bpa = createBPAFromGaussian(precipFrame, 20, 5, 0.2, 'test');
    const thetaMass = bpa.focalElements.find(
      (fe) => fe.indices.length === precipFrame.hypotheses.length
    )?.mass ?? 0;
    expect(thetaMass).toBeCloseTo(0.2, 2);
  });

  it('ignorant BPA assigns all mass to Θ', () => {
    const bpa = createIgnorantBPA(precipFrame, 'test');
    expect(bpa.focalElements).toHaveLength(1);
    expect(bpa.focalElements[0].mass).toBeCloseTo(1, 6);
    expect(bpa.focalElements[0].indices).toHaveLength(precipFrame.hypotheses.length);
  });

  it('Bel ≤ Pl for all hypotheses (Definición 3.3)', () => {
    const bpa = createBPAFromGaussian(precipFrame, 20, 5, 0.1, 'test');
    const bp = allBeliefPlausibility(bpa);
    for (const { belief, plausibility } of bp) {
      expect(belief).toBeLessThanOrEqual(plausibility + 1e-10);
    }
  });

  it('Bel = Pl when no mass on composite sets (δ=0)', () => {
    const bpa = createBPAFromGaussian(precipFrame, 20, 3, 0, 'test');
    const bp = allBeliefPlausibility(bpa);
    for (const { belief, plausibility } of bp) {
      expect(belief).toBeCloseTo(plausibility, 6);
    }
  });

  it('throws on invalid stddev', () => {
    expect(() => createBPAFromGaussian(precipFrame, 20, 0, 0, 'test')).toThrow();
    expect(() => createBPAFromGaussian(precipFrame, 20, -1, 0, 'test')).toThrow();
  });
});
