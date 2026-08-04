/**
 * AURA v2 — Construcción de BPAs
 *
 * Implementa: Definición 3.4 del paper AURA interno.
 *
 * Convierte mediciones (valor ± incertidumbre) en Basic Probability Assignments
 * sobre un marco de discernimiento discreto.
 */

import { BPA, FocalElement, FrameOfDiscernment } from './types';

/**
 * Función de distribución normal acumulativa (CDF).
 * Aproximación de Abramowitz & Stegun, precisión ~1.5e-7.
 */
function normalCDF(x: number, mean: number, stddev: number): number {
  const z = (x - mean) / stddev;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327; // 1 / sqrt(2π)
  const p =
    d *
    Math.exp(-0.5 * z * z) *
    (t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))));
  return z >= 0 ? 1 - p : p;
}

/**
 * Construye una BPA a partir de una medición gaussiana.
 *
 * Paper ref: Definición 3.4, Ecuaciones (8) y (9).
 *
 * @param frame - Marco de discernimiento
 * @param value - Valor medido (media de la gaussiana)
 * @param stddev - Desviación estándar de la medición
 * @param failureRate - Tasa de fallo δ_i de la fuente (default 0)
 * @param sourceId - Identificador de la fuente
 * @param timestamp - Timestamp de la medición
 */
export function createBPAFromGaussian(
  frame: FrameOfDiscernment,
  value: number,
  stddev: number,
  failureRate: number = 0,
  sourceId: string = '',
  timestamp: number = Date.now()
): BPA {
  if (stddev <= 0) throw new Error('stddev must be positive');
  if (failureRate < 0 || failureRate >= 1) throw new Error('failureRate must be in [0, 1)');

  const n = frame.hypotheses.length;
  const focalElements: FocalElement[] = [];

  // Asignar masa a cada singleton {θ_j} — Ecuación (8)
  for (let j = 0; j < n; j++) {
    const h = frame.hypotheses[j];
    const lower = h.lower;
    const upper = h.upper;

    // Probabilidad de que X caiga en [lower, upper) bajo N(value, stddev²)
    const pLower = normalCDF(lower, value, stddev);
    const pUpper = upper === Infinity ? 1 : normalCDF(upper, value, stddev);
    const mass = (1 - failureRate) * (pUpper - pLower);

    if (mass > 1e-10) {
      focalElements.push({ indices: [j], mass });
    }
  }

  // Asignar masa residual a Θ (ignorancia) — Ecuación (9)
  if (failureRate > 1e-10) {
    const allIndices = Array.from({ length: n }, (_, i) => i);
    focalElements.push({ indices: allIndices, mass: failureRate });
  }

  // Normalizar para corregir errores numéricos
  const totalMass = focalElements.reduce((sum, fe) => sum + fe.mass, 0);
  if (Math.abs(totalMass - 1) > 1e-6) {
    for (const fe of focalElements) {
      fe.mass /= totalMass;
    }
  }

  return { frame, focalElements, sourceId, timestamp };
}

/**
 * Construye una BPA uniforme (ignorancia total).
 * Toda la masa va a Θ.
 */
export function createIgnorantBPA(
  frame: FrameOfDiscernment,
  sourceId: string = '',
  timestamp: number = Date.now()
): BPA {
  const allIndices = Array.from({ length: frame.hypotheses.length }, (_, i) => i);
  return {
    frame,
    focalElements: [{ indices: allIndices, mass: 1.0 }],
    sourceId,
    timestamp,
  };
}

/**
 * Calcula Bel(A) y Pl(A) para un singleton {θ_j}.
 *
 * Paper ref: Definición 3.3, Ecuaciones (1) y (2).
 */
export function beliefAndPlausibility(
  bpa: BPA,
  hypothesisIndex: number
): { belief: number; plausibility: number } {
  let belief = 0;
  let plausibility = 0;

  for (const fe of bpa.focalElements) {
    const isSubset = fe.indices.length === 1 && fe.indices[0] === hypothesisIndex;
    const intersects = fe.indices.includes(hypothesisIndex);

    if (isSubset) belief += fe.mass;
    if (intersects) plausibility += fe.mass;
  }

  return { belief, plausibility };
}

/**
 * Calcula Bel(A) y Pl(A) para todos los singletons del marco.
 */
export function allBeliefPlausibility(bpa: BPA): { belief: number; plausibility: number }[] {
  return bpa.frame.hypotheses.map((_, j) => beliefAndPlausibility(bpa, j));
}
