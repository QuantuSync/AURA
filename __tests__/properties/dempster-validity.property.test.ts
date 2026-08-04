/**
 * Propiedad B3 — Regla de Dempster: validez estructural y conmutatividad
 * papers/AURA_v2.pdf §3.4.1, Ecuaciones (5)-(6)
 *
 *   (m1 ⊕ m2)(A) = [1/(1−K)] · Σ_{B∩C=A} m1(B)·m2(C),   A ≠ ∅
 *   K = Σ_{B∩C=∅} m1(B)·m2(C)
 *
 * El resultado debe ser de nuevo una BPA en el sentido de la Definición 3.2
 * (masas ≥ 0, suma 1, m(∅) = 0). Si no lo fuera, la Proposición 3.2
 * (equivalencia envolvente-credal) no se sostendría y la Capa 2 recibiría una
 * entrada mal formada.
 *
 * Se restringe a K < 0.95 porque el propio paper desaconseja la regla por
 * encima de κ₂ = 0.7 (problema de Zadeh) y en K → 1 la normalización 1/(1−K)
 * es numéricamente inestable por construcción, no por un defecto del código.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { dempsterCombine, dempsterCombineMultiple, fuse } from '@/core/dempster-shafer/combination';
import {
  pairwiseConflict,
  conflictMatrix,
  globalConflict,
  assessConflict,
} from '@/core/dempster-shafer/conflict';
import { CONFLICT_RULE_IDS } from '@/core/dempster-shafer/conflict-rules';
import { BPA, DEFAULT_FUSION_CONFIG, FrameOfDiscernment } from '@/core/dempster-shafer/types';
import { createFrame } from '@/core/dempster-shafer/frame';
import { fcParams } from './_config';
import { multiSourceArb } from './_generators';

/** Umbral por encima del cual la normalización 1/(1−K) deja de ser fiable. */
const K_LIMIT = 0.95;

/** Masas de una BPA indexadas por su elemento focal, para comparar dos BPAs. */
function massByFocalElement(bpa: BPA): Map<string, number> {
  const map = new Map<string, number>();
  for (const fe of bpa.focalElements) {
    const key = [...fe.indices].sort((a, b) => a - b).join(',');
    map.set(key, (map.get(key) ?? 0) + fe.mass);
  }
  return map;
}

/** Pares de fuentes con conflicto por debajo del límite operativo. */
const lowConflictPair = () =>
  multiSourceArb(2, 2).filter(({ bpas }) => pairwiseConflict(bpas[0], bpas[1]) < K_LIMIT);

