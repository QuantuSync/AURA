/**
 * AURA v2 — Síntesis de decisiones verificables
 *
 * Implements: Síntesis de decisiones desde reachable set del paper AURA interno.
 */

import { SafetySpec, CertifiedDecision } from './types';
import { Interval } from '../intervals/types';

/**
 * Sintetiza una decisión certificada comparando el reachable set contra la safety spec.
 *
 * @param reachableInterval - Intervalo del reachable set para la variable
 * @param spec - Especificación de seguridad
 */
export function synthesizeDecision(
  reachableInterval: Interval,
  spec: SafetySpec
): CertifiedDecision {
  const { safeRegion } = spec;
  const reachWidth = reachableInterval.upper - reachableInterval.lower;

  // Fracción del reachable set fuera de la safe region
  const overlapLower = Math.max(reachableInterval.lower, safeRegion.lower);
  const overlapUpper = Math.min(reachableInterval.upper, safeRegion.upper);
  const overlapWidth = Math.max(0, overlapUpper - overlapLower);
  const violationFraction = reachWidth > 0 ? 1 - overlapWidth / reachWidth : 0;

  let status: CertifiedDecision['status'];
  let justification: string;

  if (reachableInterval.lower >= safeRegion.lower && reachableInterval.upper <= safeRegion.upper) {
    status = 'safe';
    justification = `Reachable set [${reachableInterval.lower.toFixed(2)}, ${reachableInterval.upper.toFixed(2)}] ⊆ safe region [${safeRegion.lower.toFixed(2)}, ${safeRegion.upper.toFixed(2)}].`;
  } else if (violationFraction >= spec.riskThreshold) {
    status = 'critical';
    justification = `${(violationFraction * 100).toFixed(1)}% of reachable set outside safe region (threshold: ${(spec.riskThreshold * 100).toFixed(0)}%).`;
  } else if (violationFraction > 0) {
    status = 'warning';
    justification = `Partial overlap: ${(violationFraction * 100).toFixed(1)}% of reachable set may violate safe region.`;
  } else {
    status = 'unknown';
    justification = 'Unable to determine status.';
  }

  return {
    status,
    reachableInterval,
    spec,
    violationFraction,
    justification,
    timestamp: Date.now(),
  };
}
