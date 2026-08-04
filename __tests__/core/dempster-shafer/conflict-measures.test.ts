/**
 * AURA v2 — Las tres medidas por pares de la Definición 3.6
 *
 * `src/core/dempster-shafer/conflict-measures.ts` (y `docs/ERRATA.md` §9).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ BLOQUEA ESTE FICHERO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  1. **El hecho que motiva la corrección**: la tabla del suelo estructural.
 *     Tres BPAs sobre la MISMA medición exacta, con las σ del hindcast, dan
 *     K_máx = 0,3651 > κ₁. Si algún día deja de ser cierto, la entrada 9 de la
 *     ERRATA describe un problema que ya no existe y hay que reescribirla.
 *  2. **Las propiedades (i)-(iii) de D1** y las de la distancia de Jousselme,
 *     que son lo que hace que cada medida signifique lo que su JSDoc dice.
 *  3. **La separación estructural**: la guardia opera sobre el K_global CRUDO, y
 *     por eso el contraejemplo del ciclo va a envolvente bajo las TRES medidas
 *     —incluida D2, que le asigna un conflicto de 0,5 < κ₂ y por sí sola habría
 *     elegido la media cautelosa—.
 *
 * Las versiones sobre entradas generadas están en
 * `__tests__/properties/conflict-measures.property.test.ts`; aquí van los casos
 * cerrados con números concretos.
 */

import { describe, it, expect } from 'vitest';

import { createBPAFromGaussian, createIgnorantBPA } from '@/core/dempster-shafer/bpa';
import {
  CONFLICT_MEASURE_IDS,
  CONFLICT_MEASURES,
  ConflictMeasureId,
  excessConflict,
  jaccard,
  jousselmeDistance,
  measureOf,
  normalizedExcess,
  pairwiseConflict,
  precisionWeightedReference,
  structuralFloor,
} from '@/core/dempster-shafer/conflict-measures';
import { assessConflict } from '@/core/dempster-shafer/conflict';
import { fuse } from '@/core/dempster-shafer/combination';
import { BPA, DEFAULT_FUSION_CONFIG } from '@/core/dempster-shafer/types';
import { HINDCAST_SOURCES } from '@/data/sources/hindcast-characterization';
import { PRECIPITATION_FRAME } from '@/lib/constants';

const { kappa1, kappa2, kappaDegeneracy } = DEFAULT_FUSION_CONFIG;

const configFor = (measure: ConflictMeasureId) => ({ ...DEFAULT_FUSION_CONFIG, measure });

/** BPA gaussiana sobre el marco de precipitación (Def. 3.4). */
const B = (value: number, stddev: number, failureRate = 0.02, sourceId = 's'): BPA =>
  createBPAFromGaussian(PRECIPITATION_FRAME, value, stddev, failureRate, sourceId, 0);

/** Las tres fuentes del hindcast midiendo EXACTAMENTE lo mismo. */
const agreeingHindcast = (value: number): BPA[] =>
  HINDCAST_SOURCES.map((c) =>
    createBPAFromGaussian(
      PRECIPITATION_FRAME,
      value,
      c.precipitationStddev,
      c.failureRate,
      c.sourceId,
      0
    )
  );

// ─────────────────────────────────────────────────────────────────────────────
// El hecho que se corrige
// ─────────────────────────────────────────────────────────────────────────────