describe('B3 · Regla de Dempster — validez de la BPA resultante', () => {
  it('produce una BPA válida: masas ≥ 0, suma 1 ± 1e-9, sin elemento focal vacío', () => {
    fc.assert(
      fc.property(lowConflictPair(), ({ bpas }) => {
        const { combined } = dempsterCombine(bpas[0], bpas[1]);

        const total = combined.focalElements.reduce((s, fe) => s + fe.mass, 0);
        expect(total).toBeCloseTo(1, 9);

        for (const fe of combined.focalElements) {
          expect(fe.mass).toBeGreaterThanOrEqual(0);
          expect(Number.isFinite(fe.mass)).toBe(true);
          // m(∅) = 0 por construcción (Definición 3.2)
          expect(fe.indices.length).toBeGreaterThan(0);
        }
      }),
      fcParams
    );
  });

  it('el factor de conflicto K computado está en [0, 1)', () => {
    fc.assert(
      fc.property(lowConflictPair(), ({ bpas }) => {
        const { conflict } = dempsterCombine(bpas[0], bpas[1]);
        expect(conflict).toBeGreaterThanOrEqual(0);
        expect(conflict).toBeLessThan(1);
        expect(Number.isFinite(conflict)).toBe(true);
      }),
      fcParams
    );
  });

  it('el K de dempsterCombine coincide con el de pairwiseConflict (Ec. 6)', () => {
    // Dos implementaciones independientes de la misma ecuación: si divergen,
    // la matriz de conflicto que decide la estrategia de fusión (Def. 3.6)
    // estaría midiendo algo distinto de lo que normaliza Dempster.
    fc.assert(
      fc.property(lowConflictPair(), ({ bpas }) => {
        const { conflict } = dempsterCombine(bpas[0], bpas[1]);
        expect(conflict).toBeCloseTo(pairwiseConflict(bpas[0], bpas[1]), 12);
      }),
      fcParams
    );
  });

  it('todo elemento focal del resultado es subconjunto de Θ y sin duplicados', () => {
    fc.assert(
      fc.property(lowConflictPair(), ({ frame, bpas }) => {
        const { combined } = dempsterCombine(bpas[0], bpas[1]);
        const seen = new Set<string>();
        for (const fe of combined.focalElements) {
          for (const idx of fe.indices) {
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(idx).toBeLessThan(frame.hypotheses.length);
          }
          // Índices ordenados y únicos ⇒ representación canónica del subconjunto
          const key = fe.indices.join(',');
          expect(seen.has(key)).toBe(false);
          seen.add(key);
          expect([...fe.indices].sort((a, b) => a - b)).toEqual(fe.indices);
        }
      }),
      fcParams
    );
  });

  it('es conmutativa: combine(m1, m2) ≡ combine(m2, m1) sobre las masas', () => {
    fc.assert(
      fc.property(lowConflictPair(), ({ bpas }) => {
        const forward = dempsterCombine(bpas[0], bpas[1]);
        const reverse = dempsterCombine(bpas[1], bpas[0]);

        expect(forward.conflict).toBeCloseTo(reverse.conflict, 12);

        const a = massByFocalElement(forward.combined);
        const b = massByFocalElement(reverse.combined);
        expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
        for (const [key, mass] of a) {
          // La diferencia solo puede venir del orden de acumulación en coma
          // flotante, no de la estructura.
          expect(mass).toBeCloseTo(b.get(key)!, 12);
        }
      }),
      fcParams
    );
  });

  it('combinar con la BPA vacua (m(Θ)=1) deja la evidencia inalterada', () => {
    // Θ es el elemento neutro de ⊕: intersecar con Θ no descarta nada y K = 0.
    fc.assert(
      fc.property(multiSourceArb(1, 1), ({ frame, bpas }) => {
        const vacuous: BPA = {
          frame,
          focalElements: [
            { indices: Array.from({ length: frame.hypotheses.length }, (_, i) => i), mass: 1 },
          ],
          sourceId: 'vacuous',
          timestamp: 0,
        };
        const { combined, conflict } = dempsterCombine(bpas[0], vacuous);
        expect(conflict).toBeCloseTo(0, 12);

        const before = massByFocalElement(bpas[0]);
        const after = massByFocalElement(combined);
        for (const [key, mass] of before) {
          expect(after.get(key) ?? 0).toBeCloseTo(mass, 12);
        }
      }),
      fcParams
    );
  });

  it('la combinación secuencial de n fuentes produce una BPA válida, o bien lanza por conflicto total', () => {
    // Especificación COMPLETA de dempsterCombineMultiple. La precondición no
    // puede expresarse en términos del conflicto por pares (ver el test
    // siguiente), así que se enuncian los dos desenlaces admisibles.
    fc.assert(
      fc.property(multiSourceArb(2, 4), ({ bpas }) => {
        let result: ReturnType<typeof dempsterCombineMultiple>;
        try {
          result = dempsterCombineMultiple(bpas);
        } catch (e) {
          // Único fallo admisible: conflicto total en un paso intermedio.
          expect((e as Error).message).toMatch(/Total conflict/);
          return true;
        }

        const { combined, conflicts } = result;
        const total = combined.focalElements.reduce((s, fe) => s + fe.mass, 0);
        expect(total).toBeCloseTo(1, 9);
        expect(conflicts.length).toBe(bpas.length - 1);
        for (const k of conflicts) {
          expect(k).toBeGreaterThanOrEqual(0);
          expect(k).toBeLessThan(1);
        }
        for (const fe of combined.focalElements) {
          expect(fe.mass).toBeGreaterThanOrEqual(0);
          expect(fe.indices.length).toBeGreaterThan(0);
        }
        return true;
      }),
      fcParams
    );
  });

  it('fuse() nunca lanza para BPAs válidas arbitrarias', () => {
    // Robustez del punto de entrada del pipeline. Dado que el conflicto
    // secuencial no está acotado por el conflicto por pares, hay que
    // comprobar explícitamente que la estrategia escalonada de la Def. 3.6
    // desvía a media cautelosa o envolvente antes de que Dempster pueda
    // alcanzar conflicto total.
    fc.assert(
      fc.property(multiSourceArb(2, 4), ({ bpas }) => {
        const failureRates = bpas.map(() => 0.05);
        expect(() => fuse(bpas, failureRates)).not.toThrow();
      }),
      fcParams
    );
  });

  it('fuse expone los conflictos secuenciales cuando aplica Dempster', () => {
    fc.assert(
      fc.property(multiSourceArb(2, 4), ({ bpas }) => {
        const result = fuse(
          bpas,
          bpas.map(() => 0.05)
        );
        if (result.method === 'dempster') {
          expect(result.sequentialConflicts).toBeDefined();
          expect(result.sequentialConflicts!.length).toBe(bpas.length - 1);
        } else {
          expect(result.sequentialConflicts).toBeUndefined();
        }
      }),
      fcParams
    );
  });
});

