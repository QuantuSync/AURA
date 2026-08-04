/**
 * AURA v2 — Operaciones sobre Zonotopes
 *
 * Implements: Definición 5.1, Teorema 5.1 del paper AURA interno.
 *
 * Operaciones básicas: suma de Minkowski, transformación lineal, reducción de orden.
 */

import { Zonotope } from './types';
import { Interval } from '../intervals/types';

/**
 * Crea un zonotopo a partir de un vector de intervalos.
 * Cada intervalo [l_i, u_i] se convierte en:
 *   centro: (l_i + u_i) / 2
 *   generador: e_i * (u_i - l_i) / 2
 */
export function fromIntervals(intervals: Interval[]): Zonotope {
  const n = intervals.length;
  const center = intervals.map((iv) => (iv.lower + iv.upper) / 2);
  const generators = intervals.map((iv, i) => {
    const g = new Array(n).fill(0);
    g[i] = (iv.upper - iv.lower) / 2;
    return g;
  });
  return { center, generators, dimension: n };
}

/**
 * Suma de Minkowski: Z1 ⊕ Z2 = <c1+c2, [G1|G2]>
 *
 * Paper ref: Teorema 5.1.
 */
export function minkowskiSum(z1: Zonotope, z2: Zonotope): Zonotope {
  if (z1.dimension !== z2.dimension) throw new Error('Zonotopes must have same dimension');
  return {
    center: z1.center.map((c, i) => c + z2.center[i]),
    generators: [...z1.generators, ...z2.generators],
    dimension: z1.dimension,
  };
}

/**
 * Transformación lineal: Z' = <Ac, AG>
 *
 * Paper ref: Teorema 5.1.
 *
 * @param z - Zonotopo de entrada
 * @param A - Matriz n×n (array de filas)
 */
export function linearTransform(z: Zonotope, A: number[][]): Zonotope {
  const matVec = (M: number[][], v: number[]): number[] =>
    M.map((row) => row.reduce((s, a, j) => s + a * v[j], 0));

  return {
    center: matVec(A, z.center),
    generators: z.generators.map((g) => matVec(A, g)),
    dimension: z.dimension,
  };
}

/**
 * Proyecta el zonotopo en un intervalo para cada dimensión.
 * [c_i - Σ|g_{ij}|, c_i + Σ|g_{ij}|]
 */
export function toIntervalHull(z: Zonotope): Interval[] {
  return z.center.map((c, i) => {
    const radius = z.generators.reduce((s, g) => s + Math.abs(g[i]), 0);
    return { lower: c - radius, upper: c + radius };
  });
}

/**
 * Reducción de orden: reduce el número de generadores a maxGenerators
 * combinando los menos significativos en generadores box.
 *
 * Paper ref: reducción conservativa estándar de zonotopes.
 */
export function reduce(z: Zonotope, maxGenerators: number): Zonotope {
  if (z.generators.length <= maxGenerators) return z;

  const n = z.dimension;
  // Ordenar generadores por norma descendente
  const sorted = [...z.generators].sort((a, b) => {
    const normA = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
    const normB = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
    return normB - normA;
  });

  const kept = sorted.slice(0, maxGenerators - n);
  const reduced = sorted.slice(maxGenerators - n);

  // Combinar los generadores reducidos en un box conservativo
  const boxGenerators: number[][] = [];
  for (let i = 0; i < n; i++) {
    const radius = reduced.reduce((s, g) => s + Math.abs(g[i]), 0);
    const g = new Array(n).fill(0);
    g[i] = radius;
    if (radius > 1e-15) boxGenerators.push(g);
  }

  return {
    center: z.center,
    generators: [...kept, ...boxGenerators],
    dimension: n,
  };
}
