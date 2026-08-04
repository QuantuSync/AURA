/**
 * AURA v2 — Cómputo del Reachable Set
 *
 * Implements: Definición 5.3, Teorema 5.4 (end-to-end) del paper AURA interno.
 */

import { Zonotope } from './types';
import { toIntervalHull } from './zonotope';
import { Interval } from '../intervals/types';

export interface ReachableSet {
  zonotope: Zonotope;
  /** Proyección intervalar del reachable set por dimensión */
  intervalHull: Interval[];
  /** Timestamp de cómputo */
  computedAt: number;
}

/**
 * Construye el reachable set a partir de un zonotopo propagado.
 *
 * Paper ref: Definición 5.3.
 */
export function computeReachableSet(z: Zonotope): ReachableSet {
  return {
    zonotope: z,
    intervalHull: toIntervalHull(z),
    computedAt: Date.now(),
  };
}

/**
 * Verifica si un punto x está contenido en el reachable set (via hull).
 */
export function containsPoint(rs: ReachableSet, point: number[]): boolean {
  return rs.intervalHull.every((iv, i) => point[i] >= iv.lower && point[i] <= iv.upper);
}
