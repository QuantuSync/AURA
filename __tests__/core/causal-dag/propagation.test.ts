import { describe, it, expect } from 'vitest';
import { propagateIntervals } from '@/core/causal-dag/propagation';
import { topologicalSort, isAcyclic, validateDAG, createCausalDAG } from '@/core/causal-dag/dag';
import { CausalDAG } from '@/core/causal-dag/types';
import {
  createDemoDAG,
  DEMO_H_MODEL_ERROR_BOUND,
  DEMO_DAG_DEFAULTS,
} from '@/core/causal-dag/demo-dag';
import { add, multiply } from '@/core/intervals/arithmetic';
import { Interval } from '@/core/intervals/types';

// Simple DAG: X → Y → Z
// Y = 2 * X,  Z = Y + 1
//
// ε = 0 en ambas ecuaciones: son identidades algebraicas exactas (una
// multiplicación y una suma por constantes), no modelos de un fenómeno, que es
// el único caso en que la Definición 4.4 admite un bound nulo.
const dag: CausalDAG = createCausalDAG({
  nodes: [
    { id: 'X', label: 'Input', unit: 'mm/h' },
    { id: 'Y', label: 'Intermediate', unit: 'mm/h' },
    { id: 'Z', label: 'Output', unit: 'mm/h' },
  ],
  edges: [
    { from: 'X', to: 'Y', weight: { lower: 2, upper: 2 } },
    { from: 'Y', to: 'Z', weight: { lower: 1, upper: 1 } },
  ],
  equations: [
    {
      nodeId: 'Y',
      compute: (parents) => multiply(parents.get('X')!, { lower: 2, upper: 2 }),
      modelErrorBound: 0,
    },
    {
      nodeId: 'Z',
      compute: (parents) => add(parents.get('Y')!, { lower: 1, upper: 1 }),
      modelErrorBound: 0,
    },
  ],
});

describe('Causal DAG', () => {
  it('isAcyclic returns true for valid DAG', () => {
    expect(isAcyclic(dag)).toBe(true);
  });

  it('topological sort puts parents before children', () => {
    const order = topologicalSort(dag);
    expect(order.indexOf('X')).toBeLessThan(order.indexOf('Y'));
    expect(order.indexOf('Y')).toBeLessThan(order.indexOf('Z'));
  });

  it('propagates intervals correctly through DAG', () => {
    const inputs = new Map<string, Interval>([['X', { lower: 3, upper: 5 }]]);
    const result = propagateIntervals(dag, inputs);

    // Y = 2 * [3,5] = [6,10]
    expect(result.get('Y')!.lower).toBeCloseTo(6);
    expect(result.get('Y')!.upper).toBeCloseTo(10);

    // Z = [6,10] + 1 = [7,11]
    expect(result.get('Z')!.lower).toBeCloseTo(7);
    expect(result.get('Z')!.upper).toBeCloseTo(11);
  });

  it('soundness: true values always within propagated intervals', () => {
    const inputs = new Map<string, Interval>([['X', { lower: 3, upper: 5 }]]);
    const result = propagateIntervals(dag, inputs);

    // For x = 4 (midpoint): Y = 8, Z = 9
    const yInterval = result.get('Y')!;
    const zInterval = result.get('Z')!;
    expect(8).toBeGreaterThanOrEqual(yInterval.lower);
    expect(8).toBeLessThanOrEqual(yInterval.upper);
    expect(9).toBeGreaterThanOrEqual(zInterval.lower);
    expect(9).toBeLessThanOrEqual(zInterval.upper);
  });
});

