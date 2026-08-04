/**
 * AURA v2 — Propagación intervalar a través del DAG causal
 *
 * Implements: Propagación de incertidumbre via aritmética de intervalos
 * a través del SCM del paper AURA interno.
 */

import { CausalDAG } from './types';
import { Interval } from '../intervals/types';
import { topologicalSort } from './dag';

/**
 * Propaga valores intervalares a través del DAG en orden topológico.
 *
 * @param dag - El DAG con ecuaciones estructurales
 * @param inputs - Mapa nodeId → Interval para nodos raíz (sin padres)
 * @returns Mapa nodeId → Interval para todos los nodos
 */
export function propagateIntervals(
  dag: CausalDAG,
  inputs: Map<string, Interval>
): Map<string, Interval> {
  const order = topologicalSort(dag);
  const values = new Map<string, Interval>(inputs);

  // Mapa de padres por nodo
  const parents = new Map<string, string[]>();
  for (const node of dag.nodes) parents.set(node.id, []);
  for (const edge of dag.edges) {
    parents.get(edge.to)!.push(edge.from);
  }

  for (const nodeId of order) {
    if (values.has(nodeId)) continue; // ya tiene valor (es input)

    const eq = dag.equations.find((e) => e.nodeId === nodeId);
    if (!eq) continue;

    const parentValues = new Map<string, Interval>();
    for (const parentId of parents.get(nodeId) ?? []) {
      const v = values.get(parentId);
      if (v) parentValues.set(parentId, v);
    }

    values.set(nodeId, eq.compute(parentValues));
  }

  return values;
}
