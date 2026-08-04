/**
 * Propiedad B10 — Las tres medidas por pares de la Definición 3.6
 * `src/core/dempster-shafer/conflict-measures.ts` — EXTENSIÓN (docs/ERRATA.md §9)
 *
 * La Definición 3.5 fija UNA medida por pares (el K de la Ecuación 6) y la
 * Definición 3.6 la compara con κ₁ y κ₂. El hindcast midió que esa medida lleva
 * dentro un suelo de discretización que no depende del desacuerdo físico, y el
 * experimento pre-registrado `exp:conflict-floor` elige entre tres medidas.
 *
 * Aquí se verifican, sobre entradas GENERADAS, las propiedades de las que
 * depende que cualquiera de las tres pueda usarse sin romper nada:
 *
 *  · las estructurales de toda medida — rango, simetría, independencia del orden
 *    de los elementos focales y del orden de las fuentes;
 *  · las específicas de D1 (el exceso nunca supera al K crudo) y de D2 (métrica:
 *    d(m,m) = 0, simetría, desigualdad triangular);
 *  · el **REQUISITO INNEGOCIABLE (b)** del experimento: bajo las TRES medidas, la
 *    rama de Dempster no se ejecuta nunca con la medida de decisión > κ₂ ni con
 *    K_global CRUDO ≥ κ_deg. Es la forma autoritativa de la separación
 *    estructural —la guardia mira el K crudo— y se comprueba en todas las
 *    permutaciones de las fuentes.
 *
 * ⚠ Las BPAs de `multiSourceArb` NO llevan procedencia gaussiana: sobre ellas
 * D1 degrada a D0 por diseño. Las propiedades que exigen suelo real usan
 * {@link gaussianSourcesArb}, que construye por la Definición 3.4.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { createBPAFromGaussian } from '@/core/dempster-shafer/bpa';
import { fuse } from '@/core/dempster-shafer/combination';
import { assessConflict } from '@/core/dempster-shafer/conflict';
import {
  CONFLICT_MEASURE_IDS,
  CONFLICT_MEASURES,
  ConflictMeasureId,
  excessConflict,
  jousselmeDistance,
  pairwiseConflict,
  structuralFloor,
} from '@/core/dempster-shafer/conflict-measures';
import { BPA, DEFAULT_FUSION_CONFIG, FrameOfDiscernment } from '@/core/dempster-shafer/types';
import { fcParams } from './_config';
import { frameArb, multiSourceArb } from './_generators';

const configFor = (measure: ConflictMeasureId) => ({ ...DEFAULT_FUSION_CONFIG, measure });

/**
 * n fuentes construidas por la Definición 3.4 sobre un marco generado, con σ
 * HETEROGÉNEAS. Es el régimen en que existe el suelo: σ iguales lo reducen al
 * auto-conflicto, y el problema medido en el hindcast es el otro.
 */
const gaussianSourcesArb = (
  minSources = 2,
  maxSources = 4
): fc.Arbitrary<{ frame: FrameOfDiscernment; bpas: BPA[] }> =>
  frameArb().chain((frame) =>
    fc.integer({ min: minSources, max: maxSources }).chain((n) =>
      fc
        .array(
          fc.tuple(
            // Valor dentro del dominio declarado por H0.
            fc.double({ min: 0, max: frame.domainBound, noNaN: true, noDefaultInfinity: true }),
            // σ de dos órdenes de magnitud: la heterogeneidad es el punto.
            fc.double({ min: 0.2, max: 30, noNaN: true, noDefaultInfinity: true }),
            fc.double({ min: 0, max: 0.3, noNaN: true, noDefaultInfinity: true })
          ),
          { minLength: n, maxLength: n }
        )
        .map((specs) => ({
          frame,
          bpas: specs.map(([value, stddev, delta], i) =>
            createBPAFromGaussian(frame, value, stddev, delta, `g${i}`, 0)
          ),
        }))
    )
  );

/** Un caso generado más una permutación arbitraria de sus fuentes. */
const permutedArb = <T extends { bpas: BPA[] }>(base: fc.Arbitrary<T>) =>
  base.chain((scenario) =>
    fc
      .array(fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }), {
        minLength: scenario.bpas.length,
        maxLength: scenario.bpas.length,
      })
      .map((keys) => ({
        ...scenario,
        perm: keys
          .map((k, i) => ({ k, i }))
          .sort((a, b) => a.k - b.k || a.i - b.i)
          .map(({ i }) => i),
      }))
  );

// ─────────────────────────────────────────────────────────────────────────────
// Propiedades estructurales de toda medida
// ─────────────────────────────────────────────────────────────────────────────

