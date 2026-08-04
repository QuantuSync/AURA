/**
 * Propiedad B10 — Cobertura del certificado probabilístico
 * EXTENSIÓN al paper, ver docs/ERRATA.md §8 (candidata a Def. 5.5′ en la v3)
 *
 * ENUNCIADO QUE SE VERIFICA:
 *
 *   Sea E el evento inseguro sobre la variable objetivo y {(m(A), J_A)} el
 *   conjunto credal propagado por el DAG. Entonces
 *
 *       Bel(E) = Σ_{J_A ⊆ E} m(A)  ≤  P(v* ∈ E)  ≤  Σ_{J_A ∩ E ≠ ∅} m(A) = Pl(E)
 *
 *   para TODA distribución compatible con la BPA fusionada y TODO mundo real
 *   con |u_i| ≤ ε_i.
 *
 * La demostración está en el JSDoc de `probabilityBounds`. Aquí se ejecuta:
 * BPAs aleatorias sobre marcos aleatorios, DAGs pequeños aleatorios con sus
 * ε_i, regiones inseguras aleatorias, y el mundo real muestreado.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ HAY DOS ESTIMADORES DE LA FRECUENCIA EMPÍRICA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * (I) ESTIMADOR EXACTO EN LA RAMA (el que se comprueba SIN holgura). El mundo
 *     real se muestrea de verdad —el punto dentro del intervalo focal y los
 *     ruidos u_i—, pero la rama A se pondera por su masa m(A) en lugar de
 *     sortearse:
 *
 *         P̂ = Σ_A m(A) · (1/M) Σ_j 1[ y(p_A, u^(j)) ∈ E ]
 *
 *     Es una reducción de varianza estándar (estratificación por rama con
 *     probabilidades conocidas), no una trampa: la aleatoriedad que la
 *     propiedad pone a prueba está en p_A y en u, no en el sorteo de A. A
 *     cambio, P̂ ∈ [Bel(E), Pl(E)] es EXACTO, sin margen estadístico: cada rama
 *     con J_A ∩ E = ∅ aporta 0 con certeza y cada rama con J_A ⊆ E aporta
 *     m(A) con certeza.
 *
 * (II) MONTE CARLO PURO (con holgura de Hoeffding). N mundos i.i.d. con la rama
 *     sorteada ~ m. Es la lectura literal de "frecuencia empírica", y por eso
 *     se comprueba también; pero f̂ es un ESTIMADOR de P(E), no P(E), de modo
 *     que f̂ puede caer fuera de [Bel, Pl] por fluctuación muestral aunque el
 *     bound sea correcto. Exigirlo sin holgura sería un test intermitente que
 *     mide el generador de números aleatorios, no la soundness. La holgura es
 *     la cota de Hoeffding: P(|f̂ − p| ≥ t) ≤ 2·exp(−2Nt²); con N = 500 y
 *     t = 0,13 da 8,3e-8, luego menos de 2e-3 fallos esperados en una campaña
 *     de 20.000 casos.
 *
 * El estimador (I) es la evidencia fuerte; el (II) comprueba que no hay un
 * sesgo groseramente mal orientado en la construcción de (I).
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { fuse } from '@/core/dempster-shafer/combination';
import { toCredalIntervalSet, hullOf, totalMass } from '@/core/credal-propagation/credal-interval-set';
import {
  credalSetAtNode,
  propagateCredalThroughDAG,
} from '@/core/credal-propagation/propagation';
import {
  probabilityBounds,
  unsafeProbabilityBounds,
} from '@/core/credal-propagation/probability-bounds';
import { CredalIntervalSet, MASS_SUM_TOLERANCE } from '@/core/credal-propagation/types';
import { certifySafety } from '@/core/decision/synthesis';
import { SafetySpec } from '@/core/decision/types';
import { CausalDAG, StructuralEquation } from '@/core/causal-dag/types';
import { add, multiply, subtract } from '@/core/intervals/arithmetic';
import { Interval } from '@/core/intervals/types';
import { containedWithin, fcParams, makeRng, realArb, unitArb } from './_config';
import { multiSourceArb } from './_generators';

// ─────────────────────────────────────────────────────────────────────────
// Generador de DAGs pequeños con UN ÚNICO nodo raíz
// ─────────────────────────────────────────────────────────────────────────
//
// A diferencia del de `dag-propagation.property.test.ts`, aquí el DAG tiene una
// sola entrada: es por donde entra el conjunto credal de la Capa 1.
//
// Cada operación se declara DOS VECES —extensión intervalar (Def. 4.2) y
// evaluación real sobre ℝ— con exactamente la misma secuencia de operaciones de
// coma flotante, de modo que sobre intervalos degenerados ambas coinciden bit a
// bit. Sin eso, la comparación entre el mundo muestreado y el intervalo
// propagado mediría redondeo en vez de soundness.

type OpKind = 'affine' | 'sum' | 'diff' | 'square';

interface NodeSpec {
  parents: number[];
  op: OpKind;
  k: number;
  c: number;
  eps: number;
}

interface DagSpec {
  nodes: NodeSpec[]; // índice 0 = raíz (sin padres, sin ecuación)
  n: number;
  target: number;
}

const nodeId = (i: number) => `v${i}`;

function evalInterval(spec: NodeSpec, args: Interval[]): Interval {
  switch (spec.op) {
    case 'affine':
      return add(multiply(args[0], { lower: spec.k, upper: spec.k }), { lower: spec.c, upper: spec.c });
    case 'sum':
      return add(args[0], args[1]);
    case 'diff':
      // Con padres que descienden del mismo nodo raíz, esta resta introduce
      // sobre-aproximación (dependency problem): justo el caso que pone a
      // prueba la dirección conservadora de los bounds.
      return subtract(args[0], args[1]);
    case 'square':
      return multiply(args[0], args[0]);
  }
}

function evalReal(spec: NodeSpec, args: number[]): number {
  switch (spec.op) {
    case 'affine':
      // multiply/add sobre degenerados dan exactamente estos productos y sumas.
      return args[0] * spec.k + spec.c;
    case 'sum':
      return args[0] + args[1];
    case 'diff':
      return args[0] - args[1];
    case 'square':
      return args[0] * args[0];
  }
}

function buildDAG(spec: DagSpec): CausalDAG {
  const equations: StructuralEquation[] = [];
  const edges: CausalDAG['edges'] = [];

  for (let i = 1; i < spec.n; i++) {
    const node = spec.nodes[i];
    for (const p of node.parents) {
      edges.push({ from: nodeId(p), to: nodeId(i), weight: { lower: 1, upper: 1 } });
    }
    const parentIds = node.parents.map(nodeId);
    equations.push({
      nodeId: nodeId(i),
      compute: (pv) => evalInterval(node, parentIds.map((id) => pv.get(id)!)),
      modelErrorBound: node.eps,
    });
  }

  return {
    nodes: Array.from({ length: spec.n }, (_, i) => ({ id: nodeId(i), label: `V${i}`, unit: 'u' })),
    edges,
    equations,
  };
}

/** Mundo real: v*_0 = x, v*_i = f_i(padres) + u_i con |u_i| ≤ ε_i. */
function evalWorld(spec: DagSpec, x: number, uFactors: number[]): number[] {
  const values = new Array<number>(spec.n).fill(Number.NaN);
  values[0] = x;
  for (let i = 1; i < spec.n; i++) {
    const node = spec.nodes[i];
    const args = node.parents.map((p) => values[p]);
    values[i] = evalReal(node, args) + uFactors[i % uFactors.length] * node.eps;
  }
  return values;
}

