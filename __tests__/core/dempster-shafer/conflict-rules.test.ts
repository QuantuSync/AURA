/**
 * AURA v2 — Las cuatro reglas de decisión de la Definición 3.6
 *
 * `src/core/dempster-shafer/conflict-rules.ts` (y `docs/ERRATA.md` §9).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ BLOQUEA ESTE FICHERO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Dos cosas distintas, y conviene no confundirlas:
 *
 *  1. **El requisito innegociable (a)** del experimento pre-registrado: el
 *     contraejemplo del ciclo va a envolvente o a cautelosa bajo las CUATRO
 *     reglas, nunca a Dempster degenerado. Una regla que falle aquí queda
 *     descalificada por informativa que sea. El resto del requisito está en
 *     `__tests__/properties/global-conflict.property.test.ts` (b) y en
 *     `__tests__/experiments/world-soundness.test.ts` (c).
 *
 *  2. **Las afirmaciones cerradas del JSDoc**: la exactitud de K_norm en n = 2,
 *     la identidad Π(1 − K^(k)) = 1 − K_global de la que sale, y el punto
 *     exacto en que C3 deja de colapsar en C2. Son las que sostienen el
 *     razonamiento; si dejan de valer, el razonamiento se cae en silencio.
 */

import { describe, it, expect } from 'vitest';

import {
  CONFLICT_RULE_IDS,
  CONFLICT_RULES,
  ConflictDecisionInput,
  ConflictRuleId,
  equivalentPairConflict,
  ruleOf,
} from '@/core/dempster-shafer/conflict-rules';
import {
  globalConflict,
  pairwiseConflict,
  assessConflict,
} from '@/core/dempster-shafer/conflict';
import { dempsterCombineMultiple, fuse } from '@/core/dempster-shafer/combination';
import { createBPAFromGaussian } from '@/core/dempster-shafer/bpa';
import { createFrame } from '@/core/dempster-shafer/frame';
import { BPA, DEFAULT_FUSION_CONFIG, FrameOfDiscernment } from '@/core/dempster-shafer/types';

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

const mk = (focalElements: BPA['focalElements'], sourceId: string): BPA => ({
  frame,
  focalElements,
  sourceId,
  timestamp: 0,
});

/**
 * El contraejemplo del ciclo (property-based testing, `docs/ERRATA.md` §2):
 * cada fuente comparte una hipótesis con la siguiente, las tres juntas no
 * comparten ninguna. Todos los pares dan K = 0,75 y K_global = 1.
 */
const CYCLE: BPA[] = [
  mk([{ indices: [0], mass: 0.5 }, { indices: [1], mass: 0.5 }], 'm1'),
  mk([{ indices: [1], mass: 0.5 }, { indices: [2], mass: 0.5 }], 'm2'),
  mk([{ indices: [2], mass: 0.5 }, { indices: [0], mass: 0.5 }], 'm3'),
];

const configFor = (rule: ConflictRuleId) => ({ ...DEFAULT_FUSION_CONFIG, rule });

const inputOf = (over: Partial<ConflictDecisionInput> = {}): ConflictDecisionInput => ({
  maxConflict: 0,
  globalConflict: 0,
  sourceCount: 3,
  kappa1: DEFAULT_FUSION_CONFIG.kappa1,
  kappa2: DEFAULT_FUSION_CONFIG.kappa2,
  kappaDegeneracy: DEFAULT_FUSION_CONFIG.kappaDegeneracy,
  ...over,
});

// ─────────────────────────────────────────────────────────────────────────────
// Requisito innegociable (a)
// ─────────────────────────────────────────────────────────────────────────────

