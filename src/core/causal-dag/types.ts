/**
 * AURA v2 — Causal DAG Types
 *
 * Implements: Definición 4.1 (Modelo Causal Estructural), papers/AURA_v2.pdf §4.2.
 *
 * BOUND DE ERROR DE MODELO POR CONSTRUCCIÓN (Def. 4.3 / Ec. 24).
 *
 * La Ecuación (24) define la propagación como
 *
 *     [V_i] = f_i([pa(V_i)]) ⊕ [−ε_i, ε_i]
 *
 * Hasta esta iteración, `StructuralEquation` solo tenía `compute`, que devolvía
 * el intervalo ya formado: el ⊕ [−ε_i, ε_i] quedaba a cargo de quien definía la
 * ecuación y nada lo verificaba. Ese era el mismo patrón de "soundness delegada
 * al llamador" que se corrigió en la Capa 3, y sobre él se apoya la hipótesis H2
 * del Teorema 6.1.
 *
 * Ahora ε_i es un campo OBLIGATORIO y separado (`modelErrorBound`), y
 * `propagateIntervals` aplica el ⊕ [−ε_i, ε_i] automáticamente tras evaluar
 * f_i. `compute` implementa f_i y NADA MÁS: si además sumase el bound a mano,
 * este se contaría dos veces (sound pero innecesariamente conservador).
 */

import { Interval } from '../intervals/types';

/**
 * SUBCLASE DE SCM QUE AURA IMPLEMENTA: ruido aditivo acotado.
 *
 * ⚠ Declaración explícita de una hipótesis que el paper deja tácita — ver
 * docs/ERRATA.md §4 (clase ERRATA, menor, de rigor).
 *
 * La Definición 4.1 / Definición 4.3 de papers/AURA_v2.pdf escribe la ecuación
 * estructural con el ruido como ARGUMENTO de f_i:
 *
 *     V_i = f_i(pa(V_i), U_i)
 *
 * pero la Ecuación (24) y el paso "sumando el error de modelo" de la
 * demostración del Teorema 4.1 lo tratan como un término ADITIVO:
 *
 *     [V_i] = f_i([pa(V_i)]) ⊕ [−ε_i, ε_i]                              (24)
 *
 * Ambas lecturas solo coinciden si f_i tiene la forma f̃_i(pa(V_i)) + U_i. Con
 * un error no aditivo —multiplicativo, V_i = f̃_i(pa)·(1 + U_i), por ejemplo—
 * el paso de la demostración no vale tal cual: haría falta acotar
 * |f_i(pa, u) − f̃_i(pa)| ≤ ε_i UNIFORMEMENTE sobre todo el intervalo de los
 * padres, no solo |u_i| ≤ ε_i.
 *
 * **AURA implementa la subclase con ruido aditivo acotado:**
 *
 *     V_i = f_i(pa(V_i)) + U_i,     |U_i| ≤ ε_i
 *
 * Es decir: `compute` implementa f_i (determinista, sin ruido) y
 * {@link StructuralEquation.modelErrorBound} declara ε_i por separado; la
 * propagación aplica el ⊕ [−ε_i, ε_i]. La lectura aditiva es además la única
 * consistente con la calibración de la Definición 4.4, que calibra sobre el
 * residuo v_i^(k) − f_i(x^(k)).
 *
 * Consecuencia para quien modele con errores NO aditivos: es legítimo usar este
 * DAG, pero ε_i debe entonces acotar la discrepancia
 * |f_i(pa, U_i) − f_i(pa)| sobre TODO [pa(V_i)], y la calibración de la
 * Definición 4.4 debe hacerse sobre esa discrepancia y no sobre el residuo. El
 * código no puede verificarlo: es parte de H2 del Teorema 6.1.
 *
 * La v3 del paper debe hacer explícita esta hipótesis en la Definición 4.1.
 *
 * @see docs/ERRATA.md §4
 */

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
  /**
   * f_i(pa(V_i)) → Interval: la extensión intervalar natural de la ecuación
   * estructural, SIN el bound de error de modelo.
   *
   * El ⊕ [−ε_i, ε_i] de la Ecuación (24) lo aplica la propagación a partir de
   * {@link StructuralEquation.modelErrorBound}. No lo incluyas aquí.
   */
  compute: (parentValues: Map<string, Interval>) => Interval;
  /**
   * ε_i ≥ 0 — bound del error de modelo U_i de la Ecuación (24), en las
   * unidades del nodo. OBLIGATORIO y sin valor por defecto: quien define una
   * ecuación estructural debe declararlo explícitamente, aunque sea 0.
   *
   * Calibración — Definición 4.4, Ecuación (25), §4.5:
   *
   *     ε_i = máx_k |v_i^(k) − f_i(x_pa(V_i)^(k))| + δ_margin
   *
   * sobre un conjunto de N observaciones históricas, con δ_margin > 0 un margen
   * de seguridad para errores no observados en el dataset de calibración. La
   * nota de implementación del paper propone δ_margin = γ·σ̂_residuos con
   * γ ∈ [1, 3] (γ = 3 ⇒ 99,7 % de cobertura bajo normalidad), pero subraya que
   * la garantía del Teorema 4.1 exige |u_i| ≤ ε_i DE FORMA DETERMINISTA, no con
   * probabilidad: ε_i debe cubrir el peor caso observado más un margen, nunca
   * el caso promedio.
   *
   * ε_i = 0 SOLO es legítimo para identidades exactas — una ecuación que es
   * verdadera por definición y no un modelo del mundo (cambios de unidad,
   * renombrados, sumas contables). Para cualquier ecuación que aproxime un
   * fenómeno físico, ε_i = 0 afirma que el modelo es exacto: es H2 del Teorema
   * 6.1 declarada como cierta sin calibrar, y todo certificado aguas abajo
   * hereda esa afirmación.
   *
   * @see Definición 4.4 y Ecuación (25), papers/AURA_v2.pdf §4.5.
   */
  modelErrorBound: number;
}

export interface CausalDAG {
  nodes: DAGNode[];
  edges: DAGEdge[];
  equations: StructuralEquation[];
}
