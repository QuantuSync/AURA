/**
 * AURA v2 — Definición y validación del DAG causal
 *
 * Implements: Definición 4.1 (SCM y su DAG G = (V, E)), papers/AURA_v2.pdf §4.2.
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

/**
 * Valida un DAG causal antes de propagar por él.
 *
 * Comprueba las precondiciones estructurales de la Definición 4.1 y, sobre
 * todo, que cada ecuación estructural declara un bound de error de modelo
 * ε_i ≥ 0 finito (Definición 4.3 / Ecuación 24, calibrado según Definición
 * 4.4). Un ε_i negativo ENCOGERÍA el intervalo propagado en lugar de
 * ensancharlo, violando la soundness del Teorema 4.1 en silencio: es la única
 * forma de que el ⊕ [−ε_i, ε_i] sea menos conservador que no aplicarlo, y por
 * eso se rechaza en construcción y no aguas abajo.
 *
 * @throws Si el grafo tiene ciclos, si una ecuación referencia un nodo
 *         inexistente o duplicado, o si algún ε_i es negativo o no finito.
 */
export function validateDAG(dag: CausalDAG): void {
  const ids = new Set<string>();
  for (const node of dag.nodes) {
    if (ids.has(node.id)) throw new Error(`Duplicate node id: ${node.id}`);
    ids.add(node.id);
  }

  for (const edge of dag.edges) {
    if (!ids.has(edge.from)) throw new Error(`Edge references unknown node: ${edge.from}`);
    if (!ids.has(edge.to)) throw new Error(`Edge references unknown node: ${edge.to}`);
  }

  const seenEquations = new Set<string>();
  for (const eq of dag.equations) {
    if (!ids.has(eq.nodeId)) {
      throw new Error(`Structural equation references unknown node: ${eq.nodeId}`);
    }
    if (seenEquations.has(eq.nodeId)) {
      throw new Error(`Duplicate structural equation for node: ${eq.nodeId}`);
    }
    seenEquations.add(eq.nodeId);

    // ε_i ≥ 0 — Definición 4.3, Ecuación (24); calibración según Definición 4.4.
    const eps = eq.modelErrorBound;
    if (!Number.isFinite(eps)) {
      throw new Error(
        `Model error bound (ε) for node ${eq.nodeId} must be a finite number, got ${eps}`
      );
    }
    if (eps < 0) {
      throw new Error(
        `Model error bound (ε) for node ${eq.nodeId} must be ≥ 0 (Definición 4.3, Ec. 24), got ${eps}`
      );
    }
  }

  if (!isAcyclic(dag)) {
    throw new Error('Causal graph is not acyclic (Definición 4.1 requires a DAG)');
  }
}

/**
 * Constructor validado de un DAG causal — punto de entrada recomendado.
 *
 * Equivale a escribir el objeto literal y llamar a {@link validateDAG}, pero
 * hace imposible olvidarse de la validación. `propagateIntervals` valida
 * igualmente, de modo que la garantía no depende de usar este constructor.
 */
export function createCausalDAG(dag: CausalDAG): CausalDAG {
  validateDAG(dag);
  return dag;
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