const dagSpecArb = (): fc.Arbitrary<DagSpec> =>
  fc.integer({ min: 2, max: 4 }).chain((n) =>
    fc
      .array(
        fc.tuple(
          fc.constantFrom<OpKind>('affine', 'sum', 'diff', 'square'),
          realArb(-3, 3),
          realArb(-20, 20),
          fc.double({ min: 0, max: 5, noNaN: true, noDefaultInfinity: true }),
          unitArb(),
          unitArb()
        ),
        { minLength: n, maxLength: n }
      )
      .map((configs) => {
        const nodes: NodeSpec[] = [{ parents: [], op: 'affine', k: 1, c: 0, eps: 0 }];
        for (let i = 1; i < n; i++) {
          const [op, k, c, eps, s1, s2] = configs[i];
          const available = Array.from({ length: i }, (_, j) => j);
          const binary = op === 'sum' || op === 'diff';
          const first = available[Math.floor(s1 * available.length) % available.length];
          const parents = [first];
          if (binary) {
            // Segundo padre: cualquiera de los anteriores, INCLUIDO el primero
            // (v − v da un intervalo no degenerado: es el dependency problem
            // en su forma más pura).
            parents.push(available[Math.floor(s2 * available.length) % available.length]);
          }
          nodes.push({ parents, op: binary ? op : op, k, c, eps });
        }
        return { nodes, n, target: n - 1 };
      })
  );

// ─────────────────────────────────────────────────────────────────────────
// Escenario completo: Capa 1 (BPAs) + Capa 2 (DAG) + región insegura
// ─────────────────────────────────────────────────────────────────────────

