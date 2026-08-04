/**
 * AURA v2 — Detección y cuantificación de conflicto
 *
 * Implementa: Definición 3.6 (conflicto por pares) y la estrategia
 * de fusión escalonada del paper AURA interno.
 */

import { BPA, FusionConfig, DEFAULT_FUSION_CONFIG } from './types';

/**
 * Calcula el factor de conflicto K entre dos BPAs.
 *
 * Paper ref: Ecuación (4).
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
 * Paper ref: Definición 3.6.
 * K_ij = conflicto entre fuente i y fuente j.
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
 * Determina el nivel de conflicto y la estrategia de fusión a aplicar.
 *
 * Paper ref: Definición 3.6 (estrategia escalonada).
 *
 * - K_max ≤ κ₁: "low" → Dempster
 * - κ₁ < K_max ≤ κ₂: "moderate" → Media cautelosa
 * - K_max > κ₂: "high" → Envolvente conservativa
 */
export function assessConflict(
  bpas: BPA[],
  config: FusionConfig = DEFAULT_FUSION_CONFIG
): {
  matrix: number[][];
  maxConflict: number;
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

  let level: 'low' | 'moderate' | 'high';
  let method: 'dempster' | 'cautious' | 'envelope';

  if (maxConflict <= config.kappa1) {
    level = 'low';
    method = 'dempster';
  } else if (maxConflict <= config.kappa2) {
    level = 'moderate';
    method = 'cautious';
  } else {
    level = 'high';
    method = 'envelope';
  }

  return { matrix, maxConflict, level, method };
}
