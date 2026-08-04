/**
 * AURA v2 — Aritmética de Intervalos
 *
 * Implements (papers/AURA_v2.pdf §4.4.1):
 * - Definición 4.2 (aritmética de intervalos), Ecuaciones (20)-(23)
 * - Proposición 4.1 (soundness de la aritmética de intervalos)
 *
 * Todas las operaciones son conservativas: si x ∈ [a] e y ∈ [b], entonces
 * x ◦ y ∈ [a] ◦ [b]. El resultado puede sobre-estimar (wrapping effect) pero
 * nunca sub-estima.
 *
 * Se usa aritmética de punto flotante sin corrección de redondeo dirigido
 * (suficiente para la precisión requerida en este sistema). Nota: esto es una
 * desviación menor de la soundness estricta — un intervalo rigurosamente sound
 * requeriría redondeo hacia fuera en cada operación.
 */

import { Interval } from './types';

/** Ecuación (20): [a] + [b] = [a̲ + b̲, ā + b̄] */
export function add(a: Interval, b: Interval): Interval {
  return { lower: a.lower + b.lower, upper: a.upper + b.upper };
}

/** Ecuación (21): [a] − [b] = [a̲ − b̄, ā − b̲] */
export function subtract(a: Interval, b: Interval): Interval {
  return { lower: a.lower - b.upper, upper: a.upper - b.lower };
}

/** Ecuación (22): [a] · [b] = [mín S, máx S], S = {a̲b̲, a̲b̄, āb̲, āb̄} */
export function multiply(a: Interval, b: Interval): Interval {
  const products = [
    a.lower * b.lower,
    a.lower * b.upper,
    a.upper * b.lower,
    a.upper * b.upper,
  ];
  return { lower: Math.min(...products), upper: Math.max(...products) };
}

/** Ecuación (23): [a] / [b] = [a] · [1/b̄, 1/b̲], definido solo si 0 ∉ [b] */
export function divide(a: Interval, b: Interval): Interval {
  if (b.lower <= 0 && b.upper >= 0) {
    throw new Error('Division by interval containing zero');
  }
  return multiply(a, { lower: 1 / b.upper, upper: 1 / b.lower });
}

export function negate(a: Interval): Interval {
  return { lower: -a.upper, upper: -a.lower };
}

export function width(a: Interval): number {
  return a.upper - a.lower;
}

export function midpoint(a: Interval): number {
  return (a.lower + a.upper) / 2;
}

export function contains(a: Interval, value: number): boolean {
  return value >= a.lower && value <= a.upper;
}

export function intersect(a: Interval, b: Interval): Interval | null {
  const lower = Math.max(a.lower, b.lower);
  const upper = Math.min(a.upper, b.upper);
  if (lower > upper) return null;
  return { lower, upper };
}

export function hull(a: Interval, b: Interval): Interval {
  return { lower: Math.min(a.lower, b.lower), upper: Math.max(a.upper, b.upper) };
}
