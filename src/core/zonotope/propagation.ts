/**
 * AURA v2 — Propagación no lineal con zonotopes
 *
 * Implements: Teorema 5.2 del paper AURA interno.
 *
 * Linearización conservativa de funciones no lineales sobre zonotopes.
 */

import { Zonotope } from './types';
import { minkowskiSum } from './zonotope';
import { Interval } from '../intervals/types';

/**
 * Propaga un zonotopo a través de una función no lineal f: ℝⁿ → ℝᵐ
 * usando linearización de primer orden con término de error conservativo.
 *
 * Paper ref: Teorema 5.2.
 *
 * @param z - Zonotopo de entrada
 * @param f - Función a propagar (evaluada en el centro)
 * @param jacobian - Jacobiana de f evaluada en el centro (array de filas)
 * @param errorBound - Cota del error de linearización (intervalo por dimensión de salida)
 */
export function propagateNonlinear(
  z: Zonotope,
  f: (x: number[]) => number[],
  jacobian: number[][],
  errorBound: Interval[]
): Zonotope {
  const m = jacobian.length;

  // Centro del zonotopo de salida: f(c)
  const newCenter = f(z.center);

  // Generadores linealizados: J · G
  const newGenerators = z.generators.map((g) =>
    jacobian.map((row) => row.reduce((s, a, j) => s + a * g[j], 0))
  );

  // Zonotopo de error: box con radios = errorBound
  const errorGenerators = errorBound.map((eb, i) => {
    const g = new Array(m).fill(0);
    g[i] = (eb.upper - eb.lower) / 2;
    return g;
  });
  const errorCenter = errorBound.map((eb) => (eb.lower + eb.upper) / 2);

  const linearized: Zonotope = {
    center: newCenter,
    generators: newGenerators,
    dimension: m,
  };

  const error: Zonotope = {
    center: errorCenter,
    generators: errorGenerators,
    dimension: m,
  };

  return minkowskiSum(linearized, error);
}