interface Scenario {
  input: CredalIntervalSet;
  spec: DagSpec;
  dag: CausalDAG;
  propagated: CredalIntervalSet;
  /** Fracciones que sitúan el punto real dentro de cada intervalo focal. */
  pointFractions: number[];
  /** Fracciones que dan u_i = s_i·ε_i. */
  uFactors: number[];
  /** Fracciones que definen la región insegura relativa al hull propagado. */
  regionFractions: [number, number];
  seed: number;
}

const scenarioArb = (): fc.Arbitrary<Scenario | null> =>
  fc
    .tuple(
      multiSourceArb(2, 4),
      dagSpecArb(),
      fc.array(unitArb(), { minLength: 8, maxLength: 8 }),
      fc.array(fc.double({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true }), {
        minLength: 6,
        maxLength: 6,
      }),
      // Rango ampliado a [−0,2 , 1,2] del hull: la región insegura cae a veces
      // fuera del alcanzable (bounds nulos) y a veces lo cubre entero.
      fc.tuple(
        fc.double({ min: -0.2, max: 1.2, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: -0.2, max: 1.2, noNaN: true, noDefaultInfinity: true })
      ),
      fc.integer({ min: 1, max: 2 ** 30 })
    )
    .map(([{ bpas }, spec, pointFractions, uFactors, regionFractions, seed]) => {
      const input = toCredalIntervalSet(fuse(bpas, bpas.map(() => 0.05)));
      const dag = buildDAG(spec);
      const propagated = credalSetAtNode(
        propagateCredalThroughDAG(input, dag, nodeId(0)),
        nodeId(spec.target)
      );
      // Descarta desbordamientos numéricos: no son contraejemplos de nada.
      const finite = propagated.elements.every(
        (e) => Number.isFinite(e.interval.lower) && Number.isFinite(e.interval.upper)
      );
      if (!finite) return null;
      return { input, spec, dag, propagated, pointFractions, uFactors, regionFractions, seed };
    });

/** Región insegura derivada del hull propagado, para que no sea trivial. */
function unsafeRegionOf(s: Scenario): Interval {
  const hull = hullOf(s.propagated);
  const width = hull.upper - hull.lower || 1;
  const a = hull.lower + s.regionFractions[0] * width;
  const b = hull.lower + s.regionFractions[1] * width;
  return { lower: Math.min(a, b), upper: Math.max(a, b) };
}

/** Punto real asignado al elemento focal `a`: p_a ∈ I_a. */
function pointOf(s: Scenario, a: number): number {
  const iv = s.input.elements[a].interval;
  const t = s.pointFractions[a % s.pointFractions.length];
  const x = iv.lower + t * (iv.upper - iv.lower);
  return Math.min(iv.upper, Math.max(iv.lower, x));
}

const inRegion = (y: number, region: Interval): boolean =>
  y >= region.lower && y <= region.upper;

// ─────────────────────────────────────────────────────────────────────────
// (a) COBERTURA CREDAL END-TO-END — la propiedad central
// ─────────────────────────────────────────────────────────────────────────

