/**
 * AURA v2 — Utilidades generales
 */

/** Redondea a n decimales */
export function round(value: number, decimals: number = 4): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/** Clamp de un valor en [min, max] */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Formatea un intervalo como string */
export function formatInterval(lower: number, upper: number, decimals: number = 2): string {
  return `[${lower.toFixed(decimals)}, ${upper.toFixed(decimals)}]`;
}