describe('B3 · HALLAZGO — el conflicto secuencial NO está acotado por el conflicto por pares', () => {
  /**
   * Contraejemplo minimizado por fast-check tras 4.508 casos (semilla 20260804).
   *
   * La Definición 3.5 define el conflicto solo entre PARES y la Definición 3.6
   * elige la estrategia de fusión con K_máx = máx_{i≠j} K_ij. Pero
   * `dempsterCombineMultiple` reduce secuencialmente, y la BPA acumulada se
   * concentra: su soporte puede volverse disjunto del de una fuente que aún no
   * se ha incorporado, aunque ningún par original estuviera cerca de K = 1.
   *
   * Se fija como test de regresión: si alguien "arregla" la reducción o cambia
   * la estrategia, este caso debe seguir describiendo la realidad.
   */
  const frame: FrameOfDiscernment = createFrame({
    variable: 'X',
    unit: 'u',
    hypotheses: [
      { label: 'h0', lower: 0, upper: 10 },
      { label: 'h1', lower: 10, upper: 20 },
      { label: 'h2', lower: 20, upper: 30 },
    ],
    domainBound: 30,
  });
  const mk = (fe: { indices: number[]; mass: number }[], id: string): BPA => ({
    frame,
    focalElements: fe,
    sourceId: id,
    timestamp: 0,
  });

  // Ciclo de solapamiento parcial: cada fuente comparte una hipótesis con la
  // siguiente, pero las tres juntas no comparten ninguna.
  const m1 = mk([{ indices: [0], mass: 0.5 }, { indices: [1], mass: 0.5 }], 'm1');
  const m2 = mk([{ indices: [1], mass: 0.5 }, { indices: [2], mass: 0.5 }], 'm2');
  const m3 = mk([{ indices: [2], mass: 0.5 }, { indices: [0], mass: 0.5 }], 'm3');

  it('todos los pares tienen conflicto 0.75, muy por debajo de 1', () => {
    expect(pairwiseConflict(m1, m2)).toBeCloseTo(0.75, 12);
    expect(pairwiseConflict(m1, m3)).toBeCloseTo(0.75, 12);
    expect(pairwiseConflict(m2, m3)).toBeCloseTo(0.75, 12);
  });

  it('y sin embargo la reducción secuencial alcanza conflicto TOTAL', () => {
    // m1 ⊕ m2 concentra toda la masa en {h1}, disjunto del soporte de m3.
    const { combined } = dempsterCombine(m1, m2);
    expect(combined.focalElements).toHaveLength(1);
    expect(combined.focalElements[0].indices).toEqual([1]);
    expect(combined.focalElements[0].mass).toBeCloseTo(1, 12);

    expect(pairwiseConflict(combined, m3)).toBeCloseTo(1, 12);
    expect(() => dempsterCombineMultiple([m1, m2, m3])).toThrow(/Total conflict/);
  });

  it('el orden de las fuentes cambia el resultado: ⊕ secuencial no es asociativa aquí', () => {
    // Con conflicto total, ninguna permutación se salva — pero el hecho de que
    // el desenlace dependa del orden es en sí mismo relevante para auditar.
    for (const order of [
      [m1, m2, m3],
      [m2, m3, m1],
      [m3, m1, m2],
    ]) {
      expect(() => dempsterCombineMultiple(order)).toThrow(/Total conflict/);
    }
  });

  it('la estrategia escalonada (Def. 3.6) SÍ protege este caso: manda a envolvente', () => {
    // K_máx por pares = 0.75 > κ₂ = 0.7 ⇒ no se aplica Dempster. Esta
    // protección es real pero INDIRECTA: dependía de que el umbral pairwise
    // quedara por debajo, no de una cota sobre el conflicto secuencial. Basta
    // bajar los pares por debajo de κ₂ manteniendo el ciclo para perderla —
    // ver el test siguiente.
    const result = fuse([m1, m2, m3], [0, 0, 0]);
    expect(result.method).toBe('envelope');
    expect(result.maxConflict).toBeCloseTo(0.75, 12);
  });

  it('CIERRE — K_global = 1 detecta el ciclo directamente, sin depender del pairwise', () => {
    // Ninguna combinación (A₁,A₂,A₃) del producto conjunto tiene intersección
    // no vacía: las tres fuentes no comparten ninguna hipótesis. El conflicto
    // global es exactamente 1.
    expect(globalConflict([m1, m2, m3])).toBeCloseTo(1, 12);

    // Bajo LAS CUATRO reglas de decisión el caso acaba en envolvente, cada una
    // por su vía: C0 y C2/C3 porque su K_decision supera κ₂; C1 porque, aun
    // decidiendo con K_máx = 0,75 (que ya supera κ₂), la guardia de
    // degeneración se dispara con K_global = 1 ≥ κ_deg.
    for (const rule of CONFLICT_RULE_IDS) {
      const config = { ...DEFAULT_FUSION_CONFIG, rule };
      const assessment = assessConflict([m1, m2, m3], config);
      expect(assessment.globalConflict).toBeCloseTo(1, 12);
      expect(assessment.method).toBe('envelope');

      const result = fuse([m1, m2, m3], [0, 0, 0], config);
      expect(result.method).toBe('envelope');
      // Se resuelve por envolvente y NUNCA se toca la normalización 1/(1−K):
      // la rama Dempster no se ejecuta, luego no hay conflictos secuenciales.
      expect(result.sequentialConflicts).toBeUndefined();
      expect(result.envelope).toBeDefined();
      expect(result.degeneracyGuard).toBe(rule === 'C1' || rule === 'C3');
    }
  });

  /**
   * CIERRE — el ciclo atenuado, y qué cambió al corregir `docs/ERRATA.md` §9.
   *
   * Mismo ciclo con masa sobre Θ, calibrado para que TODOS los pares queden
   * por debajo de κ₂. Este caso es el que separa a las reglas, y su enunciado
   * CAMBIÓ con la regla seleccionada. Lo que se afirmaba antes:
   *
   *   «K_global lo ve y manda a envolvente» — cierto SOLO bajo C0.
   *
   * Lo que sigue siendo cierto bajo las cuatro reglas, y es lo que el requisito
   * innegociable exige: la rama Dempster no se alcanza, luego la normalización
   * 1/(1−K) no llega a aplicarse y no hay degeneración posible.
   *
   * Que C1/C2/C3 lo clasifiquen como Nivel 2 (media cautelosa) en vez de Nivel
   * 3 es el PRECIO declarado de la corrección, y conviene verlo escrito: un
   * conflicto n-ario real —aquí hay desacuerdo, no dispersión de
   * discretización— se resuelve promediando en vez de envolviendo. La media
   * cautelosa es una combinación convexa (Prop. 3.2), sigue siendo sound y no
   * normaliza; lo que se pierde es conservadurismo, no corrección.
   */
  it('CIERRE — el ciclo atenuado no llega nunca a Dempster, y C0 lo envuelve donde C1/C2/C3 promedian', () => {
    const theta = [0, 1, 2];
    const blend = (a: number, b: number): BPA['focalElements'] => [
      { indices: [a], mass: 0.4 },
      { indices: [b], mass: 0.4 },
      { indices: theta, mass: 0.2 },
    ];
    const n1 = mk(blend(0, 1), 'n1');
    const n2 = mk(blend(1, 2), 'n2');
    const n3 = mk(blend(2, 0), 'n3');

    const matrix = conflictMatrix([n1, n2, n3]);
    for (const [i, j] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      expect(matrix[i][j]).toBeLessThan(0.7); // por pares: conflicto "moderado"
    }

    const kGlobal = globalConflict([n1, n2, n3]);
    expect(kGlobal).toBeGreaterThan(0.7);
    expect(Math.max(matrix[0][1], matrix[0][2], matrix[1][2])).toBeLessThan(kGlobal);

    // Lo innegociable, bajo las cuatro reglas: nunca Dempster.
    for (const rule of CONFLICT_RULE_IDS) {
      const config = { ...DEFAULT_FUSION_CONFIG, rule };
      const result = fuse([n1, n2, n3], [0, 0, 0], config);
      expect(result.method).not.toBe('dempster');
      expect(result.sequentialConflicts).toBeUndefined();
    }

    // Y la diferencia entre reglas, fijada explícitamente para que un cambio
    // futuro de la regla por defecto no la deslice sin que nadie lo note.
    expect(fuse([n1, n2, n3], [0, 0, 0], { ...DEFAULT_FUSION_CONFIG, rule: 'C0' }).method).toBe(
      'envelope'
    );
    for (const rule of ['C1', 'C2', 'C3'] as const) {
      expect(fuse([n1, n2, n3], [0, 0, 0], { ...DEFAULT_FUSION_CONFIG, rule }).method).toBe(
        'cautious'
      );
    }
  });
});
