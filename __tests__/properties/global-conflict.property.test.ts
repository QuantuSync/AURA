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
import {
  CONFLICT_RULE_IDS,
  ConflictRuleId,
  equivalentPairConflict,
} from '@/core/dempster-shafer/conflict-rules';
import { BPA, DEFAULT_FUSION_CONFIG } from '@/core/dempster-shafer/types';
import { fcParams } from './_config';
import { multiSourceArb } from './_generators';

/** Configuración del sistema con la regla `rule` y todo lo demás sin tocar. */
const configFor = (rule: ConflictRuleId) => ({ ...DEFAULT_FUSION_CONFIG, rule });

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

describe('B9 · (P2′) el conflicto de cada paso secuencial está acotado por K_global', () => {
  it('(I2) Π_k (1 − K^(k)) = 1 − K_global, en cualquier orden de reducción', () => {
    // La identidad de la que salen (P2′) y la normalización K_norm del
    // candidato C2. Se comprueba en TODAS las permutaciones: los K^(k)
    // individuales dependen del orden, su producto no.
    fc.assert(
      fc.property(multiSourceArb(2, 4), ({ bpas }) => {
        const kGlobal = globalConflict(bpas);
        if (kGlobal >= 1 - 1e-9) return true; // la reducción no está definida
        for (const perm of permutations(bpas.length)) {
          const { conflicts } = dempsterCombineMultiple(perm.map((i) => bpas[i]));
          const product = conflicts.reduce((p, k) => p * (1 - k), 1);
          // 9 cifras: cada paso normaliza y el producto acumula ese redondeo.
          expect(product).toBeCloseTo(1 - kGlobal, 9);
        }
        return true;
      }),
      fcParams
    );
  });

  it('(P2′) K^(k) ≤ K_global para todo paso, y el peor paso ≥ K_norm', () => {
    fc.assert(
      fc.property(multiSourceArb(2, 4), ({ bpas }) => {
        const kGlobal = globalConflict(bpas);
        if (kGlobal >= 1 - 1e-9) return true;
        const norm = equivalentPairConflict(kGlobal, bpas.length);
        for (const perm of permutations(bpas.length)) {
          const { conflicts } = dempsterCombineMultiple(perm.map((i) => bpas[i]));
          for (const k of conflicts) expect(k).toBeLessThanOrEqual(kGlobal + 1e-9);
          // K_norm es la media geométrica de los (1 − K^(k)) llevada a la
          // escala del conflicto: el máximo nunca puede quedar por debajo.
          expect(Math.max(...conflicts)).toBeGreaterThanOrEqual(norm - 1e-9);
        }
        return true;
      }),
      fcParams
    );
  });

  it('(P2) K_global < 1 ⇒ ninguna permutación de la reducción secuencial degenera', () => {
    // El caso débil de (P2′), que es el que cierra el hallazgo POR
    // CONSTRUCCIÓN: no hace falta que el conflicto por pares sea
    // representativo, basta K_global < 1.
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
});

/**
 * REQUISITO INNEGOCIABLE (b) del experimento pre-registrado de `docs/ERRATA.md`
 * §9: la rama Dempster no se ejecuta nunca con K_decision > κ₂, bajo NINGUNA de
 * las cuatro reglas candidatas. Se comprueba sobre las cuatro y no solo sobre la
 * seleccionada: C0 y las demás siguen disponibles por configuración, y una regla
 * disponible que no cumpla esto es una trampa esperando a que alguien la active.
 */
describe.each(CONFLICT_RULE_IDS)(
  'B9 · Def. 3.6 extendida — regla %s',
  (rule: ConflictRuleId) => {
    const config = configFor(rule);

    it('la decisión es función de (K_máx, K_global, n) y nunca baja de K_máx', () => {
      fc.assert(
        fc.property(multiSourceArb(2, 4), ({ bpas }) => {
          const a = assessConflict(bpas, config);
          expect(a.decision.rule).toBe(rule);
          // (P1) sigue valiendo bajo cualquier regla: es una propiedad de
          // K_global, no de la decisión.
          expect(a.globalConflict).toBeGreaterThanOrEqual(a.maxConflict - 1e-12);
          // Ninguna regla es menos conservadora que la Def. 3.6 literal.
          expect(a.decisionConflict).toBeGreaterThanOrEqual(a.maxConflict - 1e-12);
          if (rule === 'C0') {
            expect(a.decisionConflict).toBeCloseTo(a.globalConflict, 12);
          }
          if (rule === 'C1') {
            expect(a.decisionConflict).toBeCloseTo(a.maxConflict, 12);
          }
          if (rule === 'C2' || rule === 'C3') {
            expect(a.decision.normalizedConflict).toBeCloseTo(
              equivalentPairConflict(a.globalConflict, bpas.length),
              12
            );
          }
        }),
        fcParams
      );
    });

    it('fuse NUNCA ejecuta la rama Dempster cuando K_decision > κ₂', () => {
      fc.assert(
        fc.property(multiSourceArb(2, 4), ({ bpas }) => {
          const result = fuse(
            bpas,
            bpas.map(() => 0.05),
            config
          );
          const { kappa1, kappa2 } = config;

          if (result.decisionConflict > kappa2) {
            expect(result.method).toBe('envelope');
          }
          // Y el recíproco por niveles, que es la Def. 3.6 completa. Se enuncia
          // en la dirección método → conflicto porque la guardia puede forzar
          // la envolvente con K_decision ≤ κ₂: la implicación inversa
          // (conflicto → método) solo vale hacia la envolvente.
          if (result.method === 'dempster') {
            expect(result.decisionConflict).toBeLessThanOrEqual(kappa1);
            expect(result.degeneracyGuard).toBe(false);
          }
          if (result.method === 'cautious') {
            expect(result.decisionConflict).toBeGreaterThan(kappa1);
            expect(result.decisionConflict).toBeLessThanOrEqual(kappa2);
            expect(result.degeneracyGuard).toBe(false);
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
          const direct = fuse(bpas, rates, config);
          const shuffled = fuse(
            perm.map((i) => bpas[i]),
            perm.map((i) => rates[i]),
            config
          );

          // Lo que tiene que ser EXACTAMENTE invariante es la decisión.
          expect(shuffled.method).toBe(direct.method);
          expect(shuffled.degeneracyGuard).toBe(direct.degeneracyGuard);
          expect(shuffled.maxConflict).toBeCloseTo(direct.maxConflict, 12);
          expect(shuffled.globalConflict).toBeCloseTo(direct.globalConflict, 12);

          // K_decision es invariante en ℝ, pero su ERROR NUMÉRICO no es
          // uniforme entre reglas. K_norm tiene condicionamiento
          //     dK_norm/dK_global = (1/(n−1))·(1−K_global)^{1/(n−1)−1},
          // que DIVERGE cuando K_global → 1: con n = 4, un único ulp de
          // diferencia en K_global (2,2e-16) se convierte en 6e-6 en K_norm,
          // porque la raíz cúbica de 2,2e-16 vale 6e-6. La tolerancia se
          // propaga por la propia regla en vez de fijarse a ojo.
          //
          // No afecta a la decisión: la divergencia solo ocurre con
          // K_global ≈ 1, donde K_norm ≈ 1 está a 0,3 de κ₂. Cerca de los
          // umbrales el condicionamiento es ~1 (en κ₂ = 0,7 con n = 3 vale
          // 0,91), y ahí K_decision es tan estable como K_global.
          const n = bpas.length;
          const g = Math.min(direct.globalConflict, shuffled.globalConflict);
          const delta = Math.abs(direct.globalConflict - shuffled.globalConflict) + 1e-15;
          const propagated =
            equivalentPairConflict(Math.min(1, g + delta), n) -
            equivalentPairConflict(Math.max(0, g - delta), n);
          const tolerance =
            rule === 'C2' || rule === 'C3' ? Math.max(1e-12, propagated) : 1e-12;
          expect(Math.abs(shuffled.decisionConflict - direct.decisionConflict)).toBeLessThanOrEqual(
            tolerance
          );

          const a = massByFocalElement(direct.fused);
          const b = massByFocalElement(shuffled.fused);
          for (const key of new Set([...a.keys(), ...b.keys()])) {
            expect(b.get(key) ?? 0).toBeCloseTo(a.get(key) ?? 0, 9);
          }
        }),
        fcParams
      );
    });

    it('cuando fuse aplica Dempster, ningún K secuencial se acerca a la normalización degenerada', () => {
      fc.assert(
        fc.property(multiSourceArb(2, 4), ({ bpas }) => {
          const result = fuse(
            bpas,
            bpas.map(() => 0.05),
            config
          );
          if (result.method !== 'dempster') return true;
          expect(result.decisionConflict).toBeLessThanOrEqual(config.kappa1);

          // La cota que cada regla garantiza sobre K_global en esta rama. Por
          // (P2′) acota además el K de TODOS los pasos intermedios, y con él el
          // factor 1/(1−K) de la Ecuación (5).
          const bound =
            rule === 'C0'
              ? config.kappa1
              : rule === 'C1'
                ? config.kappaDegeneracy
                : 1 - Math.pow(1 - config.kappa1, bpas.length - 1);
          expect(bound).toBeLessThan(1);
          expect(result.globalConflict).toBeLessThanOrEqual(bound + 1e-9);

          for (const k of result.sequentialConflicts!) {
            expect(k).toBeLessThanOrEqual(bound + 1e-9);
            expect(k).toBeLessThan(1 - 1e-9);
          }
          return true;
        }),
        fcParams
      );
    });
  }
);
