import { describe, it, expect } from 'vitest';
import { propagateIntervals } from '@/core/causal-dag/propagation';
import { topologicalSort, isAcyclic } from '@/core/causal-dag/dag';
import { CausalDAG } from '@/core/causal-dag/types';
import { add, multiply } from '@/core/intervals/arithmetic';
import { Interval } from '@/core/intervals/types';

// Simple DAG: X → Y → Z
// Y = 2 * X,  Z = Y + 1
const dag: CausalDAG = {
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
    },
    {
      nodeId: 'Z',
      compute: (parents) => add(parents.get('Y')!, { lower: 1, upper: 1 }),
    },
  ],
};

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