describe('el suelo estructural de conflicto por discretización', () => {
  it('con dispersión CERO y las σ del hindcast, K_máx = 0,3651 > κ₁', () => {
    // Las tres σ que producen el efecto, pineadas aquí para que este test diga
    // por sí solo de dónde sale el número.
    expect(HINDCAST_SOURCES.map((c) => c.precipitationStddev)).toEqual([5, 1.8, 10]);

    const a = assessConflict(agreeingHindcast(0), configFor('D0'));
    expect(a.maxConflict).toBeCloseTo(0.3651, 4);
    expect(a.maxConflict).toBeGreaterThan(kappa1);
    // Y la consecuencia dura: la rama de Dempster es inalcanzable con acuerdo
    // perfecto, que es el enunciado de la limitación medida de la ERRATA §9.
    expect(a.method).toBe('cautious');
  });

  it('el suelo persiste en todo el régimen de intensidades bajas y medias', () => {
    for (const [value, expected] of [
      [0, 0.3651],
      [1, 0.4111],
      [5, 0.5605],
      [10, 0.6188],
      [20, 0.5014],
    ] as const) {
      const a = assessConflict(agreeingHindcast(value), configFor('D0'));
      expect(a.maxConflict).toBeCloseTo(expected, 4);
      expect(a.method).toBe('cautious');
    }
    // Solo con intensidad alta baja de κ₁: allí las hipótesis del marco son
    // anchas (30-60, 60-500) y las tres σ caben dentro de la misma.
    expect(assessConflict(agreeingHindcast(40), configFor('D0')).method).toBe('dempster');
  });

  it('D1 lo anula por completo: acuerdo perfecto ⇒ conflicto cero EXACTO', () => {
    for (const value of [0, 0.5, 1, 2, 5, 10, 20, 40]) {
      const a = assessConflict(agreeingHindcast(value), configFor('D1'));
      // Cero exacto, no `toBeCloseTo`: es la propiedad (i).
      expect(a.measureConflict).toBe(0);
      expect(a.method).toBe('dempster');
      // El K crudo sigue reportándose sin tocar, que es lo que permite auditar
      // cuánto se descontó.
      expect(a.maxConflict).toBeGreaterThan(0);
    }
  });

  it('D2 lo reduce pero NO lo anula: el suelo no es auto-conflicto', () => {
    // La afirmación del JSDoc de `jousselmeDistance`, comprobada en vez de
    // supuesta: d_J(m,m) = 0 elimina el auto-conflicto, pero aquí las dos BPAs
    // son DISTINTAS (misma medición, σ distintas) y su distancia no es cero.
    for (const [value, expected] of [
      [0, 0.2727],
      [5, 0.1525],
      [10, 0.5131],
    ] as const) {
      const a = assessConflict(agreeingHindcast(value), configFor('D2'));
      expect(a.measureConflict).toBeCloseTo(expected, 4);
      expect(a.measureConflict).toBeGreaterThan(0);
    }
  });

  it('el auto-conflicto K(m, m) de una sola fuente ya es grande con σ gruesa', () => {
    // El fenómeno que Martin y Osswald nombran, y la parte del suelo que D2
    // elimina por construcción.
    expect(pairwiseConflict(B(0, 1.8), B(0, 1.8))).toBeCloseTo(0.0052, 4);
    expect(pairwiseConflict(B(0, 10), B(0, 10))).toBeCloseTo(0.441, 3);
    expect(jousselmeDistance(B(0, 10), B(0, 10))).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D1 — propiedades (i), (ii), (iii)
// ─────────────────────────────────────────────────────────────────────────────

describe('D1 · exceso normalizado sobre el suelo', () => {
  it('(i) mediciones idénticas por par ⇒ K_excess = 0 EXACTAMENTE', () => {
    for (const value of [0, 0.37, 1, 7.25, 40, 123.4]) {
      for (const [sa, sb] of [
        [1.8, 10],
        [5, 5],
        [0.5, 20],
      ] as const) {
        const a = B(value, sa, 0.02, 'a');
        const b = B(value, sb, 0.03, 'b');
        // Cero exacto: es lo que garantiza el caso límite `xa === xb` de
        // `precisionWeightedReference`, y con la fórmula general saldría 1e-16.
        expect(excessConflict(a, b)).toBe(0);
        // Y el suelo coincide bit a bit con el K observado.
        expect(structuralFloor(a, b)).toBe(pairwiseConflict(a, b));
      }
    }
  });

  it('(ii) K_excess ∈ [0, 1] y (iii) K_excess ≤ K siempre', () => {
    for (const va of [0, 3, 12, 45, 90]) {
      for (const vb of [0, 3, 12, 45, 90]) {
        for (const [sa, sb] of [
          [1.8, 10],
          [3, 3],
          [8, 2],
        ] as const) {
          const a = B(va, sa, 0.02, 'a');
          const b = B(vb, sb, 0.02, 'b');
          const e = excessConflict(a, b);
          expect(e).toBeGreaterThanOrEqual(0);
          expect(e).toBeLessThanOrEqual(1);
          // (iii): la demostración del JSDoc, K_floor·(K−1) ≤ 0.
          expect(e).toBeLessThanOrEqual(pairwiseConflict(a, b) + 1e-12);
        }
      }
    }
  });

  it('(iii) con σ iguales y mediciones muy separadas, K_excess vuelve al K crudo', () => {
    const table = [
      { delta: 0, excess: 0.0 },
      { delta: 5, excess: 0.2705 },
      { delta: 10, excess: 0.7597 },
      { delta: 80, excess: 0.9604 },
    ];
    for (const { delta, excess } of table) {
      const a = B(10, 3, 0.02, 'a');
      const b = B(10 + delta, 3, 0.02, 'b');
      expect(excessConflict(a, b)).toBeCloseTo(excess, 4);
    }

    // El enunciado que importa: con desacuerdo grande, D1 y D0 coinciden hasta
    // el punto de decidir lo mismo, y las dos superan κ₂.
    const a = B(10, 3, 0.02, 'a');
    const b = B(90, 3, 0.02, 'b');
    expect(Math.abs(excessConflict(a, b) - pairwiseConflict(a, b))).toBeLessThan(1e-3);
    expect(excessConflict(a, b)).toBeGreaterThan(kappa2);
  });

  it('el valor de referencia x̂ pondera por precisión, no por partes iguales', () => {
    // σ = 1 pesa 100 veces más que σ = 10.
    expect(precisionWeightedReference(0, 1, 100, 10)).toBeCloseTo((0 * 1 + 100 * 0.01) / 1.01, 12);
    // Y con mediciones idénticas devuelve el valor SIN pasar por la fórmula.
    expect(precisionWeightedReference(0.1 + 0.2, 3, 0.1 + 0.2, 7)).toBe(0.1 + 0.2);
  });

  it('sin procedencia gaussiana no hay suelo, y D1 degrada EXACTAMENTE a D0', () => {
    // Una BPA escrita a mano, una ignorante y una fusionada: ninguna de las tres
    // sabe de qué medición salió.
    const handmade: BPA = {
      frame: PRECIPITATION_FRAME,
      focalElements: [
        { indices: [0], mass: 0.5 },
        { indices: [1], mass: 0.5 },
      ],
      sourceId: 'manual',
      timestamp: 0,
    };
    const ignorant = createIgnorantBPA(PRECIPITATION_FRAME, 'ignorante', 0);

    expect(structuralFloor(handmade, ignorant)).toBeNull();
    expect(structuralFloor(handmade, B(10, 3))).toBeNull();
    expect(excessConflict(handmade, B(10, 3))).toBe(pairwiseConflict(handmade, B(10, 3)));
  });

  it('el caso K_floor = 1 devuelve 0 en vez de NaN', () => {
    // Inalcanzable con BPAs de la Def. 3.4 sobre un marco que cubra el dominio,
    // y por eso la aritmética se comprueba directamente.
    expect(normalizedExcess(1, 1)).toBe(0);
    expect(normalizedExcess(0.4, 1)).toBe(0);
    expect(Number.isNaN(normalizedExcess(1, 1))).toBe(false);
    // Y el resto de la rama.
    expect(normalizedExcess(0.5, 0)).toBe(0.5);
    expect(normalizedExcess(0.2, 0.6)).toBe(0); // K por debajo del suelo → 0
    expect(normalizedExcess(0.8, 0.6)).toBeCloseTo(0.5, 12);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D2 — distancia de Jousselme
// ─────────────────────────────────────────────────────────────────────────────

describe('D2 · distancia de Jousselme', () => {
  it('d_J(m, m) = 0 exactamente, para cualquier BPA', () => {
    for (const m of [B(0, 10), B(37, 1.8), createIgnorantBPA(PRECIPITATION_FRAME, 'i', 0)]) {
      expect(jousselmeDistance(m, m)).toBe(0);
    }
  });

  it('es simétrica de forma exacta', () => {
    for (const [va, vb] of [
      [0, 0],
      [1, 40],
      [12, 12.5],
      [90, 3],
    ] as const) {
      const a = B(va, 4, 0.02, 'a');
      const b = B(vb, 9, 0.05, 'b');
      expect(jousselmeDistance(a, b)).toBe(jousselmeDistance(b, a));
    }
  });

  it('vive en [0, 1] y alcanza 1 con BPAs categóricas disjuntas', () => {
    const one: BPA = {
      frame: PRECIPITATION_FRAME,
      focalElements: [{ indices: [0], mass: 1 }],
      sourceId: 'a',
      timestamp: 0,
    };
    const other: BPA = {
      frame: PRECIPITATION_FRAME,
      focalElements: [{ indices: [4], mass: 1 }],
      sourceId: 'b',
      timestamp: 0,
    };
    // (1/2)·(1 − 2·0 + 1) = 1
    expect(jousselmeDistance(one, other)).toBe(1);
    expect(jousselmeDistance(B(0, 1), B(400, 1))).toBeLessThanOrEqual(1);
  });

  it('la matriz de Jaccard distingue solape de disyunción', () => {
    expect(jaccard([0], [0])).toBe(1);
    expect(jaccard([0], [1])).toBe(0);
    expect(jaccard([0, 1], [1, 2])).toBeCloseTo(1 / 3, 12);
    expect(jaccard([0], [0, 1, 2, 3, 4])).toBeCloseTo(1 / 5, 12);
    expect(jaccard([], [])).toBe(1);
  });

  it('no es el K: dos BPAs con K = 0 pueden distar mucho', () => {
    // m₁ apuesta por {θ₀}; m₂ no descarta nada. K = 0 —Θ interseca a todo— pero
    // las dos fuentes no dicen lo mismo, y d_J lo ve.
    const precise: BPA = {
      frame: PRECIPITATION_FRAME,
      focalElements: [{ indices: [0], mass: 1 }],
      sourceId: 'a',
      timestamp: 0,
    };
    const ignorant = createIgnorantBPA(PRECIPITATION_FRAME, 'b', 0);
    expect(pairwiseConflict(precise, ignorant)).toBe(0);
    // √(½·(1 − 2·(1/5) + 1)) = √0.8
    expect(jousselmeDistance(precise, ignorant)).toBeCloseTo(Math.sqrt(0.8), 12);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Invariantes comunes y separación estructural
// ─────────────────────────────────────────────────────────────────────────────

describe('invariantes de toda medida', () => {
  const PAIRS: [BPA, BPA][] = [];
  for (const va of [0, 4, 18, 55, 110]) {
    for (const vb of [0, 4, 18, 55, 110]) {
      PAIRS.push([B(va, 1.8, 0.02, 'a'), B(vb, 10, 0.02, 'b')]);
    }
  }

  for (const id of CONFLICT_MEASURE_IDS) {
    const m = CONFLICT_MEASURES[id];

    it(`${id}: rango [0, 1] y simetría exacta`, () => {
      for (const [a, b] of PAIRS) {
        const v = m.pair(a, b);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
        expect(m.pair(b, a)).toBeCloseTo(v, 12);
      }
    });

    it(`${id}: no depende del orden de los elementos focales`, () => {
      const shuffle = (bpa: BPA): BPA => ({
        ...bpa,
        focalElements: [...bpa.focalElements].reverse(),
      });
      for (const [a, b] of PAIRS) {
        expect(m.pair(shuffle(a), shuffle(b))).toBeCloseTo(m.pair(a, b), 12);
      }
    });
  }

  it('D0 es la identidad: measureConflict === maxConflict bit a bit', () => {
    for (const value of [0, 5, 20, 60]) {
      const a = assessConflict(agreeingHindcast(value), configFor('D0'));
      expect(a.measureConflict).toBe(a.maxConflict);
      expect(a.measureMatrix).toEqual(a.matrix);
      expect(a.floorMatrix).toBeNull();
    }
  });

  it('solo D1 publica matriz de suelos, y su diagonal es el auto-conflicto', () => {
    const bpas = agreeingHindcast(3);
    expect(assessConflict(bpas, configFor('D2')).floorMatrix).toBeNull();

    const floors = assessConflict(bpas, configFor('D1')).floorMatrix!;
    for (let i = 0; i < bpas.length; i++) {
      expect(floors[i][i]).toBeCloseTo(pairwiseConflict(bpas[i], bpas[i]), 12);
      for (let j = 0; j < bpas.length; j++) expect(floors[i][j]).toBeCloseTo(floors[j][i], 12);
    }
  });

  it('una medida desconocida LANZA en lugar de caer en silencio al default', () => {
    expect(() => measureOf({ measure: 'D9' as ConflictMeasureId })).toThrow(
      /medida de conflicto desconocida/
    );
  });
});

/**
 * REQUISITO INNEGOCIABLE (a) del experimento pre-registrado `exp:conflict-floor`,
 * en su forma más delicada: la guardia es lo ÚNICO que salva el ciclo bajo D2.
 */
describe('separación estructural · la guardia opera sobre el K_global CRUDO', () => {
  const mk = (indices: number[][], sourceId: string): BPA => ({
    frame: PRECIPITATION_FRAME,
    focalElements: indices.map((ix) => ({ indices: ix, mass: 0.5 })),
    sourceId,
    timestamp: 0,
  });
  const CYCLE = [mk([[0], [1]], 'm1'), mk([[1], [2]], 'm2'), mk([[2], [0]], 'm3')];

  for (const measure of CONFLICT_MEASURE_IDS) {
    it(`${measure}: el ciclo va a envolvente y la guardia se activa`, () => {
      const a = assessConflict(CYCLE, configFor(measure));
      expect(a.globalConflict).toBeCloseTo(1, 12);
      expect(a.globalConflict).toBeGreaterThanOrEqual(kappaDegeneracy);
      expect(a.decision.degeneracyGuard).toBe(true);
      expect(a.method).toBe('envelope');

      const r = fuse(CYCLE, [0.05, 0.05, 0.05], configFor(measure));
      expect(r.method).toBe('envelope');
      expect(r.degeneracyGuard).toBe(true);
    });
  }

  it('bajo D2 la envolvente la fuerza SOLO la guardia: d_J = 0,5 ≤ κ₂', () => {
    // Sin la separación estructural, D2 habría elegido la media cautelosa en el
    // caso que motivó toda la extensión n-aria de la entrada 2.
    const a = assessConflict(CYCLE, configFor('D2'));
    expect(a.measureConflict).toBeCloseTo(0.5, 12);
    expect(a.measureConflict).toBeLessThanOrEqual(kappa2);
    expect(a.method).toBe('envelope'); // por la guardia, no por κ₂
  });

  it('bajo D1 el ciclo no tiene suelo que descontar y coincide con D0', () => {
    // Las BPAs del ciclo no vienen de la Def. 3.4: D1 degrada a D0 y decide
    // por κ₂, igual que antes de esta iteración.
    const d0 = assessConflict(CYCLE, configFor('D0'));
    const d1 = assessConflict(CYCLE, configFor('D1'));
    expect(d1.measureConflict).toBe(d0.measureConflict);
    expect(d1.measureConflict).toBeCloseTo(0.75, 12);
    expect(d1.measureConflict).toBeGreaterThan(kappa2);
  });
});
