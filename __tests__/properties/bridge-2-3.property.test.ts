/**
 * Propiedad B5 — Proposición 5.1 (cobertura del lifting) · Puente 2→3
 * papers/AURA_v2.pdf §5.3, Definición 5.2 / Ecuación (27); Lema 6.2 §6.2
 *
 *   Si v*ᵢ ∈ [Vᵢ] para todo i, entonces (v*₁, …, v*ₙ) ∈ Z₀
 *
 * con Z₀ = <c₀, G₀>, c₀ᵢ = (v̲ᵢ + v̄ᵢ)/2, G₀ = diag((v̄ᵢ − v̲ᵢ)/2).
 *
 * La demostración del paper es constructiva: αᵢ = (v*ᵢ − c₀ᵢ)/rᵢ ∈ [−1,1], de
 * modo que v* = c₀ + G₀α ∈ Z₀. Se verifica AMBAS cosas: la pertenencia y el
 * testigo α, porque es el testigo el que hace la demostración citable.
 *
 * Este puente es el Lema 6.2, uno de los cuatro eslabones que compone el
 * Teorema 6.1.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { fromIntervals, toIntervalHull } from '@/core/zonotope/zonotope';
import { Interval } from '@/core/intervals/types';
import { fcParams, unitArb, containedWithin } from './_config';
import { intervalBoxArb, pointInBox } from './_generators';

const REL_EPS = 1e-9;

/** Caja de intervalos junto con las fracciones que localizan un punto interior. */
const boxWithPoint = (): fc.Arbitrary<{ box: Interval[]; ts: number[] }> =>
  intervalBoxArb(1, 4).chain((box) =>
    fc
      .array(unitArb(), { minLength: box.length, maxLength: box.length })
      .map((ts) => ({ box, ts }))
  );

describe('B5 · Proposición 5.1 — cobertura del lifting a zonotope (Puente 2→3)', () => {
  it('v* ∈ [V] para todo i ⇒ v* ∈ Z₀', () => {
    fc.assert(
      fc.property(boxWithPoint(), ({ box, ts }) => {
        const vStar = pointInBox(box, ts);
        const z0 = fromIntervals(box);
        const hull = toIntervalHull(z0);

        for (let i = 0; i < box.length; i++) {
          expect(containedWithin(vStar[i], hull[i].lower, hull[i].upper, REL_EPS)).toBe(true);
        }
      }),
      fcParams
    );
  });

  it('el testigo α de la demostración existe y cumple α ∈ [−1, 1]ⁿ', () => {
    // Reproduce literalmente el argumento de la Prop. 5.1.
    fc.assert(
      fc.property(boxWithPoint(), ({ box, ts }) => {
        const vStar = pointInBox(box, ts);
        const z0 = fromIntervals(box);

        for (let i = 0; i < box.length; i++) {
          const radius = z0.generators[i][i];
          if (radius <= 0) {
            // Intervalo degenerado: no hay α que construir, v* debe ser el centro.
            expect(Math.abs(vStar[i] - z0.center[i])).toBeLessThanOrEqual(1e-9);
            continue;
          }
          const alpha = (vStar[i] - z0.center[i]) / radius;
          expect(alpha).toBeGreaterThanOrEqual(-1 - 1e-9);
          expect(alpha).toBeLessThanOrEqual(1 + 1e-9);
        }
      }),
      fcParams
    );
  });

  it('reconstruir c₀ + G₀·α devuelve exactamente v*', () => {
    fc.assert(
      fc.property(boxWithPoint(), ({ box, ts }) => {
        const vStar = pointInBox(box, ts);
        const z0 = fromIntervals(box);

        const alpha = box.map((_, i) => {
          const radius = z0.generators[i][i];
          return radius > 0 ? (vStar[i] - z0.center[i]) / radius : 0;
        });

        const reconstructed = z0.center.map(
          (c, i) => c + z0.generators.reduce((s, g, r) => s + alpha[r] * g[i], 0)
        );

        for (let i = 0; i < box.length; i++) {
          const scale = Math.max(1, Math.abs(vStar[i]));
          expect(Math.abs(reconstructed[i] - vStar[i])).toBeLessThanOrEqual(1e-9 * scale);
        }
      }),
      fcParams
    );
  });

  it('Z₀ es un zonotope-caja: G₀ diagonal, sin correlaciones iniciales (Ec. 27)', () => {
    fc.assert(
      fc.property(intervalBoxArb(1, 4), (box) => {
        const z0 = fromIntervals(box);
        expect(z0.dimension).toBe(box.length);
        expect(z0.generators.length).toBe(box.length);

        for (let r = 0; r < box.length; r++) {
          for (let i = 0; i < box.length; i++) {
            if (r === i) {
              expect(z0.generators[r][i]).toBeCloseTo((box[i].upper - box[i].lower) / 2, 9);
            } else {
              expect(z0.generators[r][i]).toBe(0);
            }
          }
          expect(z0.center[r]).toBeCloseTo((box[r].lower + box[r].upper) / 2, 9);
        }
      }),
      fcParams
    );
  });

  it('el lifting es EXACTO: el hull de Z₀ recupera la caja de partida', () => {
    // A diferencia de la propagación no lineal, el Puente 2→3 no introduce
    // conservatismo alguno: ρ = 1 en el sentido de la Definición 5.6.
    fc.assert(
      fc.property(intervalBoxArb(1, 4), (box) => {
        const hull = toIntervalHull(fromIntervals(box));
        for (let i = 0; i < box.length; i++) {
          const scale = Math.max(1, Math.abs(box[i].lower), Math.abs(box[i].upper));
          expect(Math.abs(hull[i].lower - box[i].lower)).toBeLessThanOrEqual(1e-9 * scale);
          expect(Math.abs(hull[i].upper - box[i].upper)).toBeLessThanOrEqual(1e-9 * scale);
        }
      }),
      fcParams
    );
  });

  it('los vértices de la caja —el peor caso— siguen dentro de Z₀', () => {
    // La contención en los extremos es la que sostiene el Lema 6.2; un error
    // de signo en G₀ solo se manifestaría aquí.
    fc.assert(
      fc.property(intervalBoxArb(1, 3), (box) => {
        const hull = toIntervalHull(fromIntervals(box));
        const n = box.length;
        for (let mask = 0; mask < Math.pow(2, n); mask++) {
          const vertex = box.map((iv, i) => ((mask >> i) & 1 ? iv.upper : iv.lower));
          for (let i = 0; i < n; i++) {
            expect(containedWithin(vertex[i], hull[i].lower, hull[i].upper, REL_EPS)).toBe(true);
          }
        }
      }),
      fcParams
    );
  });
});
