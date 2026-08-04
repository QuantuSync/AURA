/**
 * AURA v2 — Dempster-Shafer Types
 *
 * Implements: Definiciones 3.1, 3.2, 3.3, 3.7, 3.8 de papers/AURA_v2.pdf (§3.2–3.5).
 *
 * El marco de discernimiento Θ se representa como un array de intervalos.
 * Cada intervalo es una hipótesis sobre el valor de una variable.
 */

/** Un intervalo [lower, upper) representando una hipótesis — Definición 3.1 */
export interface Hypothesis {
  label: string;        // e.g., "nula", "ligera", "moderada"
  lower: number;        // Límite inferior (inclusivo)
  upper: number;        // Límite superior (exclusivo, excepto el último)
}

/** Marco de discernimiento Θ: conjunto finito, exhaustivo y mutuamente
 *  excluyente de hipótesis — Definición 3.1, §3.2 */
export interface FrameOfDiscernment {
  variable: string;     // e.g., "precipitation", "wind_speed"
  unit: string;         // e.g., "mm/h", "km/h"
  hypotheses: Hypothesis[];
}

/**
 * Basic Probability Assignment (BPA) — Definición 3.2
 *
 * Mapea subconjuntos de Θ a masas en [0, 1].
 * Los subconjuntos se representan como arrays de índices de hipótesis.
 * La masa total debe sumar 1. m(∅) = 0 por construcción.
 *
 * Ejemplo: m({θ1}) = 0.6, m({θ2, θ3}) = 0.3, m(Θ) = 0.1
 * Se representa como:
 *   focalElements: [
 *     { indices: [0], mass: 0.6 },
 *     { indices: [1, 2], mass: 0.3 },
 *     { indices: [0, 1, 2, 3, 4], mass: 0.1 }  // Θ completo
 *   ]
 */
export interface FocalElement {
  indices: number[];    // Índices de las hipótesis en el marco
  mass: number;         // Masa asignada, en [0, 1]
}

export interface BPA {
  frame: FrameOfDiscernment;
  focalElements: FocalElement[];
  sourceId: string;     // Identificador de la fuente
  timestamp: number;    // Unix timestamp de la medición
}

/**
 * Funciones de creencia y plausibilidad — Definición 3.3
 *
 * Bel(A) = Σ_{B⊆A} m(B)   (cota inferior de probabilidad)
 * Pl(A) = Σ_{B∩A≠∅} m(B)  (cota superior de probabilidad)
 */
export interface BeliefPlausibility {
  hypothesis: number;   // Índice de la hipótesis
  belief: number;       // Bel({θ_j})
  plausibility: number; // Pl({θ_j})
}

/**
 * Envolvente conservativa EXACTA — Definición 3.7, Ecuaciones (8)-(9), §3.4.2
 *
 * Para cada hipótesis θ_j sobre un conjunto de fuentes {m_i}:
 *
 *   Eq (8):  lower[j] = P̲(θ_j) = min_i Bel_i({θ_j})
 *   Eq (9):  upper[j] = P̄(θ_j) = max_i Pl_i({θ_j})
 *
 * Es el menor "box" de intervalos [Bel, Pl] que contiene el de cada fuente
 * individual. A diferencia de la BPA sintética que devuelve `envelopeCombine`,
 * este objeto no está mediado por ninguna asignación de masa: es directamente
 * la envolvente del paper, sin sobre-aproximación.
 */
export interface Envelope {
  frame: FrameOfDiscernment;
  /** Un par [lower, upper] por hipótesis, en el orden de `frame.hypotheses`. */
  bounds: Array<{ lower: number; upper: number }>;
}