describe('Bound de error de modelo ε_i — Definición 4.3, Ecuación (24)', () => {
  const withEps = (epsY: number, epsZ: number): CausalDAG => ({
    ...dag,
    equations: [
      { ...dag.equations[0], modelErrorBound: epsY },
      { ...dag.equations[1], modelErrorBound: epsZ },
    ],
  });

  it('la propagación aplica ⊕[−ε_i, ε_i] automáticamente tras evaluar f_i', () => {
    const inputs = new Map<string, Interval>([['X', { lower: 3, upper: 5 }]]);
    const result = propagateIntervals(withEps(0.5, 0.25), inputs);

    // Y = 2·[3,5] ⊕ [−0.5, 0.5] = [5.5, 10.5]
    expect(result.get('Y')!.lower).toBeCloseTo(5.5, 12);
    expect(result.get('Y')!.upper).toBeCloseTo(10.5, 12);

    // Z = ([5.5,10.5] + 1) ⊕ [−0.25, 0.25] = [6.25, 11.75]
    // El ε del padre se ARRASTRA: es lo que hace inductiva la demostración
    // del Teorema 4.1.
    expect(result.get('Z')!.lower).toBeCloseTo(6.25, 12);
    expect(result.get('Z')!.upper).toBeCloseTo(11.75, 12);
  });

  it('ε_i > 0 solo puede ensanchar: el intervalo con ε contiene al de ε = 0', () => {
    const inputs = new Map<string, Interval>([['X', { lower: 3, upper: 5 }]]);
    const tight = propagateIntervals(withEps(0, 0), inputs);
    const loose = propagateIntervals(withEps(1.5, 0.75), inputs);

    for (const id of ['Y', 'Z']) {
      expect(loose.get(id)!.lower).toBeLessThanOrEqual(tight.get(id)!.lower);
      expect(loose.get(id)!.upper).toBeGreaterThanOrEqual(tight.get(id)!.upper);
    }
  });

  it('ε_i < 0 lanza en construcción del DAG', () => {
    expect(() => createCausalDAG(withEps(-1e-9, 0))).toThrow(/must be ≥ 0/);
    expect(() => validateDAG(withEps(0, -3))).toThrow(/must be ≥ 0/);
  });

  it('ε_i no finito lanza en construcción del DAG', () => {
    expect(() => validateDAG(withEps(Number.NaN, 0))).toThrow(/finite/);
    expect(() => validateDAG(withEps(0, Number.POSITIVE_INFINITY))).toThrow(/finite/);
  });

  it('propagateIntervals valida aunque el DAG no se haya construido con createCausalDAG', () => {
    // La garantía no depende de usar el constructor: el punto de entrada valida.
    const inputs = new Map<string, Interval>([['X', { lower: 3, upper: 5 }]]);
    expect(() => propagateIntervals(withEps(-0.1, 0), inputs)).toThrow(/must be ≥ 0/);
  });

  it('validateDAG rechaza ciclos, referencias colgantes y ecuaciones duplicadas', () => {
    expect(() =>
      validateDAG({
        ...dag,
        edges: [...dag.edges, { from: 'Z', to: 'X', weight: { lower: 1, upper: 1 } }],
      })
    ).toThrow(/acyclic/);

    expect(() =>
      validateDAG({ ...dag, equations: [{ ...dag.equations[0], nodeId: 'W' }] })
    ).toThrow(/unknown node/);

    expect(() =>
      validateDAG({ ...dag, equations: [dag.equations[0], dag.equations[0]] })
    ).toThrow(/Duplicate structural equation/);
  });
});

describe('DAG de la demo — Ecuación (34), §7.3', () => {
  it('declara un ε > 0 para h(t) y lo aplica al propagar', () => {
    const demo = createDemoDAG();
    expect(demo.equations[0].modelErrorBound).toBe(DEMO_H_MODEL_ERROR_BOUND);
    expect(DEMO_H_MODEL_ERROR_BOUND).toBeGreaterThan(0);

    // P ∈ [10, 20] mm/h, h₀ = 0, D = 5 mm/h, t ∈ [0, 2] h
    //   f_h = 0 + ([10,20] − [5,5])·[0,2] = [5,15]·[0,2] = [0, 30]
    //   ⊕[−2, 2] ⇒ [−2, 32]
    const result = propagateIntervals(
      demo,
      new Map<string, Interval>([['P', { lower: 10, upper: 20 }]])
    );
    expect(result.get('h')!.lower).toBeCloseTo(-DEMO_H_MODEL_ERROR_BOUND, 12);
    expect(result.get('h')!.upper).toBeCloseTo(30 + DEMO_H_MODEL_ERROR_BOUND, 12);
  });

  it('el ε es configurable sin tocar la ecuación', () => {
    const demo = createDemoDAG({ modelErrorBound: 7.5 });
    expect(demo.equations[0].modelErrorBound).toBe(7.5);

    const result = propagateIntervals(
      demo,
      new Map<string, Interval>([['P', { lower: 10, upper: 20 }]])
    );
    expect(result.get('h')!.upper).toBeCloseTo(37.5, 12);
  });

  it('rechaza un ε negativo en la construcción de la demo', () => {
    expect(() => createDemoDAG({ modelErrorBound: -1 })).toThrow(/must be ≥ 0/);
  });

  it('los defaults documentados son los del §7.3-§7.4 del paper', () => {
    expect(DEMO_DAG_DEFAULTS.horizon).toEqual({ lower: 0, upper: 2 }); // 120 min
    expect(DEMO_DAG_DEFAULTS.modelErrorBound).toBe(DEMO_H_MODEL_ERROR_BOUND);
  });
});
