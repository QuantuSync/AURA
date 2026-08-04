/**
 * AURA v2 — Operaciones sobre Zonotopes
 *
 * Implements (papers/AURA_v2.pdf §5.2–5.3):
 * - Definición 5.1 (zonotope), Ecuación (26)
 * - Observación 5.1 (cierre bajo suma de Minkowski y transformación lineal)
 * - Definición 5.2 (zonotope inicial desde intervalos credales), Ecuación (27)
 * - Observación 5.2 (reducción de orden, método de Girard)
 */

import { Zonotope } from './types';
import { Interval } from '../intervals/types';

/**
 * Crea el zonotopo inicial Z0 a partir de los intervalos credales de la Capa 2.
 *
 * Paper ref: Definición 5.2, Ecuación (27), §5.3. ES EL PUENTE 2→3.
 *
 * Cada intervalo [v̲_i, v̄_i] se convierte en:
 *   centro:    c0_i = (v̲_i + v̄_i) / 2
 *   generador: G0 = diag((v̄_i − v̲_i) / 2)
 *
 * Es un zonotope-caja: sin correlaciones iniciales. Las correlaciones aparecen
 * al propagar Z0 a través de las ecuaciones del DAG.
 *
 * Cobertura: Proposición 5.1 (= Lema 6.2, soundness del Puente 2→3) garantiza
 * que si v*_i ∈ [V_i] para todo i, entonces (v*_1, …, v*_n) ∈ Z0.
 *
 * NOTA NUMÉRICA (hallada por property-based testing, ver
 * __tests__/properties/bridge-2-3.property.test.ts):
 *
 * El radio NO se computa como (v̄ - v̲)/2 sino como máx(v̄ - c, c - v̲). Ambas
 * expresiones coinciden en aritmética real, pero no en coma flotante: cuando
 * el ancho del intervalo es menor que el ulp de su punto medio, el centro
 * computado c = (v̲ + v̄)/2 se redondea y deja de ser el punto medio exacto,
 * de modo que [c - (v̄-v̲)/2, c + (v̄-v̲)/2] NO contiene [v̲, v̄] y la
 * Proposición 5.1 se viola.
 *
 * Ejemplo real: [100, 100+1e-14] daba c = 100 y radio 7.1e-15, es decir el
 * hull [100, 100] — que deja fuera el extremo superior. El testigo α de la
 * demostración salía 2, no ∈ [-1, 1].
 *
 * Con máx(v̄ - c, c - v̲) las dos restas son exactas por el lema de Sterbenz
 * (c está a menos de un factor 2 de ambos extremos), luego el radio acota la
 * distancia real del centro a cada extremo. Para intervalos normales el valor
 * es idéntico a (v̄ - v̲)/2, así que no hay ensanchamiento en la práctica.
 */
export function fromIntervals(intervals: Interval[]): Zonotope {
  const n = intervals.length;
  const center = intervals.map((iv) => (iv.lower + iv.upper) / 2);
  const generators = intervals.map((iv, i) => {
    const g = new Array(n).fill(0);
    g[i] = Math.max(iv.upper - center[i], center[i] - iv.lower);
    return g;
  });
  return { center, generators, dimension: n };
}

/**
 * Suma de Minkowski: Z1 ⊕ Z2 = <c1+c2, [G1|G2]>
 *
 * Paper ref: Observación 5.1, §5.2. Coste O(np).
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
 * Transformación lineal: M · <c, G> = <Mc, MG>
 *
 * Paper ref: Observación 5.1, §5.2. Coste O(np).
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
 * Paper ref: Observación 5.2 (método de Girard), §5.4. Ordenar generadores por
 * norma descendente, mantener los q mayores y agrupar los restantes en una caja
 * con r_j = Σ_{i>q} |g_{i,j}|. Mantiene soundness a costa de sobre-aproximación.
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
