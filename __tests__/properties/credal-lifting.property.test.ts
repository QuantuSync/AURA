/**
 * AURA v2 — Propiedades del lifting continuo bajo soporte acotado (H0)
 *
 * Invariante normativo (papers/AURA_v2.pdf):
 *   Definición 3.9 y Ecuación (10), §3.6 — I(X) = ⋃ { I_j : P̄(I_j) > 0 }
 *   Lema 6.1 (soundness del Puente 1→2), §6.1 — x* ∈ [x̲, x̄]
 *
 * EXTENSIÓN (docs/ERRATA.md §5): el Lema 6.1 se verifica aquí **condicionado a
 * H0**, la hipótesis de soporte acotado. El marco de la Def. 3.1 tiene cola
 * abierta [60, ∞) y la Ec. (10) devuelve entonces `+∞`; AURA cierra esa cola
 * con el `domainBound` declarado del marco. El enunciado que se verifica es
 * por tanto:
 *
 *   Para todo P del conjunto credal y todo x* muestreado de P cuyo soporte
 *   respete H0 (x* ≤ domainBound), se cumple x* ∈ I(X).
 *
 * Y su recíproco negativo, igual de importante para que la garantía sea
 * honesta: un x* que VIOLA H0 puede quedar fuera de I(X), y eso no es un bug
 * del motor sino H0 falsa. Es el mismo patrón que el caso negativo de H2 ya
 * verificado en `dag-propagation.property.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { buildCredalSet } from '@/core/dempster-shafer/credal-set';
import { fuse } from '@/core/dempster-shafer/combination';
import { frameRange, hypothesisUpper } from '@/core/dempster-shafer/frame';
import { BeliefPlausibility, FrameOfDiscernment } from '@/core/dempster-shafer/types';
import { fcParams, unitArb } from './_config';
import { bpaArb, frameArb, multiSourceArb, openTailFrameArb } from './_generators';

/** Tolerancia de coma flotante de la Def. 3.9. NO es un filtro semántico. */
const PL_EPS = 1e-10;

/**
 * Construye una distribución P del conjunto credal a partir de sus bounds
 * [Bel_j, Pl_j] — Definición 3.8:
 *
 *     P(m) = { P ∈ Δ(Θ) : P(A) ≥ Bel(A) ∀A ⊆ Θ }
 *
 * Procedimiento: se parte de P_j = Bel_j (el mínimo que el conjunto credal
 * admite) y se reparte la masa restante R = 1 − Σ Bel_j en un orden arbitrario,
 * topando cada hipótesis en su Pl_j. El resultado satisface Bel_j ≤ P_j ≤ Pl_j
 * y Σ P_j = 1, luego es un punto del conjunto credal.
 *
 * Es factible siempre: Σ Bel_j ≤ 1 ≤ Σ Pl_j tanto para los bounds derivados de
 * una BPA como para los de la envolvente exacta de la Def. 3.7.
 *
 * @param order permutación (por fracciones en [0,1]) del orden de reparto
 */
function credalDistribution(bounds: BeliefPlausibility[], order: number[]): number[] {
  const n = bounds.length;
  const p = bounds.map((b) => b.belief);
  let remaining = 1 - p.reduce((s, v) => s + v, 0);

  const idx = Array.from({ length: n }, (_, j) => j).sort(
    (a, b) => (order[a % order.length] ?? 0) - (order[b % order.length] ?? 0)
  );

  for (const j of idx) {
    if (remaining <= 0) break;
    const room = Math.max(0, bounds[j].plausibility - p[j]);
    const give = Math.min(room, remaining);
    p[j] += give;
    remaining -= give;
  }

  // Residuo por error de redondeo o por bounds ligeramente inconsistentes:
  // se deposita donde haya plausibilidad, nunca donde Pl = 0.
  if (remaining > 1e-12) {
    for (const j of idx) {
      if (bounds[j].plausibility > PL_EPS) {
        p[j] += remaining;
        break;
      }
    }
  }
  return p;
}

