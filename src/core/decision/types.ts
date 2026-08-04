/**
 * AURA v2 — Decision Types
 *
 * Tipos para la síntesis de decisiones verificables desde el reachable set.
 */

import { Interval } from '../intervals/types';

export interface SafetySpec {
  /** Variable a verificar */
  variable: string;
  /** Intervalo seguro: la variable debe permanecer en este rango */
  safeRegion: Interval;
  /** Umbral de riesgo: P(violación) por encima de este valor → alarma */
  riskThreshold: number;
}

export type DecisionStatus = 'safe' | 'warning' | 'critical' | 'unknown';

export interface CertifiedDecision {
  status: DecisionStatus;
  /** Intervalo del reachable set para la variable de interés */
  reachableInterval: Interval;
  /** Spec que generó esta decisión */
  spec: SafetySpec;
  /** Fracción del reachable set fuera de la safe region */
  violationFraction: number;
  /** Justificación formal */
  justification: string;
  timestamp: number;
}
