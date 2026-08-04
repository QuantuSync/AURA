/**
 * AURA v2 — Propagación no lineal con zonotopes
 *
 * Implements: Teorema 5.1 (propagación zonotópica de una función no lineal),
 * Ecuaciones (28)-(29), papers/AURA_v2.pdf §5.4.
 *
 * Linearización conservativa de funciones no lineales sobre zonotopes.
 *
 * NOTA sobre la numeración: el Teorema 5.2 del paper es "Corrección de la
 * decisión" (§5.5), no la propagación. Iteraciones previas citaban 5.2 aquí
 * por error.
 */

import { Zonotope } from './types';
import { minkowskiSum } from './zonotope';
import { Interval } from '../intervals/types';

/**
 * Propaga un zonotopo a través de una función no lineal f: ℝⁿ → ℝᵐ
 * usando linearización de primer orden con término de error conservativo.
 *
 * Paper ref: Teorema 5.1, Ecuación (29), §5.4:
 *   f(Z) ⊆ Z' = <f(c), [ J·G | (L·r_Z²/2)·I_m ]>
 *
 * ────────────────────────────────────────────────────────────────────────
 * LA SOUNDNESS RECAE ENTERAMENTE EN EL LLAMADOR
 * ────────────────────────────────────────────────────────────────────────
 * Esta función NO verifica `jacobian` ni `errorBound`: los usa tal cual. El
 * zonotopo devuelto contiene f(Z) si y solo si `errorBound` acota realmente
 * el resto de Lagrange sobre TODO el zonotopo de entrada, es decir si para
 * todo x ∈ Z y toda salida i:
 *
 *   f_i(x) - f_i(c) - (J·(x - c))_i  ∈  errorBound[i]
 *
 * El Teorema 5.1 da la cota suficiente L·r_Z²/2 con r_Z = Σᵢ‖gᵢ‖, bajo la
 * condición de Lipschitz de la Ecuación (28): ‖Df(x) − Df(c)‖ ≤ L·‖x − c‖
 * para todo x ∈ Z (que es exactamente la hipótesis H3 del Teorema 6.1). Pasar una
 * cota menor (en particular `{lower: 0, upper: 0}`) produce un "reachable set"
 * que NO contiene los estados alcanzables reales, y todo lo que se certifique
 * aguas abajo a partir de él es inválido — sin que nada lo señale.
 *
 * Prefiere `propagateNonlinearAuto` (./linearization) salvo que dispongas de
 * una cota analítica demostrada para tu f concreta. Usa esta versión manual
 * precisamente para ese caso: cuando tu cota es MEJOR que la muestreada.
 *
 * @param z - Zonotopo de entrada
 * @param f - Función a propagar (evaluada en el centro)
 * @param jacobian - Jacobiana de f evaluada en el centro (array de filas)
 * @param errorBound - Cota del error de linearización (intervalo por dimensión de salida).
 *                     Responsabilidad del llamador: debe ser válida sobre todo Z.
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
