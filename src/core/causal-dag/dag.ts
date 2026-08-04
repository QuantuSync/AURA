/**
 * AURA v2 — Definición y validación del DAG causal
 *
 * Implements: Modelado causal con DAG del paper AURA interno.
 */

import { CausalDAG } from './types';

/** Verifica que el grafo no tiene ciclos (es un DAG). */
export function isAcyclic(dag: CausalDAG): boolean {
  const adjacency = new Map<string, string[]>();
  for (const node of dag.nodes) adjacency.set(node.id, []);
  for (const edge of dag.edges) {
    adjacency.get(edge.from)!.push(edge.to);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  function hasCycle(nodeId: string): boolean {
    visited.add(nodeId);
    inStack.add(nodeId);
    for (const neighbor of adjacency.get(nodeId) ?? []) {
      if (!visited.has(neighbor) && hasCycle(neighbor)) return true;
      if (inStack.has(neighbor)) return true;
    }
    inStack.delete(nodeId);
    return false;
  }

  for (const node of dag.nodes) {
    if (!visited.has(node.id) && hasCycle(node.id)) return false;
  }
  return true;
}

/** Ordena los nodos en orden topológico (padres antes que hijos). */
export function topologicalSort(dag: CausalDAG): string[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of dag.nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }
  for (const edge of dag.edges) {
    adjacency.get(edge.from)!.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  const queue = dag.nodes.filter((n) => inDegree.get(n.id) === 0).map((n) => n.id);
  const result: string[] = [];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    result.push(nodeId);
    for (const neighbor of adjacency.get(nodeId) ?? []) {
      const deg = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, deg);
      if (deg === 0) queue.push(neighbor);
    }
  }

  return result;
}