describe('requisito (a) · el contraejemplo del ciclo bajo las cuatro reglas', () => {
  it('el escenario es el del hallazgo: pares a 0,75 y K_global = 1', () => {
    expect(pairwiseConflict(CYCLE[0], CYCLE[1])).toBeCloseTo(0.75, 12);
    expect(pairwiseConflict(CYCLE[1], CYCLE[2])).toBeCloseTo(0.75, 12);
    expect(pairwiseConflict(CYCLE[0], CYCLE[2])).toBeCloseTo(0.75, 12);
    expect(globalConflict(CYCLE)).toBeCloseTo(1, 12);
  });

  for (const rule of CONFLICT_RULE_IDS) {
    it(`${rule}: no elige Dempster, y la fusión no degenera`, () => {
      const assessment = assessConflict(CYCLE, configFor(rule));
      expect(assessment.method).not.toBe('dempster');
      // El enunciado exacto del requisito: envolvente o cautelosa.
      expect(['cautious', 'envelope']).toContain(assessment.method);

      // Y la fusión completa tampoco lanza ni produce una BPA degenerada.
      const result = fuse(CYCLE, [0.05, 0.05, 0.05], configFor(rule));
      expect(result.method).not.toBe('dempster');
      const total = result.fused.focalElements.reduce((s, fe) => s + fe.mass, 0);
      expect(total).toBeCloseTo(1, 9);
    });
  }

  it('la reducción secuencial sí degenera si se la llama a pelo: el peligro es real', () => {
    // Lo que las cuatro reglas existen para no alcanzar nunca.
    expect(() => dempsterCombineMultiple(CYCLE)).toThrow(/Total conflict/);
  });

  it('en el ciclo, C1 y C3 llegan a la envolvente por vías distintas', () => {
    // C1 decide con K_máx = 0,75 > κ₂ y ADEMÁS dispara la guardia; C0/C2 llegan
    // por la comparación con κ₂ sin guardia. Que el resultado coincida no
    // significa que el mecanismo sea el mismo, y la traza lo distingue.
    const c1 = assessConflict(CYCLE, configFor('C1')).decision;
    expect(c1.decisionConflict).toBeCloseTo(0.75, 12);
    expect(c1.degeneracyGuard).toBe(true);

    const c0 = assessConflict(CYCLE, configFor('C0')).decision;
    expect(c0.decisionConflict).toBeCloseTo(1, 12);
    expect(c0.degeneracyGuard).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// K_norm — el par equivalente
// ─────────────────────────────────────────────────────────────────────────────

describe('K_norm = 1 − (1 − K_global)^{1/(n−1)}', () => {
  const { kappa2 } = DEFAULT_FUSION_CONFIG;

  it('con n = 2 es el K por pares EXACTO, bit a bit', () => {
    // No `toBeCloseTo`: el caso binario del paper no puede cambiar ni en el
    // último dígito por haber introducido la normalización.
    for (const k of [0, 1e-9, 0.0271608265379, 0.3, 0.7, 0.9512, 1]) {
      expect(equivalentPairConflict(k, 2)).toBe(k);
    }

    const a = createBPAFromGaussian(frame, 8, 4, 0, 's1');
    const b = createBPAFromGaussian(frame, 35, 6, 0, 's2');
    const kPair = pairwiseConflict(a, b);
    expect(globalConflict([a, b])).toBeCloseTo(kPair, 12);
    expect(equivalentPairConflict(globalConflict([a, b]), 2)).toBe(globalConflict([a, b]));

    // Y por tanto C0, C2 y C3 deciden idéntico con dos fuentes.
    for (const rule of ['C0', 'C2', 'C3'] as const) {
      const d = assessConflict([a, b], configFor(rule)).decision;
      expect(d.decisionConflict).toBeCloseTo(kPair, 12);
    }
  });

  it('una sola fuente no tiene par equivalente', () => {
    expect(equivalentPairConflict(0.9, 1)).toBe(0);
    expect(equivalentPairConflict(0.9, 0)).toBe(0);
  });

  it('es monótona creciente en K_global y decreciente en n', () => {
    expect(equivalentPairConflict(0.5, 3)).toBeLessThan(equivalentPairConflict(0.8, 3));
    expect(equivalentPairConflict(0.8, 4)).toBeLessThan(equivalentPairConflict(0.8, 3));
    expect(equivalentPairConflict(0.8, 6)).toBeLessThan(equivalentPairConflict(0.8, 4));
  });

  it('no produce NaN en los extremos ni con un K_global de 1 + ε por redondeo', () => {
    expect(equivalentPairConflict(1, 3)).toBe(1);
    expect(equivalentPairConflict(1 + 1e-15, 3)).toBe(1);
    expect(equivalentPairConflict(0, 3)).toBe(0);
    expect(equivalentPairConflict(-1e-16, 3)).toBe(0);
  });

  it('está mal condicionada cerca del conflicto total, y da igual para la decisión', () => {
    // Un ULP de diferencia en K_global se amplifica por la raíz (n−1)-ésima.
    const ulp = Number.EPSILON; // 2,22e-16
    const amplified = 1 - equivalentPairConflict(1 - ulp, 4);
    expect(amplified).toBeCloseTo(Math.cbrt(ulp), 12);
    expect(amplified).toBeGreaterThan(6e-6); // cinco órdenes por encima del ULP

    // Y por qué no importa: la amplificación vive donde K_norm ya está muy
    // por encima de κ₂, no en el entorno de los umbrales.
    expect(equivalentPairConflict(1 - ulp, 4)).toBeGreaterThan(kappa2 + 0.29);
    const around = (k: number, n: number) =>
      (equivalentPairConflict(k + 1e-9, n) - equivalentPairConflict(k - 1e-9, n)) / 2e-9;
    expect(around(kappa2, 3)).toBeLessThan(1); // condicionamiento ≈ 0,91
    expect(around(DEFAULT_FUSION_CONFIG.kappa1, 3)).toBeLessThan(1);
  });

  it('(I2) es la media geométrica del conflicto por paso: Π(1 − K^(k)) = 1 − K_global', () => {
    // La identidad que justifica la normalización. Sobre un caso con conflicto
    // apreciable pero sin degeneración, para que la reducción exista.
    const bpas = [
      createBPAFromGaussian(frame, 4, 2, 0.05, 's1'),
      createBPAFromGaussian(frame, 12, 2, 0.05, 's2'),
      createBPAFromGaussian(frame, 17, 2, 0.05, 's3'),
    ];
    const kGlobal = globalConflict(bpas);
    const { conflicts } = dempsterCombineMultiple(bpas);
    const product = conflicts.reduce((p, k) => p * (1 - k), 1);
    // 9 cifras y no 12: la reducción secuencial normaliza en cada paso y el
    // producto acumula el redondeo de esas divisiones. La identidad es exacta
    // en ℝ; lo que se comprueba aquí es que la implementación no se aparta de
    // ella más de lo que IEEE-754 obliga (ver `docs/ERRATA.md` §3).
    expect(product).toBeCloseTo(1 - kGlobal, 9);

    // (P2′): ningún paso supera K_global…
    for (const k of conflicts) expect(k).toBeLessThanOrEqual(kGlobal + 1e-12);
    // …y el peor paso no baja de la media geométrica, que es K_norm.
    const norm = equivalentPairConflict(kGlobal, bpas.length);
    expect(Math.max(...conflicts)).toBeGreaterThanOrEqual(norm - 1e-12);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// La nota de C3
// ─────────────────────────────────────────────────────────────────────────────

describe('¿colapsa C3 en C2?', () => {
  const { kappa2, kappaDegeneracy } = DEFAULT_FUSION_CONFIG;

  it('la frontera analítica es n − 1 < ln(1 − κ_deg)/ln(1 − κ₂) = 2,4882', () => {
    expect(Math.log(1 - kappaDegeneracy) / Math.log(1 - kappa2)).toBeCloseTo(2.4882, 4);
  });

  it('para n ≤ 3 la guardia es redundante: K_global ≥ κ_deg ya implica K_norm > κ₂', () => {
    for (const n of [2, 3]) {
      expect(equivalentPairConflict(kappaDegeneracy, n)).toBeGreaterThan(kappa2);
    }
    // Y por tanto C2 y C3 deciden lo mismo en TODO el rango de K_global, que es
    // el enunciado que importa en el dominio de la demo (§7.2, tres fuentes).
    for (const n of [2, 3]) {
      for (let i = 0; i <= 1000; i++) {
        const kGlobal = i / 1000;
        const kMax = kGlobal * 0.9; // cualquier K_máx admisible por (P1)
        const input = inputOf({ globalConflict: kGlobal, maxConflict: kMax, sourceCount: n });
        expect(CONFLICT_RULES.C3.decide(input).method).toBe(
          CONFLICT_RULES.C2.decide(input).method
        );
      }
    }
  });

  it('para n ≥ 4 la guardia SÍ añade algo: C2 iría a cautelosa donde C3 fuerza envolvente', () => {
    const input = inputOf({ globalConflict: 0.95, maxConflict: 0.2, sourceCount: 4 });
    expect(equivalentPairConflict(0.95, 4)).toBeCloseTo(0.631597, 5);
    expect(CONFLICT_RULES.C2.decide(input).method).toBe('cautious');
    expect(CONFLICT_RULES.C3.decide(input).method).toBe('envelope');
    expect(CONFLICT_RULES.C3.decide(input).degeneracyGuard).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Invariantes comunes a las cuatro reglas
// ─────────────────────────────────────────────────────────────────────────────

describe('invariantes de toda regla', () => {
  /** Malla determinista de entradas admisibles: por (P1), K_máx ≤ K_global. */
  const GRID: ConflictDecisionInput[] = [];
  for (const n of [2, 3, 4, 5, 6]) {
    for (let g = 0; g <= 40; g++) {
      const kGlobal = g / 40;
      for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
        GRID.push(inputOf({ globalConflict: kGlobal, maxConflict: kGlobal * frac, sourceCount: n }));
      }
    }
  }

  for (const rule of CONFLICT_RULE_IDS) {
    const r = CONFLICT_RULES[rule];

    it(`${rule}: method === 'dempster' ⟹ K_decision ≤ κ₁ (nunca al revés por la guardia)`, () => {
      for (const input of GRID) {
        const d = r.decide(input);
        if (d.method === 'dempster') expect(d.decisionConflict).toBeLessThanOrEqual(input.kappa1);
        if (d.method === 'cautious') {
          expect(d.decisionConflict).toBeGreaterThan(input.kappa1);
          expect(d.decisionConflict).toBeLessThanOrEqual(input.kappa2);
        }
      }
    });

    it(`${rule}: la rama Dempster garantiza una cota K_global ≤ B < 1 — hipótesis de (P2′)`, () => {
      for (const input of GRID) {
        if (r.decide(input).method !== 'dempster') continue;
        expect(input.globalConflict).toBeLessThan(1);
        // La cota explícita que documenta cada regla.
        const bound =
          rule === 'C0'
            ? input.kappa1
            : rule === 'C1'
              ? input.kappaDegeneracy
              : 1 - Math.pow(1 - input.kappa1, input.sourceCount - 1);
        expect(input.globalConflict).toBeLessThanOrEqual(bound + 1e-12);
        expect(bound).toBeLessThan(1);
      }
    });

    it(`${rule}: nunca es MENOS conservadora que el K_máx del paper`, () => {
      // La Def. 3.6 literal aplicaría κ a K_máx. Ninguna regla puede elegir
      // Dempster donde el paper ya elegía cautelosa: todas comparan una
      // magnitud ≥ K_máx (C1 la iguala) y solo la endurecen con la guardia.
      for (const input of GRID) {
        const d = r.decide(input);
        expect(d.decisionConflict).toBeGreaterThanOrEqual(input.maxConflict - 1e-12);
      }
    });

    it(`${rule}: la guardia solo aparece donde puede`, () => {
      const hasGuard = rule === 'C1' || rule === 'C3';
      for (const input of GRID) {
        const d = r.decide(input);
        expect(d.rule).toBe(rule);
        if (!hasGuard) expect(d.degeneracyGuard).toBe(false);
        if (d.degeneracyGuard) {
          expect(input.globalConflict).toBeGreaterThanOrEqual(input.kappaDegeneracy);
          expect(d.method).toBe('envelope');
          expect(d.level).toBe('high');
        }
        expect(d.normalizedConflict === null).toBe(rule === 'C0' || rule === 'C1');
      }
    });
  }

  it('una regla desconocida LANZA en lugar de caer en silencio al default', () => {
    expect(() => ruleOf({ rule: 'C9' as ConflictRuleId })).toThrow(/regla de conflicto desconocida/);
  });
});
