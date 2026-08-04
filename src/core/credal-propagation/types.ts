/**
 * AURA v2 — Tipos de la propagación credal
 *
 * EXTENSIÓN al paper (`papers/AURA_v2.pdf`), ver docs/ERRATA.md §8.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE ESTA CAPA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * La Definición 3.9 / Ecuación (10) colapsa el conjunto credal de la Capa 1 a un
 * único intervalo — su SOPORTE externo — y el paper afirma que "para la
 * propagación zonotópica, el bound externo es suficiente". Esa afirmación es
 * falsa en la práctica una vez H0 es honesta (docs/ERRATA.md §5):
 *
 *   · La Definición 3.4 / Ecuación (4) reserva masa δ_i sobre Θ ("válvula de
 *     seguridad" de cada fuente).
 *   · Θ interseca TODAS las hipótesis, incluida la de cola [a_{k−1}, P_máx].
 *   · Tras la fusión, la masa sobre Θ sobrevive: para la regla de Dempster vale
 *     al menos Π_i δ_i (normalizada por 1/(1−K), luego ≥ Π_i δ_i). Por tanto
 *     Pl(cola) ≥ Π_i δ_i, que con tres fuentes de δ ≈ 0,05 es ~1e-4 — doce
 *     órdenes de magnitud por encima del umbral 1e-10 de la Ec. (10).
 *   · La cola nunca se descarta ⟹ el lifting devuelve [a₀, P_máx] ENTERO,
 *     independientemente de la evidencia.
 *
 * Medido sobre el escenario de la demo (3 fuentes concordando en ~8 mm/h,
 * δ = 0,05/0,03/0,08): m(Θ) = 1,471e-4, Pl(torrencial) = 1,471e-4, intervalo
 * credal = [0, 500] mm/h — el rango completo del marco. El sistema es sound
 * pero VACUO.
 *
 * La causa raíz es que la Ec. (10) descarta la estructura credal —los bounds
 * [Bel, Pl] por hipótesis, y antes de ellos la asignación de masa a elementos
 * focales— y conserva solo el soporte. Toda la información de que el 99,9 % de
 * la masa está sobre *ligera* se pierde en el puente 1→2.
 *
 * Esta capa la conserva: en vez de propagar un intervalo, propaga CADA elemento
 * focal con su masa, y en la salida computa bounds [Bel(E), Pl(E)] del evento
 * inseguro E. El certificado existencial de la Def. 5.5 NO cambia de semántica;
 * el nivel probabilístico lo cualifica.
 */

import { Interval } from '../intervals/types';

/**
 * Procedencia de un conjunto credal intervalar: qué marco de discernimiento
 * (Def. 3.1′) lo originó y bajo qué `domainBound` (H0).
 *
 * Viaja con el conjunto a través del DAG aunque la variable cambie (de `P`
 * mm/h a `h` mm): lo que se registra es de dónde salió la masa, que es lo que
 * un auditor necesita para saber qué hipótesis H0 respalda los bounds.
 *
 * Estructuralmente idéntico a `DeclaredDomainBound` (src/core/decision/types.ts),
 * que es el nombre que ese mismo hecho recibe dentro del certificado.
 */
export interface FrameRef {
  variable: string;
  unit: string;
  /** P_máx declarado — `FrameOfDiscernment.domainBound`. */
  domainBound: number;
}

/**
 * Un elemento focal A de la BPA, ya elevado a intervalo continuo.
 *
 * `interval` es el HULL de A: [mín_{θ_j∈A} a_j, máx_{θ_j∈A} b_j], con b_j el
 * bound superior efectivo de la Ec. (10) (`hypothesisUpper`, que usa el
 * `domainBound` para la cola).
 *
 * Para un A no contiguo —p. ej. {θ₀, θ₂}— el hull es estrictamente mayor que
 * la unión de sus hipótesis. Es una SOBRE-APROXIMACIÓN, y su dirección es la
 * conservadora en ambos extremos de los bounds de probabilidad: ver
 * `probabilityBounds`.
 */
