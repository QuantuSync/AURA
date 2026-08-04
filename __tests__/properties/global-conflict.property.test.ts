/**
 * Propiedad B9 — Conflicto global n-ario e independencia del orden
 * papers/AURA_v2.pdf §3.4.2, Definiciones 3.5 y 3.6 — EXTENSIÓN (ver docs/ERRATA.md, entrada 2)
 *
 *   K_global = Σ_{A₁∩…∩Aₙ = ∅}  m₁(A₁) · … · mₙ(Aₙ)
 *
 * El paper decide la estrategia de fusión con K_máx = máx_{i≠j} K_ij
 * (Definición 3.6), y el property-based testing demostró que ese número no
 * acota el conflicto de la reducción secuencial de Dempster. K_global es la
 * generalización n-aria del K de la Ecuación (6): se define sobre el producto
 * conjunto, donde no hay orden, y por tanto no puede depender de él.
 *
 * Estas propiedades verifican lo que se afirma en el JSDoc de `globalConflict`:
 * (P1) K_global ≥ K_ij para todo par, y (P2) K_global < 1 impide el conflicto
 * total en cualquier orden de reducción.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  globalConflict,
  pairwiseConflict,
  conflictMatrix,
  assessConflict,
} from '@/core/dempster-shafer/conflict';
import { fuse, dempsterCombineMultiple } from '@/core/dempster-shafer/combination';
import { BPA, DEFAULT_FUSION_CONFIG } from '@/core/dempster-shafer/types';
import { fcParams } from './_config';
import { multiSourceArb } from './_generators';

/**
 * Implementación de referencia: enumera EXPLÍCITAMENTE el producto conjunto,
 * sin la poda por prefijo vacío que usa la implementación real. Sirve de
 * oráculo independiente — si la poda fuese incorrecta, divergirían.
 */
function globalConflictNaive(bpas: BPA[]): number {
  let conflict = 0;
  const walk = (i: number, current: number[] | null, product: number): void => {
    if (i === bpas.length) {
      if (current !== null && current.length === 0) conflict += product;
      return;
    }
    for (const fe of bpas[i].focalElements) {
      const next =
        current === null ? fe.indices : current.filter((idx) => fe.indices.includes(idx));
      walk(i + 1, next, product * fe.mass);
    }
  };
  walk(0, null, 1);
  return conflict;
}

/** ¿Algún elemento del producto conjunto cae en la intersección vacía? */
function someProductIsEmpty(bpas: BPA[]): boolean {
  let found = false;
  const walk = (i: number, current: number[] | null): void => {
    if (found) return;
    if (i === bpas.length) {
      if (current !== null && current.length === 0) found = true;
      return;
    }
    for (const fe of bpas[i].focalElements) {
      const next =
        current === null ? fe.indices : current.filter((idx) => fe.indices.includes(idx));
      walk(i + 1, next);
    }
  };
  walk(0, null);
  return found;
}

/** Masas de una BPA indexadas por elemento focal canónico. */
function massByFocalElement(bpa: BPA): Map<string, number> {
  const map = new Map<string, number>();
  for (const fe of bpa.focalElements) {
    const key = [...fe.indices].sort((a, b) => a - b).join(',');
    map.set(key, (map.get(key) ?? 0) + fe.mass);
  }
  return map;
}

/** Todas las permutaciones de [0..n-1]. n ≤ 4 ⇒ como mucho 24. */
function permutations(n: number): number[][] {
  if (n === 0) return [[]];
  const out: number[][] = [];
  for (const rest of permutations(n - 1)) {
    for (let pos = 0; pos <= rest.length; pos++) {
      out.push([...rest.slice(0, pos), n - 1, ...rest.slice(pos)]);
    }
  }
  return out;
}