describe('B10 · cobertura credal end-to-end: la probabilidad real cae en [Bel(E), Pl(E)]', () => {
  it('(I) estimador exacto en la rama: P̂ ∈ [belLower, plUpper] sin holgura, ≥ 500 muestras', () => {
    fc.assert(
      fc.property(scenarioArb(), (s) => {
        if (s === null) return true;

        const region = unsafeRegionOf(s);
        const bounds = probabilityBounds(s.propagated, region);
        const F = s.input.elements.length;
        const M = Math.max(20, Math.ceil(500 / F)); // ≥ 500 muestras por caso
        const rng = makeRng(s.seed);

        let pHat = 0;
        for (let a = 0; a < F; a++) {
          const x = pointOf(s, a);
          const jA = s.propagated.elements[a].interval;
          let hits = 0;

          for (let j = 0; j < M; j++) {
            // Ruidos del mundo real, cada uno dentro de su bound: |u_i| ≤ ε_i.
            const uFactors = s.spec.nodes.map((_, i) =>
              i === 0 ? 0 : 2 * rng() - 1
            );
            const world = evalWorld(s.spec, x, uFactors);
            const y = world[s.spec.target];
            if (!Number.isFinite(y)) return true; // overflow: caso descartado

            // Teorema 4.1 dentro de la ruta credal: el valor real de la rama A
            // está en J_A. Es la premisa (2) de la demostración de los bounds.
            expect(
              containedWithin(y, jA.lower, jA.upper),
              `y = ${y} ∉ J_A = [${jA.lower}, ${jA.upper}]`
            ).toBe(true);

            if (inRegion(y, region)) hits++;
          }
          pHat += s.input.elements[a].mass * (hits / M);
        }

        expect(pHat).toBeGreaterThanOrEqual(bounds.belLower - 1e-12);
        expect(pHat).toBeLessThanOrEqual(bounds.plUpper + 1e-12);
        return true;
      }),
      fcParams
    );
  });

  it('(II) Monte Carlo puro: f̂ ∈ [belLower, plUpper] ± holgura de Hoeffding (N = 500)', () => {
    const N = 500;
    // P(|f̂ − p| ≥ t) ≤ 2·exp(−2·N·t²) = 8,3e-8 con t = 0,13 y N = 500.
    const SLACK = 0.13;

    fc.assert(
      fc.property(scenarioArb(), (s) => {
        if (s === null) return true;

        const region = unsafeRegionOf(s);
        const bounds = probabilityBounds(s.propagated, region);
        const rng = makeRng(s.seed ^ 0x5f3759df);

        // Distribución acumulada de las masas, para sortear la rama ~ m(A).
        const cum: number[] = [];
        let acc = 0;
        for (const fe of s.input.elements) {
          acc += fe.mass;
          cum.push(acc);
        }

        let hits = 0;
        for (let j = 0; j < N; j++) {
          const r = rng() * acc;
          let a = cum.findIndex((c) => r <= c);
          if (a < 0) a = cum.length - 1;

          const x = pointOf(s, a);
          const uFactors = s.spec.nodes.map((_, i) => (i === 0 ? 0 : 2 * rng() - 1));
          const y = evalWorld(s.spec, x, uFactors)[s.spec.target];
          if (!Number.isFinite(y)) return true;
          if (inRegion(y, region)) hits++;
        }

        const fHat = hits / N;
        expect(fHat).toBeGreaterThanOrEqual(bounds.belLower - SLACK);
        expect(fHat).toBeLessThanOrEqual(bounds.plUpper + SLACK);
        return true;
      }),
      fcParams
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// (b) INVARIANTES DE LOS BOUNDS
// ─────────────────────────────────────────────────────────────────────────

describe('B10 · invariantes de [Bel(E), Pl(E)]', () => {
  it('0 ≤ belLower ≤ plUpper ≤ 1, siempre', () => {
    fc.assert(
      fc.property(scenarioArb(), (s) => {
        if (s === null) return true;
        for (const b of [
          probabilityBounds(s.propagated, unsafeRegionOf(s)),
          unsafeProbabilityBounds(s.propagated, unsafeRegionOf(s)),
        ]) {
          expect(b.belLower).toBeGreaterThanOrEqual(0);
          expect(b.plUpper).toBeLessThanOrEqual(1);
          expect(b.belLower).toBeLessThanOrEqual(b.plUpper);
          expect(Number.isNaN(b.belLower)).toBe(false);
          expect(Number.isNaN(b.plUpper)).toBe(false);
        }
        return true;
      }),
      fcParams
    );
  });

  it('la propagación preserva la masa total elemento a elemento', () => {
    fc.assert(
      fc.property(scenarioArb(), (s) => {
        if (s === null) return true;
        expect(s.propagated.elements).toHaveLength(s.input.elements.length);
        s.input.elements.forEach((fe, i) => {
          expect(s.propagated.elements[i].mass).toBe(fe.mass);
        });
        expect(totalMass(s.propagated)).toBe(totalMass(s.input));
        expect(Math.abs(totalMass(s.propagated) - 1)).toBeLessThanOrEqual(MASS_SUM_TOLERANCE);
        return true;
      }),
      fcParams
    );
  });

  it('un evento que cubre el hull da Bel = Pl = 1; uno disjunto, Bel = Pl = 0', () => {
    fc.assert(
      fc.property(scenarioArb(), (s) => {
        if (s === null) return true;
        const hull = hullOf(s.propagated);

        const all = probabilityBounds(s.propagated, hull);
        expect(all.belLower).toBeCloseTo(1, 9);
        expect(all.plUpper).toBeCloseTo(1, 9);

        const width = Math.max(1, hull.upper - hull.lower);
        const none = probabilityBounds(s.propagated, {
          lower: hull.upper + width,
          upper: hull.upper + 2 * width,
        });
        expect(none.belLower).toBe(0);
        expect(none.plUpper).toBe(0);
        return true;
      }),
      fcParams
    );
  });

  it('monotonía: ensanchar la región solo puede subir ambos bounds', () => {
    fc.assert(
      fc.property(scenarioArb(), unitArb(), (s, grow) => {
        if (s === null) return true;
        const region = unsafeRegionOf(s);
        const pad = grow * Math.max(1, region.upper - region.lower);
        const wider = { lower: region.lower - pad, upper: region.upper + pad };

        const a = probabilityBounds(s.propagated, region);
        const b = probabilityBounds(s.propagated, wider);
        expect(b.belLower).toBeGreaterThanOrEqual(a.belLower - 1e-12);
        expect(b.plUpper).toBeGreaterThanOrEqual(a.plUpper - 1e-12);
        return true;
      }),
      fcParams
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// (c) CONSISTENCIA CON EL NIVEL EXISTENCIAL (Def. 5.5)
// ─────────────────────────────────────────────────────────────────────────

describe('B10 · los dos niveles del certificado no pueden contradecirse', () => {
  const specOf = (safeRegion: Interval): SafetySpec => ({
    variable: 'v',
    safeRegion,
    riskThreshold: 0.5,
  });

  /** Región segura derivada del hull, para cubrir ambos veredictos. */
  const safeRegionOf = (s: Scenario): Interval => {
    const hull = hullOf(s.propagated);
    const width = hull.upper - hull.lower || 1;
    const a = hull.lower + s.regionFractions[0] * width;
    const b = hull.lower + s.regionFractions[1] * width;
    return { lower: Math.min(a, b), upper: Math.max(a, b) };
  };

  it('plUpper > 0 ⇒ el veredicto existencial es unsafe-possible', () => {
    fc.assert(
      fc.property(scenarioArb(), (s) => {
        if (s === null) return true;
        const spec = specOf(safeRegionOf(s));
        const bounds = unsafeProbabilityBounds(s.propagated, spec.safeRegion);
        if (bounds.plUpper <= 0) return true;

        const cert = certifySafety(hullOf(s.propagated), spec, [], bounds);
        expect(cert.status).toBe('unsafe-possible');
        return true;
      }),
      fcParams
    );
  });

  it('proven-safe ⇒ plUpper = 0 (y certifySafety lo exige, no lo supone)', () => {
    fc.assert(
      fc.property(scenarioArb(), (s) => {
        if (s === null) return true;
        const spec = specOf(safeRegionOf(s));
        const bounds = unsafeProbabilityBounds(s.propagated, spec.safeRegion);
        // No lanza ⟺ los dos niveles son coherentes; es la comprobación interna
        // de `assertCoherentProbabilityBounds`, ejercida sobre casos generados.
        const cert = certifySafety(hullOf(s.propagated), spec, [], bounds);
        if (cert.status === 'proven-safe') {
          expect(bounds.plUpper).toBe(0);
          expect(bounds.belLower).toBe(0);
        }
        return true;
      }),
      fcParams
    );
  });

  it('belLower = 1 ⇒ unsafe-possible y el hull no toca la región segura', () => {
    fc.assert(
      fc.property(scenarioArb(), (s) => {
        if (s === null) return true;
        const spec = specOf(safeRegionOf(s));
        const bounds = unsafeProbabilityBounds(s.propagated, spec.safeRegion);
        if (bounds.belLower < 1 - 1e-9) return true;

        const cert = certifySafety(hullOf(s.propagated), spec, [], bounds);
        expect(cert.status).toBe('unsafe-possible');
        expect(cert.witness.length).toBeGreaterThan(0);
        return true;
      }),
      fcParams
    );
  });

  it('el hull credal propagado nunca excede propagar el hull de entrada', () => {
    // Monotonía de la inclusión: la ruta credal no puede producir un reachable
    // set MAYOR que la ruta clásica de la Ec. (10). Si lo hiciera, el nivel
    // existencial se degradaría al añadir el probabilístico.
    fc.assert(
      fc.property(scenarioArb(), (s) => {
        if (s === null) return true;
        const credal = hullOf(s.propagated);
        const classic = credalSetAtNode(
          propagateCredalThroughDAG(
            { ...s.input, elements: [{ mass: 1, interval: hullOf(s.input) }] },
            s.dag,
            nodeId(0)
          ),
          nodeId(s.spec.target)
        ).elements[0].interval;
        if (!Number.isFinite(classic.lower) || !Number.isFinite(classic.upper)) return true;

        expect(credal.lower).toBeGreaterThanOrEqual(classic.lower - 1e-9);
        expect(credal.upper).toBeLessThanOrEqual(classic.upper + 1e-9);
        return true;
      }),
      fcParams
    );
  });
});
