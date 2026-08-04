import { describe, it, expect } from 'vitest';
import { buildCredalSet, verifyCoverage, ignoranceWidth, totalIgnorance } from '@/core/dempster-shafer/credal-set';
import { fuse } from '@/core/dempster-shafer/combination';
import { createBPAFromGaussian, createIgnorantBPA } from '@/core/dempster-shafer/bpa';
import { FrameOfDiscernment } from '@/core/dempster-shafer/types';
import { createFrame } from '@/core/dempster-shafer/frame';

/**
 * P_máx del marco de precipitación de los tests — 500 mm/h, el mismo bound
 * físico declarado que PRECIPITATION_FRAME (src/lib/constants.ts). Cierra la
 * cola [60, ∞) de la Def. 3.1 y materializa H0. Ver docs/ERRATA.md §5.
 */
const TEST_DOMAIN_BOUND = 500;

const frame: FrameOfDiscernment = createFrame({
  variable: 'precipitation',
  unit: 'mm/h',
  hypotheses: [
    { label: 'none', lower: 0, upper: 5 },
    { label: 'light', lower: 5, upper: 15 },
    { label: 'moderate', lower: 15, upper: 30 },
    { label: 'heavy', lower: 30, upper: 60 },
    { label: 'torrential', lower: 60, upper: TEST_DOMAIN_BOUND },
  ],
  domainBound: TEST_DOMAIN_BOUND,
});

describe('CredalSet', () => {
  it('coverage property holds (Bel ≤ Pl) for all fusion methods', () => {
    const scenarios: [number, number][] = [[20, 22], [5, 40], [2, 55]];
    for (const [v1, v2] of scenarios) {
      const bpa1 = createBPAFromGaussian(frame, v1, 5, 0.1, 's1');
      const bpa2 = createBPAFromGaussian(frame, v2, 5, 0.1, 's2');
      const result = fuse([bpa1, bpa2], [0.1, 0.1]);
      expect(verifyCoverage(buildCredalSet(result))).toBe(true);
    }
  });

  it('continuous interval is finite after fusion', () => {
    const bpa1 = createBPAFromGaussian(frame, 20, 5, 0.05, 's1');
    const bpa2 = createBPAFromGaussian(frame, 22, 4, 0.05, 's2');
    const result = fuse([bpa1, bpa2], [0.05, 0.05]);
    const cs = buildCredalSet(result);
    expect(isFinite(cs.continuousInterval.lower)).toBe(true);
    expect(isFinite(cs.continuousInterval.upper)).toBe(true);
  });

  it('total ignorance is 0 for deterministic BPA', () => {
    // Extremely concentrated BPA (low stddev, no failure)
    const bpa = createBPAFromGaussian(frame, 20, 0.01, 0, 'test');
    const result = fuse([bpa, bpa], [0, 0]);
    const cs = buildCredalSet(result);
    // With no composite focal elements, Bel = Pl everywhere → zero ignorance
    expect(totalIgnorance(cs)).toBeCloseTo(0, 3);
  });

  it('total ignorance > 0 when failure rate is present', () => {
    const bpa1 = createBPAFromGaussian(frame, 20, 5, 0.2, 's1');
    const bpa2 = createBPAFromGaussian(frame, 22, 4, 0.2, 's2');
    const result = fuse([bpa1, bpa2], [0.2, 0.2]);
    const cs = buildCredalSet(result);
    expect(totalIgnorance(cs)).toBeGreaterThan(0);
  });

  it('ignorance widths are non-negative', () => {
    const bpa1 = createBPAFromGaussian(frame, 20, 5, 0.1, 's1');
    const bpa2 = createBPAFromGaussian(frame, 25, 5, 0.1, 's2');
    const result = fuse([bpa1, bpa2], [0.1, 0.1]);
    const cs = buildCredalSet(result);
    for (const w of ignoranceWidth(cs)) {
      expect(w).toBeGreaterThanOrEqual(-1e-10);
    }
  });
});