/** Un caso generado más una permutación arbitraria de sus fuentes. */
const permutedSourcesArb = (minSources = 2, maxSources = 4) =>
  multiSourceArb(minSources, maxSources).chain((scenario) =>
    fc
      .array(fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }), {
        minLength: scenario.bpas.length,
        maxLength: scenario.bpas.length,
      })
      .map((keys) => ({
        ...scenario,
        // Permutación derivada de claves aleatorias: determinista dada la
        // semilla y uniforme sobre el conjunto de órdenes.
        perm: keys
          .map((k, i) => ({ k, i }))
          .sort((a, b) => a.k - b.k || a.i - b.i)
          .map(({ i }) => i),
      }))
  );

describe('B9 · K_global — definición, cotas y consistencia con la Ecuación (6)', () => {
  it('coincide con la enumeración explícita del producto conjunto (la poda es exacta)', () => {
    fc.assert(
      fc.property(multiSourceArb(2, 4), ({ bpas }) => {
        expect(globalConflict(bpas)).toBeCloseTo(globalConflictNaive(bpas), 12);
      }),
      fcParams
    );
  });

  it('K_global ∈ [0, 1] y es finito', () => {
    // ⚠ El cierre superior es 1, no 1⁻ como en el K por pares de la Ec. (6):
    // el conflicto global n-ario SÍ alcanza 1 (contraejemplo del ciclo), y ese
    // es exactamente el caso que la extensión existe para detectar.
    fc.assert(
      fc.property(multiSourceArb(2, 4), ({ bpas }) => {
        const k = globalConflict(bpas);
        expect(Number.isFinite(k)).toBe(true);
        expect(k).toBeGreaterThanOrEqual(0);
        expect(k).toBeLessThanOrEqual(1 + 1e-12);
      }),
      fcParams
    );
  });

  it('K_global = 0 ⟺ ningún elemento del producto conjunto cae en la intersección vacía', () => {
    fc.assert(
      fc.property(multiSourceArb(2, 4), ({ bpas }) => {
        const k = globalConflict(bpas);
        const hasEmpty = someProductIsEmpty(bpas);
        // Las masas generadas son ≥ 0.05/total, muy por encima del ruido de
        // redondeo, de modo que "hay un producto vacío" ⟺ "K > 0" sin zona gris.
        expect(k > 1e-12).toBe(hasEmpty);
      }),
      fcParams
    );
  });

  it('(P1) K_global ≥ K_ij para todo par, y K_global = K por pares cuando n = 2', () => {
    fc.assert(
      fc.property(multiSourceArb(2, 4), ({ bpas }) => {
        const k = globalConflict(bpas);
        const matrix = conflictMatrix(bpas);
        for (let i = 0; i < bpas.length; i++) {
          for (let j = i + 1; j < bpas.length; j++) {
            expect(k).toBeGreaterThanOrEqual(matrix[i][j] - 1e-12);
          }
        }
        if (bpas.length === 2) {
          expect(k).toBeCloseTo(pairwiseConflict(bpas[0], bpas[1]), 12);
        }
      }),
      fcParams
    );
  });

  it('K_global es invariante a permutaciones de las fuentes', () => {
    fc.assert(
      fc.property(permutedSourcesArb(), ({ bpas, perm }) => {
        expect(globalConflict(perm.map((i) => bpas[i]))).toBeCloseTo(globalConflict(bpas), 12);
      }),
      fcParams
    );
  });

  it('lanza cuando n supera el límite configurable, en lugar de degradar en silencio', () => {
    fc.assert(
      fc.property(multiSourceArb(2, 4), ({ bpas }) => {
        const config = { ...DEFAULT_FUSION_CONFIG, maxSourcesForGlobalConflict: 1 };
        expect(() => globalConflict(bpas, config)).toThrow(/exponential in the number of sources/);
      }),
      fcParams
    );
  });
});

