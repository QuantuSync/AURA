/**
 * Propiedad B2 — Proposición 3.1 (cobertura de la envolvente)
 * papers/AURA_v2.pdf §3.4.2
 *
 *   Si P* es compatible con AL MENOS UNA fuente S_i (P* ∈ P(m_i)), entonces
 *   P̲(θ_j) ≤ P*(θ_j) ≤ P̄(θ_j) para toda θ_j ∈ Θ
 *
 * La demostración del paper es: como Bel_i({θ_j}) ≤ P*(θ_j) ≤ Pl_i({θ_j}) y
 * P̲ = min_i Bel_i, P̄ = max_i Pl_i, el resultado sigue. Lo que se verifica
 * aquí es exactamente el paso que sostiene esa cadena: que la envolvente
 * computada contiene el [Bel_i, Pl_i] de CADA fuente.
 *
 * Esta propiedad es la que instancia la hipótesis H1 del Teorema 6.1.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computeEnvelope, envelopeCombine } from '@/core/dempster-shafer/combination';
import { allBeliefPlausibility } from '@/core/dempster-shafer/bpa';
import { fcParams } from './_config';
import { multiSourceArb } from './_generators';

/** Masas normalizadas: la comparación de bounds no necesita más tolerancia. */
const EPS = 1e-12;

