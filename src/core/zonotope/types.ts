/**
 * AURA v2 — Zonotope Types
 *
 * Implements: Definición 5.1 del paper AURA interno.
 *
 * Un zonotopo Z = <c, G> donde:
 *   c ∈ ℝⁿ es el centro
 *   G = [g₁ | g₂ | ... | gₖ] ∈ ℝⁿˣᵏ son los generadores
 *   Z = { c + Σᵢ εᵢ gᵢ : εᵢ ∈ [-1, 1] }
 */

export interface Zonotope {
  /** Centro del zonotopo (vector n-dimensional) */
  center: number[];
  /** Generadores (matriz n×k, cada columna es un generador) */
  generators: number[][];
  /** Dimensión del espacio */
  dimension: number;
}