describe('B9 · Def. 3.6 extendida — la decisión no depende del orden ni del conflicto por pares', () => {
  it('K_decision = máx(K_máx, K_global) y, por (P1), es K_global salvo redondeo', () => {
    fc.assert(
      fc.property(multiSourceArb(2, 4), ({ bpas }) => {
        const a = assessConflict(bpas);
        expect(a.decisionConflict).toBeCloseTo(Math.max(a.maxConflict, a.globalConflict), 12);
        expect(a.decisionConflict).toBeCloseTo(a.globalConflict, 12);
        expect(a.decisionConflict).toBeGreaterThanOrEqual(a.maxConflict - 1e-12);
      }),
      fcParams
    );
  });

  it('fuse NUNCA ejecuta la rama Dempster cuando K_decision > κ₂', () => {
    fc.assert(
      fc.property(multiSourceArb(2, 4), ({ bpas }) => {
        const result = fuse(
          bpas,
          bpas.map(() => 0.05)
        );
        const { kappa1, kappa2 } = DEFAULT_FUSION_CONFIG;

        if (result.decisionConflict > kappa2) {
          expect(result.method).toBe('envelope');
        }
        // Y el recíproco por niveles, que es la Def. 3.6 completa.
        if (result.method === 'dempster') expect(result.decisionConflict).toBeLessThanOrEqual(kappa1);
        if (result.method === 'cautious') {
          expect(result.decisionConflict).toBeGreaterThan(kappa1);
          expect(result.decisionConflict).toBeLessThanOrEqual(kappa2);
        }
      }),
      fcParams
    );
  });

  it('el resultado de fuse es invariante a permutaciones del orden de las fuentes', () => {
    fc.assert(
      fc.property(permutedSourcesArb(), ({ bpas, perm }) => {
        const rates = bpas.map((_, i) => 0.02 * i); // distintos entre sí: la
        // media cautelosa solo es invariante si los pesos viajan con su fuente.
        const direct = fuse(bpas, rates);
        const shuffled = fuse(
          perm.map((i) => bpas[i]),
          perm.map((i) => rates[i])
        );

        expect(shuffled.method).toBe(direct.method);
        expect(shuffled.decisionConflict).toBeCloseTo(direct.decisionConflict, 12);
        expect(shuffled.maxConflict).toBeCloseTo(direct.maxConflict, 12);

        const a = massByFocalElement(direct.fused);
        const b = massByFocalElement(shuffled.fused);
        for (const key of new Set([...a.keys(), ...b.keys()])) {
          expect(b.get(key) ?? 0).toBeCloseTo(a.get(key) ?? 0, 9);
        }
      }),
      fcParams
    );
  });

  it('(P2) K_global < 1 ⇒ ninguna permutación de la reducción secuencial degenera', () => {
    // Esta es la propiedad que cierra el hallazgo POR CONSTRUCCIÓN: no hace
    // falta que el conflicto por pares sea representativo, basta K_global < 1.
    fc.assert(
      fc.property(multiSourceArb(2, 4), ({ bpas }) => {
        if (globalConflict(bpas) >= 1 - 1e-12) return true;
        for (const perm of permutations(bpas.length)) {
          expect(() => dempsterCombineMultiple(perm.map((i) => bpas[i]))).not.toThrow();
        }
        return true;
      }),
      fcParams
    );
  });

  it('cuando fuse aplica Dempster, ningún K secuencial se acerca a la normalización degenerada', () => {
    fc.assert(
      fc.property(multiSourceArb(2, 4), ({ bpas }) => {
        const result = fuse(
          bpas,
          bpas.map(() => 0.05)
        );
        if (result.method !== 'dempster') return true;
        expect(result.decisionConflict).toBeLessThanOrEqual(DEFAULT_FUSION_CONFIG.kappa1);
        for (const k of result.sequentialConflicts!) {
          // Con K_global ≤ κ₁ = 0,3, el factor 1/(1−K) de cada paso está
          // acotado muy lejos de la singularidad.
          expect(k).toBeLessThan(1 - 1e-9);
        }
        return true;
      }),
      fcParams
    );
  });
});
