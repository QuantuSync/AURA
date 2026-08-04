/**
 * Propiedad B1 — Proposición 4.1 (soundness de la aritmética de intervalos)
 * papers/AURA_v2.pdf §4.4.1
 *
 *   Si x ∈ [a] e y ∈ [b], entonces x ◦ y ∈ [a] ◦ [b] para ◦ ∈ {+, −, ×, /}
 *
 * Esta es la base de todo el Teorema 4.1 (soundness de la propagación por el
 * DAG) y, por composición, del Teorema 6.1. Si falla aquí, falla el pipeline
 * entero.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { add, subtract, multiply, divide } from '@/core/intervals/arithmetic';
import { Interval } from '@/core/intervals/types';
import { fcParams, realArb, unitArb, containedWithin } from './_config';

// ─────────────────────────────────────────────────────────────────────────
// Generadores
// ─────────────────────────────────────────────────────────────────────────

/** Intervalo no degenerado arbitrario (puede ser negativo o cruzar el cero). */
const properInterval = (min = -1e3, max = 1e3): fc.Arbitrary<Interval> =>
  fc
    .tuple(realArb(min, max), realArb(min, max))
    .map(([p, q]) => ({ lower: Math.min(p, q), upper: Math.max(p, q) }));

/** Intervalo degenerado [x, x] — ancho 0, el caso límite de la Def. 4.2. */
const degenerateInterval = (min = -1e3, max = 1e3): fc.Arbitrary<Interval> =>
  realArb(min, max).map((x) => ({ lower: x, upper: x }));

/** Intervalo estrictamente negativo. */
const negativeInterval = (): fc.Arbitrary<Interval> =>
  fc
    .tuple(realArb(-1e3, -1e-3), realArb(-1e3, -1e-3))
    .map(([p, q]) => ({ lower: Math.min(p, q), upper: Math.max(p, q) }));

/** Intervalo que contiene el cero en su interior. */
const straddlingZero = (): fc.Arbitrary<Interval> =>
  fc
    .tuple(realArb(-1e3, -1e-3), realArb(1e-3, 1e3))
    .map(([lo, hi]) => ({ lower: lo, upper: hi }));

/**
 * Mezcla de todas las familias. Se ponderan para que los casos límite
 * (degenerado, negativo, cruzando cero) no queden diluidos entre los
 * intervalos "genéricos".
 */
const anyInterval = (): fc.Arbitrary<Interval> =>
  fc.oneof(
    { weight: 4, arbitrary: properInterval() },
    { weight: 2, arbitrary: degenerateInterval() },
    { weight: 2, arbitrary: negativeInterval() },
    { weight: 2, arbitrary: straddlingZero() }
  );

/** Intervalo con 0 ∉ [b], requisito de la Ecuación (23). */
const nonZeroInterval = (): fc.Arbitrary<Interval> =>
  fc.oneof(
    negativeInterval(),
    fc
      .tuple(realArb(1e-3, 1e3), realArb(1e-3, 1e3))
      .map(([p, q]) => ({ lower: Math.min(p, q), upper: Math.max(p, q) })),
    realArb(1e-3, 1e3).map((x) => ({ lower: x, upper: x }))
  );

/** Punto de [iv] parametrizado por t ∈ [0,1], recortado por seguridad numérica. */
function pointIn(iv: Interval, t: number): number {
  const x = iv.lower + t * (iv.upper - iv.lower);
  return Math.min(iv.upper, Math.max(iv.lower, x));
}

/**
 * Tolerancia relativa. La aritmética del motor usa punto flotante sin redondeo
 * dirigido hacia fuera (documentado en arithmetic.ts), luego la contención es
 * sound salvo error de redondeo. 1e-12 es ~4 órdenes por encima del epsilon de
 * doble precisión: suficiente para absorber el redondeo, lo bastante ajustado
 * para detectar un error real de signo o de esquina.
 */
const REL_EPS = 1e-12;

/** Igual que arriba pero para división, que además redondea al calcular 1/b. */
const REL_EPS_DIV = 1e-9;

