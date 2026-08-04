/**
 * AURA v2 — Detección y cuantificación de conflicto
 *
 * Implementa (papers/AURA_v2.pdf §3.4.2):
 * - Definición 3.5 (conflicto por pares) y Ecuación (6)
 * - Definición 3.6 (estrategia de fusión por nivel de conflicto)
 *
 * EXTENSIÓN AL PAPER (candidata a proposición nueva en v3): {@link globalConflict}
 * y su uso en {@link assessConflict}. Ver el JSDoc de `globalConflict` y
 * `docs/ERRATA.md`, entrada 2.
 */

import { BPA, FusionConfig, DEFAULT_FUSION_CONFIG } from './types';

/**
 * Calcula el factor de conflicto K entre dos BPAs.
 *
 * Paper ref: Ecuación (6), §3.4.1 (y entrada K_ij de la Definición 3.5).
 * K = Σ_{B∩C=∅} m1(B) · m2(C)
 *
 * @returns K ∈ [0, 1). K=0 significa acuerdo total, K→1 contradicción total.
 */
export function pairwiseConflict(bpa1: BPA, bpa2: BPA): number {
  let conflict = 0;

  for (const fe1 of bpa1.focalElements) {
    for (const fe2 of bpa2.focalElements) {
      // Comprobar si la intersección es vacía
      const intersection = fe1.indices.filter((i) => fe2.indices.includes(i));
      if (intersection.length === 0) {
        conflict += fe1.mass * fe2.mass;
      }
    }
  }

  return conflict;
}

/**
 * Calcula la matriz de conflicto para n fuentes.
 *
 * Paper ref: Definición 3.5 (conflicto por pares), §3.4.2.
 * K_ij = conflicto entre fuente i y fuente j; K_máx = máx_{i≠j} K_ij.
 *
 * @returns Matriz simétrica n×n con diagonal 0.
 */
export function conflictMatrix(bpas: BPA[]): number[][] {
  const n = bpas.length;
  const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const k = pairwiseConflict(bpas[i], bpas[j]);
      matrix[i][j] = k;
      matrix[j][i] = k;
    }
  }

  return matrix;
}

/**
 * Conflicto GLOBAL n-ario: masa total asignada a intersecciones vacías en el
 * producto conjunto de las n BPAs.
 *
 *     K_global = Σ_{A₁∩…∩Aₙ = ∅}  m₁(A₁) · … · mₙ(Aₙ)
 *
 * ────────────────────────────────────────────────────────────────────────
 * EXTIENDE LA DEFINICIÓN 3.6 DEL PAPER — no es una errata, es una adición
 * ────────────────────────────────────────────────────────────────────────
 * El paper solo define conflicto por PARES (Definición 3.5, K_ij) y elige la
 * estrategia de fusión con K_máx = máx_{i≠j} K_ij (Definición 3.6). El
 * property-based testing demostró que eso no basta: la reducción secuencial
 * (((m₁⊕m₂)⊕m₃)⊕…) concentra masa a cada paso y su conflicto puede llegar a 1
 * con todos los pares en 0,75 (ver el contraejemplo del ciclo en
 * `dempsterCombineMultiple` y su test de regresión). K_máx por pares NO acota
 * el conflicto de la reducción.
 *
 * K_global es la generalización n-aria natural del K de la Ecuación (6), y es
 * independiente del orden por la asociatividad y conmutatividad de la regla de
 * Dempster: se define sobre el producto conjunto, donde no hay orden. Dos
 * propiedades lo convierten en la magnitud correcta para decidir:
 *
 * (P1) K_global ≥ K_ij para todo par i≠j.
 *      Demostración: A_i∩A_j=∅ ⟹ A₁∩…∩Aₙ=∅, luego la suma que define K_global
 *      incluye todos los términos de K_ij; y esos términos factorizan como
 *      K_ij · Π_{l≠i,j} (Σ_A m_l(A)) = K_ij · 1. ∎
 *      En consecuencia K_decision = máx(K_máx, K_global) = K_global salvo
 *      redondeo, y el máximo se conserva solo por trazabilidad y robustez
 *      numérica.
 *
 * (P2) K_global < 1 ⟹ NINGUNA reducción secuencial de Dempster alcanza
 *      conflicto total, en NINGÚN orden.
 *      Demostración: K_global < 1 implica que existe (A₁,…,Aₙ) con
 *      m_i(A_i) > 0 para todo i y S := A₁∩…∩Aₙ ≠ ∅. Para cualquier prefijo,
 *      la BPA acumulada tiene masa > 0 sobre ∩_{i∈prefijo} A_i ⊇ S ≠ ∅, y esa
 *      masa interseca a A_j de la siguiente fuente (contiene S). Luego el K de
 *      ese paso es < 1. ∎
 *
 * (P2) es lo que cierra el hallazgo POR CONSTRUCCIÓN: con κ₁ = 0,3 < 1, la
 * rama Dempster solo se ejecuta con K_global ≤ 0,3, y entonces está demostrado
 * que ningún paso intermedio degenera — sin depender de que el conflicto por
 * pares sea representativo.
 *
 * COMPLEJIDAD: exponencial en n (produce Π_i |F_i| combinaciones en el peor
 * caso, con poda al primer prefijo vacío). Es aceptable para nuestro dominio:
 * la demo usa 3 fuentes (§7.2: Open-Meteo, AEMET, NASA POWER) y el límite
 * configurable `maxSourcesForGlobalConflict` (por defecto 6) hace explícito el
 * régimen en que la función es utilizable. Con n > límite, LANZA en lugar de
 * degradar en silencio a la decisión por pares, que es justo la que no acota.
 *
 * @param bpas - Fuentes a evaluar (todas sobre el mismo marco Θ)
 * @param config - Umbrales y límite de fuentes
 * @returns K_global ∈ [0, 1]. Nótese el cierre en 1: a diferencia del K por
 *          pares de la Ecuación (6) sobre fuentes no degeneradas, el conflicto
 *          global n-ario SÍ alcanza 1 (contraejemplo del ciclo), y ese es
 *          precisamente el caso que hay que detectar.
 * @throws Si `bpas` está vacío o si n supera `maxSourcesForGlobalConflict`.
 */
