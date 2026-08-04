/**
 * AURA v2 — Dempster-Shafer Types
 *
 * Implements: Definiciones 3.1, 3.2, 3.3, 3.5 del paper AURA interno.
 *
 * El marco de discernimiento Θ se representa como un array de intervalos.
 * Cada intervalo es una hipótesis sobre el valor de una variable.
 */

/** Un intervalo [lower, upper) representando una hipótesis */
export interface Hypothesis {
  label: string;        // e.g., "nula", "ligera", "moderada"
  lower: number;        // Límite inferior (inclusivo)
  upper: number;        // Límite superior (exclusivo, excepto el último)
}

/** Marco de discernimiento: conjunto exhaustivo de hipótesis */
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

/** Resultado de fusión con metadatos */
export interface FusionResult {
  fused: BPA;
  method: 'dempster' | 'cautious' | 'envelope';
  conflictMatrix: number[][];
  maxConflict: number;
  sourceWeights: number[];
}

/**
 * Conjunto credal — Definición 3.5
 *
 * P(m) = { P ∈ Δ(Θ) : P(A) ≥ Bel(A), ∀A ⊆ Θ }
 *
 * Se representa por sus bounds por hipótesis:
 * Para cada θ_j: [Bel({θ_j}), Pl({θ_j})]
 */
export interface CredalSet {
  frame: FrameOfDiscernment;
  bounds: BeliefPlausibility[];
  /** Intervalo credal continuo [x_min, x_max] — Definición 3.9 */
  continuousInterval: { lower: number; upper: number };
  /** Indicador de conflicto */
  maxConflict: number;
  /** Método de fusión usado */
  fusionMethod: 'dempster' | 'cautious' | 'envelope';
}

/** Configuración de la estrategia de fusión — Definición 3.6 */
export interface FusionConfig {
  kappa1: number;       // Umbral bajo conflicto (default 0.3)
  kappa2: number;       // Umbral alto conflicto (default 0.7)
}

export const DEFAULT_FUSION_CONFIG: FusionConfig = {
  kappa1: 0.3,
  kappa2: 0.7,
};
