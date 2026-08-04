/**
 * AURA v2 — Causal DAG Types
 *
 * Implements: Tipos para el modelo causal estructural (SCM) del paper AURA interno.
 */

import { Interval } from '../intervals/types';

export interface DAGNode {
  id: string;
  label: string;
  unit: string;
  /** Valor actual como intervalo */
  value?: Interval;
}

export interface DAGEdge {
  from: string;
  to: string;
  /** Coeficiente de influencia (puede ser intervalo) */
  weight: Interval;
}

export interface StructuralEquation {
  nodeId: string;
  /** f(parents) → Interval */
  compute: (parentValues: Map<string, Interval>) => Interval;
}

export interface CausalDAG {
  nodes: DAGNode[];
  edges: DAGEdge[];
  equations: StructuralEquation[];
}