export function globalConflict(
  bpas: BPA[],
  config: FusionConfig = DEFAULT_FUSION_CONFIG
): number {
  const n = bpas.length;
  if (n === 0) throw new Error('No BPAs to assess');

  const limit = config.maxSourcesForGlobalConflict ?? DEFAULT_FUSION_CONFIG.maxSourcesForGlobalConflict;
  if (n > limit) {
    throw new Error(
      `globalConflict is exponential in the number of sources: got ${n}, limit is ${limit}. ` +
        `Raise FusionConfig.maxSourcesForGlobalConflict deliberately if the cost is acceptable.`
    );
  }

  // Una sola fuente no puede contradecirse consigo misma.
  if (n === 1) return 0;

  // Masa total de cada fuente. En una BPA válida es 1 (Definición 3.2); se
  // computa igualmente para que la poda sea exacta y no dependa de esa
  // suposición: al truncar un prefijo vacío, las fuentes restantes aportan el
  // producto de sus masas totales.
  const totals = bpas.map((b) => b.focalElements.reduce((s, fe) => s + fe.mass, 0));
  const suffixTotals = new Array<number>(n + 1).fill(1);
  for (let i = n - 1; i >= 0; i--) suffixTotals[i] = suffixTotals[i + 1] * totals[i];

  let conflict = 0;

  /**
   * Recorre el producto conjunto acumulando la intersección. En cuanto el
   * prefijo se vacía, TODA extensión suya cae en ∅: se suma su masa por el
   * total de las fuentes restantes y se poda la rama.
   */
  const walk = (i: number, current: number[] | null, massProduct: number): void => {
    if (i === n) return; // intersección completa no vacía → no aporta a K
    for (const fe of bpas[i].focalElements) {
      const next =
        current === null ? fe.indices : current.filter((idx) => fe.indices.includes(idx));
      const product = massProduct * fe.mass;
      if (next.length === 0) {
        conflict += product * suffixTotals[i + 1];
      } else {
        walk(i + 1, next, product);
      }
    }
  };

  walk(0, null, 1);

  return conflict;
}

/**
 * Determina el nivel de conflicto y la estrategia de fusión a aplicar.
 *
 * Paper ref: Definición 3.6 (estrategia de fusión por nivel de conflicto), §3.4.2.
 *
 * Los umbrales κ₁ y κ₂ son los del paper y NO cambian. Lo que cambia es la
 * magnitud con que se comparan:
 *
 *     K_decision = máx(K_máx por pares, K_global)
 *
 * - K_decision ≤ κ₁: "low" → Dempster
 * - κ₁ < K_decision ≤ κ₂: "moderate" → Media cautelosa
 * - K_decision > κ₂: "high" → Envolvente conservativa
 *
 * Por (P1) del JSDoc de {@link globalConflict}, K_global ≥ K_máx siempre, de
 * modo que el máximo es K_global salvo redondeo; se conserva la forma con
 * máximo para que la decisión nunca pueda ser MENOS conservadora que la del
 * paper, ni siquiera por un error numérico.
 *
 * La decisión resultante es independiente del orden de las fuentes: K_máx es un
 * máximo sobre pares no ordenados y K_global se define sobre el producto
 * conjunto.
 *
 * Ambos valores se devuelven por separado para trazabilidad: `maxConflict` es
 * exactamente el K_máx de la Definición 3.5 del paper, y `globalConflict` la
 * extensión.
 */
export function assessConflict(
  bpas: BPA[],
  config: FusionConfig = DEFAULT_FUSION_CONFIG
): {
  matrix: number[][];
  maxConflict: number;
  globalConflict: number;
  decisionConflict: number;
  level: 'low' | 'moderate' | 'high';
  method: 'dempster' | 'cautious' | 'envelope';
} {
  const matrix = conflictMatrix(bpas);
  const n = bpas.length;

  let maxConflict = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      maxConflict = Math.max(maxConflict, matrix[i][j]);
    }
  }

  const kGlobal = globalConflict(bpas, config);
  const decisionConflict = Math.max(maxConflict, kGlobal);

  let level: 'low' | 'moderate' | 'high';
  let method: 'dempster' | 'cautious' | 'envelope';

  if (decisionConflict <= config.kappa1) {
    level = 'low';
    method = 'dempster';
  } else if (decisionConflict <= config.kappa2) {
    level = 'moderate';
    method = 'cautious';
  } else {
    level = 'high';
    method = 'envelope';
  }

  return { matrix, maxConflict, globalConflict: kGlobal, decisionConflict, level, method };
}
