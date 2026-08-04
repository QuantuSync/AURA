/**
 * AURA v2 — Interval Types
 *
 * Implements: Definición 4.2 (aritmética de intervalos), papers/AURA_v2.pdf §4.4.1.
 */

/** Intervalo cerrado [lower, upper] */
export interface Interval {
  lower: number;
  upper: number;
}
