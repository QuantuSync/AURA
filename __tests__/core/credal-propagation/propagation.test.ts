import { describe, it, expect } from 'vitest';
import {
  credalSetAtNode,
  propagateCredalThroughDAG,
} from '@/core/credal-propagation/propagation';
import {
  createCredalIntervalSet,
  frameRefOf,
  hullOf,
  totalMass,
} from '@/core/credal-propagation/credal-interval-set';
import { createFrame } from '@/core/dempster-shafer/frame';
import { createCausalDAG } from '@/core/causal-dag/dag';
import { propagateIntervals } from '@/core/causal-dag/propagation';
import { createDemoDAG } from '@/core/causal-dag/demo-dag';
import { CausalDAG } from '@/core/causal-dag/types';
import { add, multiply } from '@/core/intervals/arithmetic';

const frame = createFrame({
  variable: 'X',
  unit: 'u',
  hypotheses: [
    { label: 'a', lower: 0, upper: 10 },
    { label: 'b', lower: 10, upper: 20 },
    { label: 'cola', lower: 20, upper: 100 },
  ],
  domainBound: 100,
});
const ref = frameRefOf(frame);

/** DAG lineal Y = 2·X + 1 con ε_Y = 0,5. */
const linearDAG = (eps = 0.5): CausalDAG =>
  createCausalDAG({
    nodes: [
      { id: 'X', label: 'entrada', unit: 'u' },
      { id: 'Y', label: 'salida', unit: 'u' },
    ],
    edges: [{ from: 'X', to: 'Y', weight: { lower: 2, upper: 2 } }],
    equations: [
      {
        nodeId: 'Y',
        compute: (p) => add(multiply(p.get('X')!, { lower: 2, upper: 2 }), { lower: 1, upper: 1 }),
        modelErrorBound: eps,
      },
    ],
  });

const twoElementSet = () =>
  createCredalIntervalSet(
    [
      { mass: 0.8, interval: { lower: 0, upper: 10 } },
      { mass: 0.2, interval: { lower: 20, upper: 100 } },
    ],
    ref
  );

