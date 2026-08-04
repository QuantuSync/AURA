/**
 * Propiedad B4 — Operaciones zonotópicas
 * papers/AURA_v2.pdf §5.2, Definición 5.1 y Observación 5.1
 *
 *   Z = <c, G> = { c + Σ αᵢ gᵢ : αᵢ ∈ [−1,1] }        (Ec. 26)
 *   M · <c, G> = <Mc, MG>                              (cierre bajo transf. lineal)
 *   <c1,G1> ⊕ <c2,G2> = <c1+c2, [G1 G2]>               (cierre bajo Minkowski)
 *
 * Estas dos clausuras son lo que permite propagar un zonotope paso a paso sin
 * salir de la familia, y son la base del Teorema 5.1 (el término lineal J·G).
 * El interval hull es la proyección que consume la Capa de decisión.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { minkowskiSum, linearTransform, toIntervalHull, reduce } from '@/core/zonotope/zonotope';
import { Zonotope } from '@/core/zonotope/types';
import { fcParams, containedWithin } from './_config';
import { zonotopeArb, matrixArb, samplePoints } from './_generators';

/** Tolerancia relativa fijada por el enunciado de la tarea. */
const REL_EPS = 1e-9;

const POINTS_PER_CASE = 40;

function matVec(M: number[][], v: number[]): number[] {
  return M.map((row) => row.reduce((s, a, j) => s + a * v[j], 0));
}

/** Dos zonotopes de la MISMA dimensión (requisito de la suma de Minkowski). */
const sameDimensionPair = (): fc.Arbitrary<[Zonotope, Zonotope]> =>
  zonotopeArb().chain((z1) =>
    zonotopeArb(z1.dimension, z1.dimension).map((z2) => [z1, z2] as [Zonotope, Zonotope])
  );