describe('B2 · Proposición 3.1 — cobertura de la envolvente conservativa', () => {
  it('la envolvente contiene el [Bel, Pl] de cada fuente, en toda hipótesis', () => {
    fc.assert(
      fc.property(multiSourceArb(2, 4), ({ frame, bpas }) => {
        const envelope = computeEnvelope(bpas);

        for (const bpa of bpas) {
          const bp = allBeliefPlausibility(bpa);
          for (let j = 0; j < frame.hypotheses.length; j++) {
            // Eq (8): P̲(θ_j) = min_i Bel_i({θ_j}) ≤ Bel de esta fuente
            expect(envelope.bounds[j].lower).toBeLessThanOrEqual(bp[j].belief + EPS);
            // Eq (9): P̄(θ_j) = max_i Pl_i({θ_j}) ≥ Pl de esta fuente
            expect(envelope.bounds[j].upper).toBeGreaterThanOrEqual(bp[j].plausibility - EPS);
          }
        }
      }),
      fcParams
    );
  });

  it('toda distribución compatible con alguna fuente cae dentro de la envolvente', () => {
    // Instancia directa del enunciado de la Prop. 3.1: para cada fuente y cada
    // hipótesis, CUALQUIER valor admisible P*(θ_j) ∈ [Bel_i, Pl_i] está en la
    // envolvente. Se comprueba con los dos extremos, que son los peores casos.
    fc.assert(
      fc.property(multiSourceArb(2, 4), ({ frame, bpas }) => {
        const envelope = computeEnvelope(bpas);
        for (const bpa of bpas) {
          const bp = allBeliefPlausibility(bpa);
          for (let j = 0; j < frame.hypotheses.length; j++) {
            for (const pStar of [bp[j].belief, bp[j].plausibility]) {
              expect(pStar).toBeGreaterThanOrEqual(envelope.bounds[j].lower - EPS);
              expect(pStar).toBeLessThanOrEqual(envelope.bounds[j].upper + EPS);
            }
          }
        }
      }),
      fcParams
    );
  });

  it('la envolvente está bien formada: 0 ≤ lower ≤ upper ≤ 1', () => {
    fc.assert(
      fc.property(multiSourceArb(2, 4), ({ frame, bpas }) => {
        const envelope = computeEnvelope(bpas);
        expect(envelope.bounds.length).toBe(frame.hypotheses.length);
        for (const b of envelope.bounds) {
          expect(b.lower).toBeGreaterThanOrEqual(-EPS);
          expect(b.lower).toBeLessThanOrEqual(b.upper + EPS);
          expect(b.upper).toBeLessThanOrEqual(1 + EPS);
        }
      }),
      fcParams
    );
  });

  it('añadir una fuente nunca estrecha la envolvente (monotonía)', () => {
    // Consecuencia de min/max sobre el conjunto de fuentes: la envolvente solo
    // puede ensancharse al incorporar evidencia discordante. Es lo que hace que
    // "no descarta ninguna fuente" (§3.4.2) sea literalmente cierto.
    fc.assert(
      fc.property(multiSourceArb(3, 4), ({ frame, bpas }) => {
        const subset = computeEnvelope(bpas.slice(0, bpas.length - 1));
        const full = computeEnvelope(bpas);
        for (let j = 0; j < frame.hypotheses.length; j++) {
          expect(full.bounds[j].lower).toBeLessThanOrEqual(subset.bounds[j].lower + EPS);
          expect(full.bounds[j].upper).toBeGreaterThanOrEqual(subset.bounds[j].upper - EPS);
        }
      }),
      fcParams
    );
  });

  it('con una sola fuente la envolvente es exactamente su [Bel, Pl]', () => {
    fc.assert(
      fc.property(multiSourceArb(1, 1), ({ frame, bpas }) => {
        const envelope = computeEnvelope(bpas);
        const bp = allBeliefPlausibility(bpas[0]);
        for (let j = 0; j < frame.hypotheses.length; j++) {
          expect(envelope.bounds[j].lower).toBeCloseTo(bp[j].belief, 12);
          expect(envelope.bounds[j].upper).toBeCloseTo(bp[j].plausibility, 12);
        }
      }),
      fcParams
    );
  });

  // ───────────────────────────────────────────────────────────────────────
  // Relación de sobre-aproximación BPA sintética ⊇ envolvente exacta
  // ───────────────────────────────────────────────────────────────────────

  it('la BPA sintética de envelopeCombine SIEMPRE domina el upper de la envolvente', () => {
    // Formaliza la relación documentada en la iteración anterior. Demostración:
    //   Pl_i(θ_j) = 1 − Bel_i(¬θ_j) ≤ 1 − Σ_{k≠j} Bel_i(θ_k) ≤ 1 − Σ_{k≠j} minBel_k
    // y el lado derecho es exactamente minBel_j + m(Θ) = Pl de la BPA sintética.
    // Por tanto max_i Pl_i(θ_j) ≤ Pl_sintética(θ_j), para toda BPA de entrada.
    fc.assert(
      fc.property(multiSourceArb(2, 4), ({ frame, bpas }) => {
        const envelope = computeEnvelope(bpas);
        const syntheticPl = allBeliefPlausibility(envelopeCombine(bpas)).map(
          (bp) => bp.plausibility
        );
        for (let j = 0; j < frame.hypotheses.length; j++) {
          expect(envelope.bounds[j].upper).toBeLessThanOrEqual(syntheticPl[j] + 1e-9);
        }
      }),
      fcParams
    );
  });

  it('el lower coincide: la sobre-aproximación está SOLO en el upper', () => {
    fc.assert(
      fc.property(multiSourceArb(2, 4), ({ frame, bpas }) => {
        const envelope = computeEnvelope(bpas);
        const syntheticBel = allBeliefPlausibility(envelopeCombine(bpas)).map((bp) => bp.belief);
        for (let j = 0; j < frame.hypotheses.length; j++) {
          expect(syntheticBel[j]).toBeCloseTo(envelope.bounds[j].lower, 9);
        }
      }),
      fcParams
    );
  });

  it('la BPA sintética es una BPA válida (Definición 3.2)', () => {
    fc.assert(
      fc.property(multiSourceArb(2, 4), ({ bpas }) => {
        const synthetic = envelopeCombine(bpas);
        const total = synthetic.focalElements.reduce((s, fe) => s + fe.mass, 0);
        expect(total).toBeCloseTo(1, 9);
        for (const fe of synthetic.focalElements) {
          expect(fe.mass).toBeGreaterThanOrEqual(0);
          expect(fe.indices.length).toBeGreaterThan(0); // m(∅) = 0
        }
      }),
      fcParams
    );
  });
});
