import { describe, it, expect } from 'vitest';
import {
  pairwiseConflict,
  conflictMatrix,
  assessConflict,
  globalConflict,
} from '@/core/dempster-shafer/conflict';
import { createBPAFromGaussian, createIgnorantBPA } from '@/core/dempster-shafer/bpa';
import { BPA, DEFAULT_FUSION_CONFIG, FrameOfDiscernment } from '@/core/dempster-shafer/types';
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

  it('expone K_máx por pares y K_global por separado, y la traza de la regla', () => {
    const bpa1 = createBPAFromGaussian(frame, 20, 5, 0, 's1');
    const bpa2 = createBPAFromGaussian(frame, 22, 5, 0, 's2');
    const bpa3 = createBPAFromGaussian(frame, 24, 5, 0, 's3');
    const result = assessConflict([bpa1, bpa2, bpa3]);

    // (P1) es una propiedad de K_global y vale bajo cualquier regla.
    expect(result.globalConflict).toBeGreaterThanOrEqual(result.maxConflict - 1e-12);
    // La regla vigente (C1) decide con el K_máx por pares del paper y expone
    // K_global aparte, que es lo que hace auditable la decisión.
    expect(result.decision.rule).toBe(DEFAULT_FUSION_CONFIG.rule);
    expect(result.decisionConflict).toBeCloseTo(result.maxConflict, 12);
    expect(result.decision.degeneracyGuard).toBe(false);
  });

  it('cada regla decide con su propia magnitud, sobre las mismas fuentes', () => {
    const bpas = [
      createBPAFromGaussian(frame, 20, 5, 0, 's1'),
      createBPAFromGaussian(frame, 22, 5, 0, 's2'),
      createBPAFromGaussian(frame, 24, 5, 0, 's3'),
    ];
    const kMax = assessConflict(bpas).maxConflict;
    const kGlobal = assessConflict(bpas).globalConflict;

    const c0 = assessConflict(bpas, { ...DEFAULT_FUSION_CONFIG, rule: 'C0' });
    expect(c0.decisionConflict).toBeCloseTo(Math.max(kMax, kGlobal), 12);

    const c1 = assessConflict(bpas, { ...DEFAULT_FUSION_CONFIG, rule: 'C1' });
    expect(c1.decisionConflict).toBeCloseTo(kMax, 12);
    expect(c1.decision.normalizedConflict).toBeNull();

    const c2 = assessConflict(bpas, { ...DEFAULT_FUSION_CONFIG, rule: 'C2' });
    expect(c2.decision.normalizedConflict).toBeCloseTo(1 - Math.sqrt(1 - kGlobal), 12);
    expect(c2.decisionConflict).toBeCloseTo(
      Math.max(kMax, c2.decision.normalizedConflict!),
      12
    );
  });
});

describe('globalConflict — extensión n-aria de la Ecuación (6)', () => {
  const mk = (focalElements: BPA['focalElements'], sourceId: string): BPA => ({
    frame,
    focalElements,
    sourceId,
    timestamp: 0,
  });

  it('con n = 2 coincide exactamente con el K por pares de la Ecuación (6)', () => {
    const bpa1 = createBPAFromGaussian(frame, 8, 4, 0, 's1');
    const bpa2 = createBPAFromGaussian(frame, 35, 6, 0, 's2');
    expect(globalConflict([bpa1, bpa2])).toBeCloseTo(pairwiseConflict(bpa1, bpa2), 12);
  });

  it('es 0 si todas las fuentes comparten una hipótesis en todos sus elementos focales', () => {
    const all = [0, 1, 2, 3, 4];
    const a = mk([{ indices: [1], mass: 1 }], 'a');
    const b = mk([{ indices: [0, 1], mass: 0.5 }, { indices: [1, 2], mass: 0.5 }], 'b');
    const c = mk([{ indices: all, mass: 1 }], 'c');
    expect(globalConflict([a, b, c])).toBeCloseTo(0, 12);
  });

  it('es 1 en el ciclo de solapamiento parcial, donde todos los pares dan 0,75', () => {
    // Contraejemplo del hallazgo: cada fuente comparte una hipótesis con la
    // siguiente, pero las tres juntas no comparten ninguna.
    const m1 = mk([{ indices: [0], mass: 0.5 }, { indices: [1], mass: 0.5 }], 'm1');
    const m2 = mk([{ indices: [1], mass: 0.5 }, { indices: [2], mass: 0.5 }], 'm2');
    const m3 = mk([{ indices: [2], mass: 0.5 }, { indices: [0], mass: 0.5 }], 'm3');

    expect(pairwiseConflict(m1, m2)).toBeCloseTo(0.75, 12);
    expect(globalConflict([m1, m2, m3])).toBeCloseTo(1, 12);
  });

  it('el K global crece (débilmente) al añadir fuentes', () => {
    // Añadir una fuente solo puede vaciar más intersecciones, nunca rellenarlas.
    const m1 = mk([{ indices: [0], mass: 0.5 }, { indices: [1], mass: 0.5 }], 'm1');
    const m2 = mk([{ indices: [1], mass: 0.5 }, { indices: [2], mass: 0.5 }], 'm2');
    const m3 = mk([{ indices: [2], mass: 0.5 }, { indices: [0], mass: 0.5 }], 'm3');
    expect(globalConflict([m1, m2, m3])).toBeGreaterThanOrEqual(globalConflict([m1, m2]));
  });

  it('una fuente sola no tiene conflicto consigo misma', () => {
    expect(globalConflict([createBPAFromGaussian(frame, 20, 5, 0, 's1')])).toBe(0);
  });

  it('lanza sin fuentes y por encima del límite configurable', () => {
    const bpa = createBPAFromGaussian(frame, 20, 5, 0, 's1');
    expect(() => globalConflict([])).toThrow(/No BPAs/);
    expect(() =>
      globalConflict([bpa, bpa, bpa], { ...DEFAULT_FUSION_CONFIG, maxSourcesForGlobalConflict: 2 })
    ).toThrow(/exponential in the number of sources/);
    // Y por defecto admite hasta 6 fuentes, el régimen documentado.
    expect(() => globalConflict(Array(6).fill(bpa))).not.toThrow();
    expect(() => globalConflict(Array(7).fill(bpa))).toThrow(/limit is 6/);
  });
});