describe('B1 · Proposición 4.1 — soundness de la aritmética de intervalos', () => {
  it('suma: x ∈ [a], y ∈ [b] ⇒ x + y ∈ [a] + [b]  (Ec. 20)', () => {
    fc.assert(
      fc.property(anyInterval(), anyInterval(), unitArb(), unitArb(), (a, b, s, t) => {
        const x = pointIn(a, s);
        const y = pointIn(b, t);
        const r = add(a, b);
        return containedWithin(x + y, r.lower, r.upper, REL_EPS);
      }),
      fcParams
    );
  });

  it('resta: x − y ∈ [a] − [b]  (Ec. 21)', () => {
    fc.assert(
      fc.property(anyInterval(), anyInterval(), unitArb(), unitArb(), (a, b, s, t) => {
        const x = pointIn(a, s);
        const y = pointIn(b, t);
        const r = subtract(a, b);
        return containedWithin(x - y, r.lower, r.upper, REL_EPS);
      }),
      fcParams
    );
  });

  it('producto: x · y ∈ [a] · [b]  (Ec. 22)', () => {
    fc.assert(
      fc.property(anyInterval(), anyInterval(), unitArb(), unitArb(), (a, b, s, t) => {
        const x = pointIn(a, s);
        const y = pointIn(b, t);
        const r = multiply(a, b);
        return containedWithin(x * y, r.lower, r.upper, REL_EPS);
      }),
      fcParams
    );
  });

  it('división: x / y ∈ [a] / [b] cuando 0 ∉ [b]  (Ec. 23)', () => {
    fc.assert(
      fc.property(anyInterval(), nonZeroInterval(), unitArb(), unitArb(), (a, b, s, t) => {
        const x = pointIn(a, s);
        const y = pointIn(b, t);
        const r = divide(a, b);
        return containedWithin(x / y, r.lower, r.upper, REL_EPS_DIV);
      }),
      fcParams
    );
  });

  it('la división rechaza todo intervalo que contenga el 0 (Ec. 23, precondición)', () => {
    fc.assert(
      fc.property(anyInterval(), straddlingZero(), (a, b) => {
        expect(() => divide(a, b)).toThrow();
      }),
      fcParams
    );
  });

  it('rechaza también los intervalos que TOCAN el 0 en un extremo', () => {
    // [0, u] y [l, 0] hacen que 1/b sea infinito: la Ec. (23) no está definida.
    fc.assert(
      fc.property(anyInterval(), realArb(1e-6, 1e3), fc.boolean(), (a, m, upperSide) => {
        const b: Interval = upperSide ? { lower: 0, upper: m } : { lower: -m, upper: 0 };
        expect(() => divide(a, b)).toThrow();
      }),
      fcParams
    );
  });

  // ───────────────────────────────────────────────────────────────────────
  // Invariantes estructurales que se derivan de la Def. 4.2
  // ───────────────────────────────────────────────────────────────────────

  it('toda operación devuelve un intervalo bien formado (lower ≤ upper)', () => {
    fc.assert(
      fc.property(anyInterval(), anyInterval(), (a, b) => {
        for (const r of [add(a, b), subtract(a, b), multiply(a, b)]) {
          expect(r.lower).toBeLessThanOrEqual(r.upper);
          expect(Number.isNaN(r.lower)).toBe(false);
          expect(Number.isNaN(r.upper)).toBe(false);
        }
      }),
      fcParams
    );
  });

  it('sobre intervalos degenerados coincide con la aritmética real', () => {
    // Def. 4.2 debe colapsar al caso escalar cuando no hay incertidumbre.
    fc.assert(
      fc.property(realArb(-1e3, 1e3), realArb(-1e3, 1e3), (x, y) => {
        const a = { lower: x, upper: x };
        const b = { lower: y, upper: y };
        expect(add(a, b).lower).toBeCloseTo(x + y, 9);
        expect(add(a, b).upper).toBeCloseTo(x + y, 9);
        expect(subtract(a, b).lower).toBeCloseTo(x - y, 9);
        expect(multiply(a, b).lower).toBeCloseTo(x * y, 9);
        expect(multiply(a, b).upper).toBeCloseTo(x * y, 9);
      }),
      fcParams
    );
  });

  it('el ancho del resultado nunca disminuye respecto al mayor operando (+/−)', () => {
    // Consecuencia del wrapping effect: la aritmética intervalar no puede
    // recuperar información, solo perderla (§4.4.2, "dependency problem").
    fc.assert(
      fc.property(anyInterval(), anyInterval(), (a, b) => {
        const wa = a.upper - a.lower;
        const wb = b.upper - b.lower;
        const maxW = Math.max(wa, wb);
        for (const r of [add(a, b), subtract(a, b)]) {
          expect(r.upper - r.lower).toBeGreaterThanOrEqual(maxW - 1e-9 * Math.max(1, maxW));
        }
      }),
      fcParams
    );
  });
});