export interface FocalInterval {
  /** m(A) ∈ [0, 1]. */
  mass: number;
  /** Hull de A, o su imagen propagada por el DAG. */
  interval: Interval;
}

/**
 * Conjunto credal en forma propagable: la BPA fusionada vista como una
 * distribución de masa sobre INTERVALOS en lugar de sobre subconjuntos del
 * marco.
 *
 * INVARIANTE: Σ mass = 1 ± {@link MASS_SUM_TOLERANCE}. Se valida en
 * construcción ({@link createCredalIntervalSet}) y se preserva por la
 * propagación, que no toca las masas.
 *
 * No es un tipo nuevo de objeto matemático: es la misma función de creencia,
 * escrita en el dominio continuo. Su Bel/Pl sobre eventos del dominio continuo
 * es lo que computa `probabilityBounds`.
 */
export interface CredalIntervalSet {
  elements: FocalInterval[];
  frameRef: FrameRef;
  /**
   * Nodo del DAG sobre el que vive este conjunto, si procede de una
   * propagación. Ausente en el conjunto de entrada (que vive sobre la variable
   * del marco). Puramente informativo, para trazabilidad.
   */
  nodeId?: string;
}

/**
 * Bounds de probabilidad de un evento, en el sentido de la Definición 3.3
 * (Ec. 1-2) aplicada a la función de creencia imagen sobre el dominio continuo:
 *
 *   belLower = Bel(E) = Σ_{A : J_A ⊆ E} m(A)      — cota INFERIOR de P(E)
 *   plUpper  = Pl(E)  = Σ_{A : J_A ∩ E ≠ ∅} m(A)  — cota SUPERIOR de P(E)
 *
 * con J_A el intervalo propagado del elemento focal A.
 *
 * Ambos son bounds DEMOSTRADOS bajo H0-H3, no heurísticas: ver el argumento de
 * soundness en el JSDoc de `probabilityBounds`. Es la diferencia esencial con
 * `severityScore` (src/core/decision/synthesis.ts), que sigue siendo una
 * métrica geométrica sin estatus formal.
 */
export interface ProbabilityBounds {
  belLower: number;
  plUpper: number;
}

/**
 * Tolerancia del invariante Σ mass = 1.
 *
 * Es tolerancia de COMA FLOTANTE, no un margen semántico: las reglas de
 * combinación normalizan (Dempster divide por 1−K) y descartan masas ≤ 1e-10,
 * de modo que la suma puede desviarse de 1 en unos pocos ulp acumulados. Una
 * desviación mayor indica una BPA mal formada, y entonces se LANZA: unos bounds
 * de probabilidad calculados sobre masa que no suma 1 no son bounds de nada.
 */
export const MASS_SUM_TOLERANCE = 1e-9;

/** Configuración de la propagación credal. */
export interface CredalPropagationConfig {
  /**
   * Número máximo de elementos focales admitidos.
   *
   * COSTE: la propagación es |F| × coste(`propagateIntervals`), con |F| el
   * número de elementos focales de la BPA fusionada. |F| está acotado por
   * 2^|Θ| − 1 en el peor caso teórico, pero en la práctica es pequeño: una BPA
   * gaussiana (Def. 3.4) tiene a lo sumo |Θ| singletons más Θ, y la regla de
   * Dempster sobre singletons y Θ produce de nuevo singletons y Θ. En el
   * escenario de la demo (marco de 5 hipótesis, 3 fuentes) la BPA fusionada
   * tiene **4** elementos focales.
   *
   * El límite existe para que un régimen exponencial no degrade en silencio: al
   * superarlo se LANZA, como hace `maxSourcesForGlobalConflict` con el conflicto
   * n-ario (Def. 3.6 extendida). Quien necesite más debe subirlo
   * explícitamente y asumir el coste.
   */
  maxFocalElements: number;
}

export const DEFAULT_CREDAL_PROPAGATION_CONFIG: CredalPropagationConfig = {
  maxFocalElements: 64,
};
