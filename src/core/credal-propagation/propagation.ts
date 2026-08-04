/**
 * AURA v2 — Propagación credal por el DAG causal
 *
 * EXTENSIÓN al paper (docs/ERRATA.md §8). Es la Definición 4.3 / Ecuación (24)
 * aplicada ELEMENTO FOCAL A ELEMENTO FOCAL en lugar de una sola vez sobre el
 * soporte externo de la Ec. (10):
 *
 *     Para cada A con m(A) > 0:   J_A = propagación intervalar de I_A
 *     La masa NO cambia:          m_imagen(J_A) = m(A)
 *
 * POR QUÉ LA MASA NO CAMBIA. El DAG de la Definición 4.1 es determinista módulo
 * el ruido U_i, y ese ruido ya está acotado por ε_i dentro de cada J_A (el
 * ⊕ [−ε_i, ε_i] de la Ec. 24 lo aplica `propagateIntervals`). La propagación
 * es, por tanto, la imagen de una función multivaluada, y la regla de extensión
 * de Dempster-Shafer para una imagen dice exactamente eso: la masa de A viaja
 * íntegra a la imagen de A. No hay conflicto que normalizar porque no hay
 * segunda fuente de evidencia, y no hay masa que perder porque la imagen de un
 * conjunto no vacío no es vacía.
 *
 * SOUNDNESS. Por el Teorema 4.1, si x* ∈ I_A y |u_i| ≤ ε_i para todo i,
 * entonces v* ∈ J_A. Luego, condicionado a la rama A, el valor real de CUALQUIER
 * variable del DAG está en su J_A. Eso es lo que hace válidos los bounds de
 * `probabilityBounds`.
 */

import { CausalDAG } from '../causal-dag/types';
import { propagateIntervals } from '../causal-dag/propagation';
import { validateDAG } from '../causal-dag/dag';
import { Interval } from '../intervals/types';
import {
  CredalIntervalSet,
  CredalPropagationConfig,
  DEFAULT_CREDAL_PROPAGATION_CONFIG,
  FocalInterval,
} from './types';
import { createCredalIntervalSet } from './credal-interval-set';

/**
 * Propaga cada elemento focal del conjunto credal por el DAG.
 *
 * @param credalSet - Conjunto credal intervalar de la variable de entrada
 *   (típicamente `toCredalIntervalSet(fusionResult)`).
 * @param dag - DAG causal validado (Def. 4.1), con su ε_i por ecuación.
 * @param inputNodeId - Nodo raíz por el que entra el conjunto credal.
 * @returns Un `CredalIntervalSet` POR NODO del DAG, en el mismo orden de
 *   elementos focales y con las mismas masas. Usa {@link credalSetAtNode} para
 *   quedarte con la variable objetivo.
 *
 * COSTE: |F| × coste(`propagateIntervals`), con |F| = número de elementos
 * focales. Lineal, no exponencial: la propagación de cada focal es
 * independiente. Con marcos de ≤ 8 hipótesis y BPAs procedentes de la Def. 3.4
 * (singletons + Θ), |F| se mantiene en el orden de |Θ|; en el escenario de la
 * demo son 4. El límite `config.maxFocalElements` (por defecto 64) hace
 * explícito el régimen de validez y LANZA al superarlo.
 *
 * @throws si el DAG no es válido, si `inputNodeId` no es un nodo del DAG, o si
 *         se excede `config.maxFocalElements`.
 */
export function propagateCredalThroughDAG(
  credalSet: CredalIntervalSet,
  dag: CausalDAG,
  inputNodeId: string,
  config: CredalPropagationConfig = DEFAULT_CREDAL_PROPAGATION_CONFIG
): Map<string, CredalIntervalSet> {
  validateDAG(dag);

  if (!dag.nodes.some((n) => n.id === inputNodeId)) {
    throw new Error(
      `propagateCredalThroughDAG: el DAG no tiene ningún nodo '${inputNodeId}'. ` +
        `Nodos disponibles: ${dag.nodes.map((n) => n.id).join(', ')}.`
    );
  }

  if (credalSet.elements.length > config.maxFocalElements) {
    throw new Error(
      `propagateCredalThroughDAG: ${credalSet.elements.length} elementos focales exceden ` +
        `maxFocalElements = ${config.maxFocalElements}. El coste es |F| × coste de una ` +
        `propagación intervalar; súbelo explícitamente si asumes el coste.`
    );
  }

  // Un acumulador de intervalos por nodo, en el orden de los elementos focales.
  const perNode = new Map<string, FocalInterval[]>();
  for (const node of dag.nodes) perNode.set(node.id, []);

  for (const fe of credalSet.elements) {
    const inputs = new Map<string, Interval>([[inputNodeId, fe.interval]]);
    const values = propagateIntervals(dag, inputs);

    for (const node of dag.nodes) {
      const iv = values.get(node.id);
      if (!iv) {
        // Nodo sin ecuación y sin valor de entrada: el DAG está incompleto. Se
        // omite del resultado en vez de inventar un intervalo.
        continue;
      }
      perNode.get(node.id)!.push({ mass: fe.mass, interval: iv });
    }
  }

  const result = new Map<string, CredalIntervalSet>();
  for (const [nodeId, elements] of perNode) {
    if (elements.length === 0) continue;
    result.set(
      nodeId,
      createCredalIntervalSet(elements, credalSet.frameRef, config, nodeId)
    );
  }

  return result;
}

/**
 * Extrae el conjunto credal de la variable objetivo.
 *
 * @throws si el nodo no está en el resultado de la propagación — un nodo sin
 *         ecuación estructural ni valor de entrada no tiene conjunto credal, y
 *         devolver `undefined` en silencio invitaría a tratarlo como vacío.
 */
export function credalSetAtNode(
  propagated: Map<string, CredalIntervalSet>,
  nodeId: string
): CredalIntervalSet {
  const set = propagated.get(nodeId);
  if (!set) {
    throw new Error(
      `credalSetAtNode: el nodo '${nodeId}' no tiene conjunto credal propagado. ` +
        `Nodos con conjunto: ${[...propagated.keys()].join(', ') || '(ninguno)'}.`
    );
  }
  return set;
}
