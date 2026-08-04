/**
 * AURA v2 — Propagación intervalar a través del DAG causal
 *
 * Implements: Definición 4.3 (propagación intervalar a través del SCM),
 * Ecuación (24), y Teorema 4.1 (soundness de la propagación),
 * papers/AURA_v2.pdf §4.4.2.
 *
 * El Teorema 4.1 garantiza v*_i ∈ [V_i] para toda variable del DAG bajo dos
 * hipótesis: (i) las entradas reales están en los intervalos credales de la
 * Capa 1 (= H1 del Teorema 6.1), y (ii) |u_i| ≤ ε_i para todo i (= H2).
 *
 * La (i) es una propiedad de la Capa 1 y no puede verificarse aquí. La (ii) es
 * una propiedad de la CALIBRACIÓN de cada ε_i (Definición 4.4) y tampoco puede
 * verificarse aquí — pero lo que sí está garantizado por construcción desde
 * esta iteración es que el ⊕ [−ε_i, ε_i] de la Ecuación (24) SE APLICA
 * siempre, con el ε_i que la ecuación declara. Antes dependía de que el autor
 * de cada ecuación se acordara de sumarlo dentro de `compute`.
 */

import { CausalDAG } from './types';
import { Interval } from '../intervals/types';
import { topologicalSort, validateDAG } from './dag';

/**
 * Propaga valores intervalares a través del DAG en orden topológico.
 *
 * Paper ref: Definición 4.3, Ecuación (24), §4.4.2:
 *
 *     [V_i] = f_i([pa(V_i)]) ⊕ [−ε_i, ε_i]
 *
 * `eq.compute` aporta f_i([pa(V_i)]) y `eq.modelErrorBound` aporta ε_i; el ⊕ lo
 * aplica esta función. Los nodos raíz (sin ecuación) toman su valor de
 * `inputs`: son las salidas de la Capa 1 y su incertidumbre ya está en el
 * intervalo credal, no hay error de modelo que añadir.
 *
 * @param dag - El DAG con ecuaciones estructurales (validado, ver `validateDAG`)
 * @param inputs - Mapa nodeId → Interval para nodos raíz (sin padres)
 * @returns Mapa nodeId → Interval para todos los nodos
 * @throws Si el DAG no es válido (ciclos, ε_i < 0, referencias colgantes).
 */
export function propagateIntervals(
  dag: CausalDAG,
  inputs: Map<string, Interval>
): Map<string, Interval> {
  // La soundness de la Ec. (24) exige ε_i ≥ 0; validar aquí hace que la
  // garantía no dependa de que el DAG se haya construido con `createCausalDAG`.
  validateDAG(dag);

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

    // f_i([pa(V_i)])
    const image = eq.compute(parentValues);

    // ⊕ [−ε_i, ε_i] — Ecuación (24). Suma de Minkowski de intervalos, que para
    // el caso simétrico es exactamente ensanchar por ε_i a cada lado.
    const eps = eq.modelErrorBound;
    values.set(nodeId, { lower: image.lower - eps, upper: image.upper + eps });
  }

  return values;
}