describe('propagateCredalThroughDAG', () => {
  it('propaga cada elemento focal con la Ec. (24) y conserva su masa', () => {
    const out = propagateCredalThroughDAG(twoElementSet(), linearDAG(), 'X');
    const y = credalSetAtNode(out, 'Y');

    // f([0,10]) = [1, 21], ⊕ [−0.5, 0.5] → [0.5, 21.5]
    // f([20,100]) = [41, 201], ⊕ [−0.5, 0.5] → [40.5, 201.5]
    expect(y.elements).toEqual([
      { mass: 0.8, interval: { lower: 0.5, upper: 21.5 } },
      { mass: 0.2, interval: { lower: 40.5, upper: 201.5 } },
    ]);
  });

  it('la masa total se preserva exactamente', () => {
    const set = twoElementSet();
    const y = credalSetAtNode(propagateCredalThroughDAG(set, linearDAG(), 'X'), 'Y');
    expect(totalMass(y)).toBe(totalMass(set));
  });

  it('el nodo de entrada conserva el conjunto de entrada intacto', () => {
    const set = twoElementSet();
    const x = credalSetAtNode(propagateCredalThroughDAG(set, linearDAG(), 'X'), 'X');
    expect(x.elements).toEqual(set.elements);
  });

  it('cada elemento propagado coincide con propagateIntervals sobre su intervalo', () => {
    const set = twoElementSet();
    const dag = linearDAG(1.25);
    const y = credalSetAtNode(propagateCredalThroughDAG(set, dag, 'X'), 'Y');

    set.elements.forEach((fe, i) => {
      const solo = propagateIntervals(dag, new Map([['X', fe.interval]])).get('Y')!;
      expect(y.elements[i].interval).toEqual(solo);
    });
  });

  it('arrastra el frameRef (H0) y etiqueta el nodo', () => {
    const y = credalSetAtNode(propagateCredalThroughDAG(twoElementSet(), linearDAG(), 'X'), 'Y');
    expect(y.frameRef).toEqual(ref);
    expect(y.nodeId).toBe('Y');
  });

  it('devuelve un conjunto por nodo del DAG', () => {
    const out = propagateCredalThroughDAG(twoElementSet(), linearDAG(), 'X');
    expect([...out.keys()].sort()).toEqual(['X', 'Y']);
  });

  it('el hull propagado nunca es más ancho que propagar el hull de entrada', () => {
    // Monotonía de la inclusión: ⋃ f(I_A) ⊆ f(⋃ I_A). La ruta credal puede
    // ganar precisión en el reachable set, nunca perderla.
    const set = twoElementSet();
    const dag = linearDAG();
    const credalHull = hullOf(credalSetAtNode(propagateCredalThroughDAG(set, dag, 'X'), 'Y'));
    const classic = propagateIntervals(dag, new Map([['X', hullOf(set)]])).get('Y')!;

    expect(credalHull.lower).toBeGreaterThanOrEqual(classic.lower);
    expect(credalHull.upper).toBeLessThanOrEqual(classic.upper);
  });

  it('LANZA si el nodo de entrada no existe', () => {
    expect(() => propagateCredalThroughDAG(twoElementSet(), linearDAG(), 'Z')).toThrow(
      /no tiene ningún nodo 'Z'/
    );
  });

  it('LANZA al exceder maxFocalElements en vez de degradar a un intervalo', () => {
    const n = 4;
    const set = createCredalIntervalSet(
      Array.from({ length: n }, () => ({ mass: 1 / n, interval: { lower: 0, upper: 1 } })),
      ref
    );
    expect(() =>
      propagateCredalThroughDAG(set, linearDAG(), 'X', { maxFocalElements: 3 })
    ).toThrow(/exceden maxFocalElements/);
  });

  it('LANZA si el DAG es inválido (ε negativo)', () => {
    const bad: CausalDAG = {
      ...linearDAG(),
      equations: [{ ...linearDAG().equations[0], modelErrorBound: -1 }],
    };
    expect(() => propagateCredalThroughDAG(twoElementSet(), bad, 'X')).toThrow(/must be ≥ 0/);
  });
});

describe('propagateCredalThroughDAG sobre el DAG de la demo (Ec. 34)', () => {
  it('h(t) = h₀ + (P − D)·t se aplica a cada elemento focal', () => {
    const dag = createDemoDAG({
      initialLevel: { lower: 0, upper: 0 },
      drainageCapacity: { lower: 5, upper: 5 },
      horizon: { lower: 2, upper: 2 },
      modelErrorBound: 2,
    });
    const set = createCredalIntervalSet(
      [
        { mass: 0.99, interval: { lower: 5, upper: 15 } }, // ligera
        { mass: 0.01, interval: { lower: 0, upper: 500 } }, // Θ
      ],
      { variable: 'precipitation', unit: 'mm/h', domainBound: 500 }
    );

    const h = credalSetAtNode(propagateCredalThroughDAG(set, dag, 'P'), 'h');

    // ligera: ([5,15] − 5)·2 = [0, 20], ⊕[−2,2] → [−2, 22]
    expect(h.elements[0]).toEqual({ mass: 0.99, interval: { lower: -2, upper: 22 } });
    // Θ: ([0,500] − 5)·2 = [−10, 990], ⊕[−2,2] → [−12, 992]
    expect(h.elements[1]).toEqual({ mass: 0.01, interval: { lower: -12, upper: 992 } });
  });
});

describe('credalSetAtNode', () => {
  it('LANZA para un nodo sin conjunto propagado, en vez de devolver undefined', () => {
    const out = propagateCredalThroughDAG(twoElementSet(), linearDAG(), 'X');
    expect(() => credalSetAtNode(out, 'W')).toThrow(/no tiene conjunto credal propagado/);
  });
});
