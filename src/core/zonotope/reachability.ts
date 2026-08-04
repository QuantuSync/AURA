/**
 * AURA v2 — Cómputo del Reachable Set
 *
 * Implements: Definición 5.3 (conjunto alcanzable R(t)), papers/AURA_v2.pdf §5.5.
 *
 * NOTA sobre la numeración: no existe ningún "Teorema 5.4" en el paper. El
 * resultado end-to-end es el Teorema 6.1 (soundness composicional, §6.3), que
 * compone los Lemas 6.1 y 6.2 con los Teoremas 4.1 y 5.1.
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
 * Paper ref: Definición 5.3, §5.5.
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