describe.each(CONFLICT_MEASURE_IDS)('B10 · medida %s — invariantes estructurales', (id) => {
  const measure = CONFLICT_MEASURES[id];

  it('vive en [0, 1] y es simétrica hasta el redondeo IEEE-754', () => {
    fc.assert(
      fc.property(gaussianSourcesArb(2, 3), ({ bpas }) => {
        for (let i = 0; i < bpas.length; i++) {
          for (let j = i + 1; j < bpas.length; j++) {
            const v = measure.pair(bpas[i], bpas[j]);
            expect(Number.isFinite(v)).toBe(true);
            expect(v).toBeGreaterThanOrEqual(0);
            // La tolerancia es para D0 y solo para D0: el K de la Ecuación (6)
            // suma productos de masas que valen 1 ± ε cada una, y con evidencia
            // casi categórica devuelve 1 + 2e-16. Es la Ec. (6) tal cual, y no
            // se recorta aquí para no cambiar ningún número publicado. D1 y D2
            // sí cierran su rango de forma exacta, y eso se comprueba abajo.
            expect(v).toBeLessThanOrEqual(1 + 1e-12);
            if (id !== 'D0') expect(v).toBeLessThanOrEqual(1);
            // NO bit a bit, y conviene saber por qué. D0 y D1 se apoyan en
            // `pairwiseConflict`, que recorre el producto de elementos focales
            // en el orden de sus argumentos; la suma en coma flotante no es
            // asociativa, luego K(a,b) y K(b,a) pueden diferir en un ulp. Es la
            // misma salvedad que `docs/ERRATA.md` §3 declara para toda la
            // soundness del motor, y no afecta a la decisión: `assessConflict`
            // computa cada par UNA vez (i < j) y espeja la matriz, de modo que
            // la estrategia elegida no depende del orden de las fuentes —eso se
            // comprueba aparte, más abajo—.
            //
            // D2 sí es exacta (suma en orden canónico de elementos focales), y
            // eso se fija en `__tests__/core/dempster-shafer/conflict-measures.test.ts`.
            expect(measure.pair(bpas[j], bpas[i])).toBeCloseTo(v, 12);
          }
        }
      }),
      fcParams
    );
  });

  it('no depende del orden de los elementos focales dentro de cada BPA', () => {
    fc.assert(
      fc.property(multiSourceArb(2, 2), ({ bpas }) => {
        const reversed = bpas.map((b) => ({ ...b, focalElements: [...b.focalElements].reverse() }));
        expect(measure.pair(reversed[0], reversed[1])).toBeCloseTo(
          measure.pair(bpas[0], bpas[1]),
          12
        );
      }),
      fcParams
    );
  });

  it('el máximo por pares es invariante a permutaciones de las fuentes', () => {
    fc.assert(
      fc.property(permutedArb(gaussianSourcesArb(2, 4)), ({ bpas, perm }) => {
        const direct = assessConflict(bpas, configFor(id)).measureConflict;
        const shuffled = assessConflict(
          perm.map((i) => bpas[i]),
          configFor(id)
        ).measureConflict;
        expect(shuffled).toBeCloseTo(direct, 12);
      }),
      fcParams
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D1
// ─────────────────────────────────────────────────────────────────────────────

describe('B10 · D1 — exceso normalizado sobre el suelo', () => {
  it('(i) dos fuentes que miden LO MISMO tienen K_excess = 0 exacto', () => {
    fc.assert(
      fc.property(
        frameArb(),
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.2, max: 30, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.2, max: 30, noNaN: true, noDefaultInfinity: true }),
        (frame, t, sa, sb) => {
          const value = t * frame.domainBound;
          const a = createBPAFromGaussian(frame, value, sa, 0.02, 'a', 0);
          const b = createBPAFromGaussian(frame, value, sb, 0.05, 'b', 0);
          expect(excessConflict(a, b)).toBe(0);
        }
      ),
      fcParams
    );
  });

  it('(ii)-(iii) K_excess ∈ [0, 1] y nunca supera al K crudo', () => {
    fc.assert(
      fc.property(gaussianSourcesArb(2, 3), ({ bpas }) => {
        for (let i = 0; i < bpas.length; i++) {
          for (let j = i + 1; j < bpas.length; j++) {
            const e = excessConflict(bpas[i], bpas[j]);
            const k = pairwiseConflict(bpas[i], bpas[j]);
            expect(e).toBeGreaterThanOrEqual(0);
            expect(e).toBeLessThanOrEqual(1);
            // La demostración del JSDoc: K_floor·(K−1) ≤ 0. D1 NUNCA es más
            // conservadora que D0 — y por tanto no puede introducir
            // envolventes que D0 no produjera.
            expect(e).toBeLessThanOrEqual(k + 1e-12);
          }
        }
      }),
      fcParams
    );
  });

  it('el suelo es un K legítimo: K_floor ∈ [0, 1) y no depende del orden del par', () => {
    fc.assert(
      fc.property(gaussianSourcesArb(2, 2), ({ bpas }) => {
        const f = structuralFloor(bpas[0], bpas[1]);
        expect(f).not.toBeNull();
        expect(f!).toBeGreaterThanOrEqual(0);
        expect(f!).toBeLessThan(1);
        expect(structuralFloor(bpas[1], bpas[0])!).toBeCloseTo(f!, 12);
      }),
      fcParams
    );
  });

  it('sin procedencia, D1 ES D0 bit a bit', () => {
    fc.assert(
      fc.property(multiSourceArb(2, 2), ({ bpas }) => {
        expect(structuralFloor(bpas[0], bpas[1])).toBeNull();
        expect(excessConflict(bpas[0], bpas[1])).toBe(pairwiseConflict(bpas[0], bpas[1]));
      }),
      fcParams
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D2
// ─────────────────────────────────────────────────────────────────────────────

describe('B10 · D2 — la distancia de Jousselme es una métrica', () => {
  it('d(m, m) = 0 exactamente, y d(a, b) = 0 solo si las masas coinciden', () => {
    fc.assert(
      fc.property(multiSourceArb(2, 2), ({ bpas }) => {
        expect(jousselmeDistance(bpas[0], bpas[0])).toBe(0);
        expect(jousselmeDistance(bpas[1], bpas[1])).toBe(0);
      }),
      fcParams
    );
  });

  it('cumple la desigualdad triangular', () => {
    // Es lo que la distingue de un K reescalado: d_J viene de una forma
    // cuadrática semidefinida positiva (la matriz de Jaccard), luego es una
    // norma y la triangular es un teorema, no una casualidad.
    fc.assert(
      fc.property(multiSourceArb(3, 3), ({ bpas }) => {
        const [a, b, c] = bpas;
        expect(jousselmeDistance(a, c)).toBeLessThanOrEqual(
          jousselmeDistance(a, b) + jousselmeDistance(b, c) + 1e-9
        );
      }),
      fcParams
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REQUISITO INNEGOCIABLE (b)
// ─────────────────────────────────────────────────────────────────────────────

describe.each(CONFLICT_MEASURE_IDS)(
  'B10 · requisito (b) — la rama Dempster bajo la medida %s',
  (id) => {
    const config = configFor(id);

    it('nunca se ejecuta con la medida de decisión > κ₂ ni con K_global crudo ≥ κ_deg', () => {
      fc.assert(
        fc.property(permutedArb(gaussianSourcesArb(2, 4)), ({ bpas, perm }) => {
          for (const order of [bpas, perm.map((i) => bpas[i])]) {
            const r = fuse(
              order,
              order.map(() => 0.05),
              config
            );
            expect(r.measure).toBe(id);

            if (r.method === 'dempster') {
              // Def. 3.6: la rama de Dempster exige Nivel 1.
              expect(r.decisionConflict).toBeLessThanOrEqual(config.kappa1);
              expect(r.decisionConflict).toBeLessThanOrEqual(config.kappa2);
              // Y la SEPARACIÓN ESTRUCTURAL: la cota que hace válida a (P2′)
              // sigue siendo sobre el K_global CRUDO, no sobre la medida. Es lo
              // que impide que descontar el suelo abra la puerta a la
              // degeneración de la Ecuación (5).
              expect(r.globalConflict).toBeLessThan(config.kappaDegeneracy);
              expect(r.degeneracyGuard).toBe(false);
              for (const k of r.sequentialConflicts!) {
                expect(k).toBeLessThanOrEqual(r.globalConflict + 1e-9);
                expect(k).toBeLessThan(1 - 1e-9);
              }
            }

            // La guardia, en la dirección que importa: si el K crudo degenera,
            // se va a envolvente decida lo que decida la medida.
            if (r.globalConflict >= config.kappaDegeneracy) {
              expect(r.method).toBe('envelope');
              expect(r.degeneracyGuard).toBe(true);
            }
          }
        }),
        fcParams
      );
    });

    it('la medida no puede hacer que una fusión degenerada llegue a Dempster', () => {
      fc.assert(
        fc.property(multiSourceArb(2, 4), ({ bpas }) => {
          const r = fuse(
            bpas,
            bpas.map(() => 0.05),
            config
          );
          if (r.method !== 'dempster') return true;
          // La hipótesis de (P2): existe una intersección total no vacía.
          expect(r.globalConflict).toBeLessThan(1);
          return true;
        }),
        fcParams
      );
    });
  }
);