/** Valor dentro de la hipótesis j, parametrizado por t ∈ [0, 1]. */
function sampleInHypothesis(frame: FrameOfDiscernment, j: number, t: number): number {
  const a = frame.hypotheses[j].lower;
  const b = hypothesisUpper(frame, j);
  return a + t * (b - a);
}

// ─────────────────────────────────────────────────────────────────────────
// (a) Lema 6.1 condicionado a H0 — el lifting contiene el valor real
// ─────────────────────────────────────────────────────────────────────────

describe('Lema 6.1 bajo H0: el lifting de la Ec. (10) contiene el valor muestreado', () => {
  it('todo x* de toda distribución del conjunto credal cae en I(X)', () => {
    fc.assert(
      fc.property(
        multiSourceArb(2, 4),
        fc.array(unitArb(), { minLength: 5, maxLength: 5 }),
        unitArb(),
        unitArb(),
        ({ frame, bpas }, order, pick, t) => {
          const credalSet = buildCredalSet(fuse(bpas, bpas.map(() => 0.05)));
          const p = credalDistribution(credalSet.bounds, order);

          // Hipótesis con probabilidad no despreciable bajo P: son las que
          // pueden producir un valor real. `pick` elige entre ellas.
          const support = p
            .map((v, j) => ({ v, j }))
            .filter(({ v }) => v > PL_EPS);
          if (support.length === 0) return; // P degenerada: nada que muestrear

          const chosen = support[Math.min(support.length - 1, Math.floor(pick * support.length))];
          const xStar = sampleInHypothesis(frame, chosen.j, t);

          // H0 se cumple por construcción: xStar ≤ domainBound.
          expect(xStar).toBeLessThanOrEqual(frame.domainBound);

          const { lower, upper } = credalSet.continuousInterval;
          expect(xStar).toBeGreaterThanOrEqual(lower);
          expect(xStar).toBeLessThanOrEqual(upper);
        }
      ),
      fcParams
    );
  });

  it('ninguna hipótesis con Pl > 1e-10 queda fuera del intervalo (sin filtro semántico)', () => {
    // Es el contrapositivo del argumento del Lema 6.1 y la razón por la que el
    // filtro `Pl > 0,01` de la versión anterior rompía la soundness: descartar
    // una hipótesis plausible puede excluir el valor real.
    fc.assert(
      fc.property(multiSourceArb(2, 4), ({ frame, bpas }) => {
        const credalSet = buildCredalSet(fuse(bpas, bpas.map(() => 0.05)));
        const { lower, upper } = credalSet.continuousInterval;

        for (const b of credalSet.bounds) {
          if (b.plausibility > PL_EPS) {
            expect(lower).toBeLessThanOrEqual(frame.hypotheses[b.hypothesis].lower);
            expect(upper).toBeGreaterThanOrEqual(hypothesisUpper(frame, b.hypothesis));
          }
        }
      }),
      fcParams
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// (b) El intervalo credal está acotado por el marco — H0 materializada
// ─────────────────────────────────────────────────────────────────────────

describe('el intervalo credal vive dentro del dominio declarado del marco', () => {
  it('es finito y contenido en [a₀, domainBound]', () => {
    fc.assert(
      fc.property(multiSourceArb(2, 4), ({ frame, bpas }) => {
        const { lower, upper } = buildCredalSet(
          fuse(bpas, bpas.map(() => 0.05))
        ).continuousInterval;
        const range = frameRange(frame);

        expect(Number.isFinite(lower)).toBe(true);
        expect(Number.isFinite(upper)).toBe(true);
        expect(lower).toBeGreaterThanOrEqual(range.lower);
        expect(upper).toBeLessThanOrEqual(range.upper);
        expect(lower).toBeLessThanOrEqual(upper);
      }),
      fcParams
    );
  });

  it('un marco con la cola escrita [a, ∞) da el MISMO intervalo que el cerrado', () => {
    // La Def. 3.1 literal contra el marco normalizado por `createFrame`: el
    // `Infinity` declarado no puede colarse en el lifting.
    fc.assert(
      fc.property(
        openTailFrameArb(2, 5).chain((open) =>
          fc
            .tuple(bpaArb(open, 's0'), bpaArb(open, 's1'))
            .map(([b0, b1]) => ({ open, bpas: [b0, b1] }))
        ),
        ({ open, bpas }) => {
          const closed: FrameOfDiscernment = {
            ...open,
            hypotheses: open.hypotheses.map((h, j) =>
              j === open.hypotheses.length - 1 ? { ...h, upper: open.domainBound } : h
            ),
          };
          const withOpen = buildCredalSet(fuse(bpas, [0.05, 0.05])).continuousInterval;
          const withClosed = buildCredalSet(
            fuse(
              bpas.map((b) => ({ ...b, frame: closed })),
              [0.05, 0.05]
            )
          ).continuousInterval;

          expect(withOpen.lower).toBe(withClosed.lower);
          expect(withOpen.upper).toBe(withClosed.upper);
          expect(Number.isFinite(withOpen.upper)).toBe(true);
        }
      ),
      fcParams
    );
  });

  it('el bound superior es el domainBound, no un múltiplo de los datos', () => {
    // Regresión estructural contra el `a_j · 2`: cuando la hipótesis de cola es
    // plausible, el upper coincide EXACTAMENTE con la declaración del marco,
    // sea cual sea la anchura de esa cola.
    fc.assert(
      fc.property(multiSourceArb(2, 4), ({ frame, bpas }) => {
        const cs = buildCredalSet(fuse(bpas, bpas.map(() => 0.05)));
        const tail = cs.bounds[cs.bounds.length - 1];
        if (tail.plausibility > PL_EPS) {
          expect(cs.continuousInterval.upper).toBe(frame.domainBound);
        }
      }),
      fcParams
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// (c) CASO NEGATIVO — violar H0 puede dejar el valor real fuera
// ─────────────────────────────────────────────────────────────────────────

describe('violar H0 puede excluir el valor real (no es un bug: es H0 falsa)', () => {
  /**
   * Simétrico del caso negativo de H2 en `dag-propagation.property.test.ts`.
   *
   * El Lema 6.1 garantiza x* ∈ I(X) **bajo** H0. Si el valor real excede el
   * `domainBound` declarado, NINGUNA evidencia puede rescatarlo: el marco no
   * tiene ninguna hipótesis que lo cubra, luego la unión de la Ec. (10)
   * tampoco. El motor no puede detectarlo —haría falta conocer x*—, y por eso
   * H0 viaja en el certificado en vez de quedarse implícita.
   */
  it('todo x* > domainBound queda fuera del intervalo credal, siempre', () => {
    fc.assert(
      fc.property(
        multiSourceArb(2, 4),
        fc.double({ min: 1e-6, max: 1e4, noNaN: true, noDefaultInfinity: true }),
        ({ frame, bpas }, excess) => {
          const cs = buildCredalSet(fuse(bpas, bpas.map(() => 0.05)));
          const xStar = frame.domainBound + excess; // H0 VIOLADA

          expect(xStar).toBeGreaterThan(frame.domainBound);
          expect(xStar).toBeGreaterThan(cs.continuousInterval.upper);
          // El certificado emitido sobre este conjunto credal sería inválido, y
          // el motor no tiene forma de saberlo: es exactamente lo que H0
          // declara y lo que un auditor debe comprobar por su cuenta.
        }
      ),
      fcParams
    );
  });

  it('bajo H0 el mismo muestreo SÍ está contenido: la frontera es el domainBound', () => {
    // Contraste directo con el caso anterior — el corte está donde H0 lo pone,
    // ni antes (truncamiento arbitrario) ni después.
    fc.assert(
      fc.property(frameArb(2, 5), unitArb(), (frame, t) => {
        const j = frame.hypotheses.length - 1;
        const xStar = sampleInHypothesis(frame, j, t); // ≤ domainBound
        expect(xStar).toBeLessThanOrEqual(frame.domainBound);
        expect(xStar).toBeGreaterThanOrEqual(frame.hypotheses[j].lower);
      }),
      fcParams
    );
  });
});