describe('B4 · Definición 5.1 / Observación 5.1 — operaciones zonotópicas', () => {
  // ───────────────────────────────────────────────────────────────────────
  // (c) Interval hull — la propiedad más básica, se prueba primero
  // ───────────────────────────────────────────────────────────────────────

  it('(c) todo punto de Z cae en toIntervalHull(Z)', () => {
    fc.assert(
      fc.property(zonotopeArb(), fc.integer({ min: 1, max: 1e6 }), (z, seed) => {
        const hull = toIntervalHull(z);
        for (const p of samplePoints(z, POINTS_PER_CASE, seed)) {
          for (let i = 0; i < z.dimension; i++) {
            expect(containedWithin(p[i], hull[i].lower, hull[i].upper, REL_EPS)).toBe(true);
          }
        }
      }),
      fcParams
    );
  });

  it('el hull está bien formado y centrado en el centro del zonotope', () => {
    // Los zonotopes son politopos centralmente simétricos (Obs. 5.1), luego el
    // centro del hull coincide con c.
    fc.assert(
      fc.property(zonotopeArb(), (z) => {
        const hull = toIntervalHull(z);
        for (let i = 0; i < z.dimension; i++) {
          expect(hull[i].lower).toBeLessThanOrEqual(hull[i].upper);
          const mid = (hull[i].lower + hull[i].upper) / 2;
          expect(containedWithin(mid, z.center[i], z.center[i], 1e-9)).toBe(true);
        }
      }),
      fcParams
    );
  });

  // ───────────────────────────────────────────────────────────────────────
  // (a) Transformación lineal
  // ───────────────────────────────────────────────────────────────────────

  it('(a) x ∈ Z ⇒ M·x ∈ M·Z', () => {
    fc.assert(
      fc.property(
        zonotopeArb().chain((z) => matrixArb(z.dimension).map((M) => ({ z, M }))),
        fc.integer({ min: 1, max: 1e6 }),
        ({ z, M }, seed) => {
          const transformed = linearTransform(z, M);
          const hull = toIntervalHull(transformed);

          for (const p of samplePoints(z, POINTS_PER_CASE, seed)) {
            const image = matVec(M, p);
            for (let i = 0; i < z.dimension; i++) {
              expect(containedWithin(image[i], hull[i].lower, hull[i].upper, REL_EPS)).toBe(true);
            }
          }
        }
      ),
      fcParams
    );
  });

  it('la transformación lineal preserva la estructura <Mc, MG>', () => {
    fc.assert(
      fc.property(
        zonotopeArb().chain((z) => matrixArb(z.dimension).map((M) => ({ z, M }))),
        ({ z, M }) => {
          const t = linearTransform(z, M);
          expect(t.dimension).toBe(z.dimension);
          // El número de generadores no cambia: M·G tiene tantas columnas como G
          expect(t.generators.length).toBe(z.generators.length);
          const expectedCenter = matVec(M, z.center);
          for (let i = 0; i < z.dimension; i++) {
            expect(t.center[i]).toBeCloseTo(expectedCenter[i], 9);
          }
        }
      ),
      fcParams
    );
  });

  // ───────────────────────────────────────────────────────────────────────
  // (b) Suma de Minkowski
  // ───────────────────────────────────────────────────────────────────────

  it('(b) x ∈ Z1, y ∈ Z2 ⇒ x + y ∈ Z1 ⊕ Z2', () => {
    fc.assert(
      fc.property(
        sameDimensionPair(),
        fc.integer({ min: 1, max: 1e6 }),
        fc.integer({ min: 1, max: 1e6 }),
        ([z1, z2], seed1, seed2) => {
          const sum = minkowskiSum(z1, z2);
          const hull = toIntervalHull(sum);

          const pts1 = samplePoints(z1, POINTS_PER_CASE, seed1);
          const pts2 = samplePoints(z2, POINTS_PER_CASE, seed2);

          for (let k = 0; k < Math.min(pts1.length, pts2.length); k++) {
            for (let i = 0; i < z1.dimension; i++) {
              const v = pts1[k][i] + pts2[k][i];
              expect(containedWithin(v, hull[i].lower, hull[i].upper, REL_EPS)).toBe(true);
            }
          }
        }
      ),
      fcParams
    );
  });

  it('la suma de Minkowski concatena generadores y suma centros', () => {
    fc.assert(
      fc.property(sameDimensionPair(), ([z1, z2]) => {
        const sum = minkowskiSum(z1, z2);
        expect(sum.generators.length).toBe(z1.generators.length + z2.generators.length);
        for (let i = 0; i < z1.dimension; i++) {
          expect(sum.center[i]).toBeCloseTo(z1.center[i] + z2.center[i], 9);
        }
      }),
      fcParams
    );
  });

  it('la suma de Minkowski es conmutativa a nivel de conjunto (mismo hull)', () => {
    fc.assert(
      fc.property(sameDimensionPair(), ([z1, z2]) => {
        const a = toIntervalHull(minkowskiSum(z1, z2));
        const b = toIntervalHull(minkowskiSum(z2, z1));
        for (let i = 0; i < z1.dimension; i++) {
          expect(a[i].lower).toBeCloseTo(b[i].lower, 9);
          expect(a[i].upper).toBeCloseTo(b[i].upper, 9);
        }
      }),
      fcParams
    );
  });

  it('rechaza sumar zonotopes de dimensiones distintas', () => {
    fc.assert(
      fc.property(zonotopeArb(1, 2), zonotopeArb(3, 3), (z1, z2) => {
        expect(() => minkowskiSum(z1, z2)).toThrow();
      }),
      fcParams
    );
  });

  // ───────────────────────────────────────────────────────────────────────
  // Reducción de orden (Observación 5.2, método de Girard)
  // ───────────────────────────────────────────────────────────────────────

  it('la reducción de orden es SOUND: Z ⊆ reduce(Z, q)', () => {
    // La Obs. 5.2 admite explícitamente que la reducción "introduce
    // sobre-aproximación adicional", pero NUNCA puede perder puntos.
    fc.assert(
      fc.property(
        zonotopeArb(1, 3, 8),
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 1, max: 1e6 }),
        (z, extra, seed) => {
          const q = z.dimension + extra;
          const reduced = reduce(z, q);
          const hull = toIntervalHull(reduced);

          for (const p of samplePoints(z, POINTS_PER_CASE, seed)) {
            for (let i = 0; i < z.dimension; i++) {
              expect(containedWithin(p[i], hull[i].lower, hull[i].upper, REL_EPS)).toBe(true);
            }
          }
        }
      ),
      fcParams
    );
  });
});
