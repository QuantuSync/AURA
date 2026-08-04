/**
 * AURA v2 — Conjuntos Credales
 *
 * Implementa: Definición 3.5 (conjunto credal), Proposición 3.5 (cobertura),
 * Proposición 3.6 (equivalencia envolvente-credal), Definición 3.9 (intervalo continuo).
 *
 * Esta es la representación UNIFICADA de la salida de la Capa 1.
 * Independientemente del método de fusión, la salida es siempre un CredalSet.
 */

import { BPA, CredalSet, FusionResult } from './types';
import { allBeliefPlausibility } from './bpa';

/**
 * Construye un CredalSet a partir del resultado de fusión.
 *
 * Paper ref: Definición 3.5 + Definición 3.9.
 *
 * El CredalSet contiene:
 * - bounds [Bel({θ_j}), Pl({θ_j})] para cada hipótesis
 * - intervalo credal continuo [x_min, x_max]
 * - metadatos de conflicto y método
 */
export function buildCredalSet(fusionResult: FusionResult): CredalSet {
  const { fused, method, maxConflict } = fusionResult;
  const bp = allBeliefPlausibility(fused);
  const frame = fused.frame;

  const bounds = bp.map((b, j) => ({
    hypothesis: j,
    belief: b.belief,
    plausibility: b.plausibility,
  }));

  // Intervalo credal continuo — Definición 3.9, Ecuación (14)
  // Unión de todos los intervalos con plausibilidad > 0
  let lower = Infinity;
  let upper = -Infinity;

  for (let j = 0; j < frame.hypotheses.length; j++) {
    if (bp[j].plausibility > 1e-10) {
      lower = Math.min(lower, frame.hypotheses[j].lower);
      upper = Math.max(upper, frame.hypotheses[j].upper);
    }
  }

  // Manejar el caso de upper = Infinity (último intervalo abierto)
  // Para propagación numérica, necesitamos un bound finito.
  // Usar el máximo valor con plausibilidad significativa + margen.
  if (!isFinite(upper)) {
    // Buscar el último intervalo con Pl > umbral
    const significantHypotheses = bounds.filter((b) => b.plausibility > 0.01);
    if (significantHypotheses.length > 0) {
      const lastSignificant = significantHypotheses[significantHypotheses.length - 1];
      const h = frame.hypotheses[lastSignificant.hypothesis];
      // Si el intervalo es abierto, usar el lower * 2 como upper práctico
      upper = isFinite(h.upper) ? h.upper : h.lower * 2;
    } else {
      upper = frame.hypotheses[frame.hypotheses.length - 1].lower * 2;
    }
  }

  return {
    frame,
    bounds,
    continuousInterval: { lower, upper },
    maxConflict,
    fusionMethod: method,
  };
}

/**
 * Verifica la propiedad de cobertura (Proposición 3.5):
 * Para todo θ_j: Bel({θ_j}) ≤ Pl({θ_j})
 *
 * Esto debe ser siempre true por construcción. Si no lo es, hay un bug.
 */
export function verifyCoverage(credalSet: CredalSet): boolean {
  return credalSet.bounds.every((b) => b.belief <= b.plausibility + 1e-10);
}

/**
 * Calcula el "ancho" de la ignorancia para cada hipótesis.
 * Pl(θ_j) - Bel(θ_j): cuanto mayor, más ignorancia sobre esa hipótesis.
 */
export function ignoranceWidth(credalSet: CredalSet): number[] {
  return credalSet.bounds.map((b) => b.plausibility - b.belief);
}

/**
 * Calcula la ignorancia total del conjunto credal.
 * Suma de (Pl - Bel) sobre todas las hipótesis, normalizada.
 * 0 = conocimiento perfecto, 1 = ignorancia total.
 */
export function totalIgnorance(credalSet: CredalSet): number {
  const widths = ignoranceWidth(credalSet);
  const total = widths.reduce((s, w) => s + w, 0);
  // Normalizar: máxima ignorancia es cuando Bel=0, Pl=1 para todas → total = n
  return total / credalSet.bounds.length;
}
