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
import { ConflictDecision, ruleOf } from './conflict-rules';
import {
  ConflictMeasureId,
  floorMatrix,
  measureMatrix,
  measureOf,
  pairwiseConflict,
} from './conflict-measures';

/**
 * `pairwiseConflict` (Ecuación 6, Definición 3.5) se implementa en
 * `./conflict-measures.ts`, donde es literalmente la medida D0 y la base sobre
 * la que se construyen D1 y D2. Se reexporta desde aquí porque este es el
 * módulo que la Definición 3.5 nombra, y ninguna importación existente debe
 * tener que enterarse de la reorganización.
 */
export { pairwiseConflict };

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
 *      (P1) es una propiedad de K_global, NO de la regla de decisión: sigue
 *      siendo cierta bajo las cuatro de `./conflict-rules.ts`. Lo que dejó de
 *      valer al abandonar C0 es su corolario «K_decision = K_global salvo
 *      redondeo», que solo describía a C0.
 *
 * (P2) K_global < 1 ⟹ NINGUNA reducción secuencial de Dempster alcanza
 *      conflicto total, en NINGÚN orden.
 *      Demostración: K_global < 1 implica que existe (A₁,…,Aₙ) con
 *      m_i(A_i) > 0 para todo i y S := A₁∩…∩Aₙ ≠ ∅. Para cualquier prefijo,
 *      la BPA acumulada tiene masa > 0 sobre ∩_{i∈prefijo} A_i ⊇ S ≠ ∅, y esa
 *      masa interseca a A_j de la siguiente fuente (contiene S). Luego el K de
 *      ese paso es < 1. ∎
 *
 * (P2′) VERSIÓN CUANTITATIVA, más fuerte y más útil: el conflicto de CADA paso
 *      de la reducción secuencial cumple K^(k) ≤ K_global, en cualquier orden.
 *      Demostración: con U_k := 1 − K_global(m₁,…,m_k) (masa conjunta de las k
 *      primeras fuentes sobre intersecciones no vacías, U_1 = 1), la BPA
 *      acumulada es m^(k)(B) = ũ_k(B)/U_k y por tanto
 *          1 − K^(k) = Σ_{B∩A≠∅} m^(k)(B)·m_{k+1}(A) = U_{k+1}/U_k,
 *      de donde Π_k (1 − K^(k)) = U_n = 1 − K_global (telescopio). Como U_k ≤ 1
 *      y U es decreciente, 1 − K^(k) ≥ U_{k+1} ≥ U_n, es decir K^(k) ≤ K_global. ∎
 *
 *      (P2) es el caso K_global < 1 de (P2′). La identidad del producto es
 *      además la justificación exacta de la normalización K_norm del candidato
 *      C2: 1 − K_global es el producto de los (n−1) factores (1 − K^(k)), luego
 *      1 − (1−K_global)^{1/(n−1)} es la MEDIA GEOMÉTRICA del conflicto por
 *      paso, expresada en la escala del par en que κ₁ y κ₂ fueron elegidos.
 *
 * (P2′) es lo que cierra el hallazgo POR CONSTRUCCIÓN, y de forma independiente
 * de la regla: las cuatro reglas de `./conflict-rules.ts` garantizan una cota
 * K_global ≤ B < 1 en la rama Dempster —B = κ₁ en C0, B = κ_deg en C1,
 * B = 1−(1−κ₁)^{n−1} en C2 y C3— y entonces ningún paso intermedio supera B, en
 * ningún orden, sin depender de que el conflicto por pares sea representativo.
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
 * Los umbrales κ₁ = 0,3 y κ₂ = 0,7 son los del paper y NO cambian: ajustarlos a
 * la vista de una medición sería exactamente el error que la campaña prohíbe.
 * Lo que esta función parametriza es la MAGNITUD que se compara con ellos, que
 * es donde estaba el defecto de diseño de `docs/ERRATA.md` §9:
 *
 * - K_decision ≤ κ₁: "low" → Dempster
 * - κ₁ < K_decision ≤ κ₂: "moderate" → Media cautelosa
 * - K_decision > κ₂: "high" → Envolvente conservativa
 *
 * DOS EJES ORTOGONALES, y conviene no confundirlos:
 *
 *  · `config.measure` elige la MEDIDA por pares — con qué se puntúa el
 *    desacuerdo de cada par (`./conflict-measures.ts`). Corrige el problema de
 *    ESCALA que midió el hindcast: el K crudo incluye un suelo de
 *    discretización que no depende del desacuerdo físico.
 *  · `config.rule` elige la REGLA — qué se hace con esa magnitud y con
 *    K_global, y si actúa la guardia de degeneración (`./conflict-rules.ts`).
 *
 * La guardia opera SIEMPRE sobre el K_global crudo, sea cual sea la medida: es
 * protección frente a la explosión 1/(1−K) de la Ecuación (5), no
 * informatividad, y reescalarla la desactivaría justo donde hace falta.
 *
 * Los defaults de {@link DEFAULT_FUSION_CONFIG} son los seleccionados por los
 * dos experimentos pre-registrados: `exp:conflict-rule` para la regla y
 * `exp:conflict-floor` para la medida.
 *
 * La decisión es independiente del orden de las fuentes bajo CUALQUIER regla:
 * las tres entradas lo son —K_máx es un máximo sobre pares no ordenados,
 * K_global se define sobre el producto conjunto y n es un cardinal— y una regla
 * no recibe nada más.
 *
 * Los tres valores se devuelven por separado para trazabilidad: `maxConflict` es
 * exactamente el K_máx de la Definición 3.5 del paper, `globalConflict` la
 * extensión n-aria, y `decision` la traza completa de la regla aplicada.
 */
export function assessConflict(
  bpas: BPA[],
  config: FusionConfig = DEFAULT_FUSION_CONFIG
): {
  matrix: number[][];
  maxConflict: number;
  globalConflict: number;
  measure: ConflictMeasureId;
  measureMatrix: number[][];
  measureConflict: number;
  floorMatrix: number[][] | null;
  decision: ConflictDecision;
  decisionConflict: number;
  level: ConflictDecision['level'];
  method: ConflictDecision['method'];
} {
  const matrix = conflictMatrix(bpas);
  const n = bpas.length;

  const maxOverPairs = (m: number[][]): number => {
    let best = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) best = Math.max(best, m[i][j]);
    }
    return best;
  };

  const maxConflict = maxOverPairs(matrix);

  // La medida por pares. Con D0 `mMatrix` ES `matrix` valor a valor, y el coste
  // extra es una segunda pasada sobre n²/2 pares ya calculados; se recomputa
  // igualmente en vez de ramificar sobre el identificador, para que añadir una
  // medida no obligue a tocar este bloque.
  const measure = measureOf(config);
  const mMatrix = measureMatrix(bpas, measure);
  const measureConflict = maxOverPairs(mMatrix);
  const floors = floorMatrix(bpas, measure);

  const kGlobal = globalConflict(bpas, config);

  const decision = ruleOf(config).decide({
    maxConflict,
    measureConflict,
    globalConflict: kGlobal,
    sourceCount: n,
    kappa1: config.kappa1,
    kappa2: config.kappa2,
    kappaDegeneracy: config.kappaDegeneracy,
  });

  return {
    matrix,
    maxConflict,
    globalConflict: kGlobal,
    measure: measure.id,
    measureMatrix: mMatrix,
    measureConflict,
    floorMatrix: floors,
    decision,
    decisionConflict: decision.decisionConflict,
    level: decision.level,
    method: decision.method,
  };
}