/** Resultado de fusión con metadatos */
export interface FusionResult {
  fused: BPA;
  method: 'dempster' | 'cautious' | 'envelope';
  conflictMatrix: number[][];
  /**
   * K_máx = máx_{i≠j} K_ij — el conflicto por pares de la Definición 3.5,
   * literal del paper. NO es la magnitud con que se decide la estrategia:
   * ver {@link FusionResult.decisionConflict}.
   */
  maxConflict: number;
  /**
   * K_global — masa total en intersecciones vacías del producto conjunto de
   * las n BPAs. EXTENSIÓN al paper (ver `globalConflict` en ./conflict.ts).
   * Independiente del orden de las fuentes; siempre ≥ `maxConflict`.
   */
  globalConflict: number;
  /**
   * K_decision = máx(`maxConflict`, `globalConflict`) — la magnitud que se
   * compara con κ₁ y κ₂ para elegir `method` (Definición 3.6 extendida).
   */
  decisionConflict: number;
  sourceWeights: number[];
  /**
   * Envolvente exacta según Definición 3.7. Presente únicamente cuando
   * `method === 'envelope'`, que es el único caso en que la salida pretende
   * representar una envolvente. Los consumidores deben preferir este campo a
   * los Bel/Pl derivados de `fused`, que sobre-aproximan el upper.
   */
  envelope?: Envelope;
  /**
   * Conflictos K de cada paso de la reducción secuencial de Dempster.
   * Presente únicamente cuando `method === 'dempster'`.
   *
   * ⚠ NO coinciden con `maxConflict`, que es el K_máx POR PARES de la
   * Definición 3.5. `dempsterCombineMultiple` acumula secuencialmente y el
   * conflicto de un paso intermedio puede superar con mucho al de cualquier
   * par original: la BPA acumulada se concentra y deja de solapar con las
   * fuentes restantes.
   *
   * Contraejemplo hallado por property-based testing (3 hipótesis, K_máx por
   * pares = 0,75): m₁ = {h₀:.5, h₁:.5}, m₂ = {h₁:.5, h₂:.5}, m₃ = {h₂:.5,
   * h₀:.5}. Al fusionar m₁⊕m₂ toda la masa cae en {h₁}, y entonces el
   * conflicto contra m₃ es exactamente 1.
   *
   * Desde que la estrategia decide con {@link FusionResult.decisionConflict},
   * ese régimen es inalcanzable por construcción: K_global < 1 implica que
   * ningún paso intermedio degenera, en ningún orden (propiedad (P2) del
   * JSDoc de `globalConflict`). Estos valores se siguen exponiendo para
   * auditar cuánto se aparta la reducción secuencial del conflicto por pares.
   */
  sequentialConflicts?: number[];
}

/**
 * Conjunto credal — Definición 3.8, §3.5
 *
 * P(m) = { P ∈ Δ(Θ) : P(A) ≥ Bel(A), ∀A ⊆ Θ }
 *
 * Se representa por sus bounds por hipótesis:
 * Para cada θ_j: [Bel({θ_j}), Pl({θ_j})]
 */
export interface CredalSet {
  frame: FrameOfDiscernment;
  bounds: BeliefPlausibility[];
  /** Intervalo credal continuo [x̲, x̄] — Definición 3.9, Ecuación (10), §3.6 */
  continuousInterval: { lower: number; upper: number };
  /** Indicador de conflicto */
  maxConflict: number;
  /** Método de fusión usado */
  fusionMethod: 'dempster' | 'cautious' | 'envelope';
}

/** Configuración de la estrategia de fusión — Definición 3.6, §3.4.2 */
export interface FusionConfig {
  kappa1: number;       // Umbral bajo conflicto (default 0.3)
  kappa2: number;       // Umbral alto conflicto (default 0.7)
  /**
   * Número máximo de fuentes para las que se computa el conflicto global
   * n-ario (default 6). EXTENSIÓN al paper, no un parámetro de la Def. 3.6.
   *
   * `globalConflict` recorre el producto conjunto de las n BPAs: su coste es
   * exponencial en n. El límite hace explícito el régimen de validez —la demo
   * usa 3 fuentes (§7.2)— y por encima de él la función LANZA, en lugar de
   * caer en silencio a la decisión por pares, que es justo la que no acota el
   * conflicto de la reducción secuencial.
   */
  maxSourcesForGlobalConflict: number;
}

export const DEFAULT_FUSION_CONFIG: FusionConfig = {
  kappa1: 0.3,
  kappa2: 0.7,
  maxSourcesForGlobalConflict: 6,
};
