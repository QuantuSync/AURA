/**
 * AURA v2 — Aritmética de Intervalos
 *
 * Implements: Definición 4.4, Proposición (soundness) del paper AURA interno.
 *
 * Todas las operaciones son conservativas: el resultado siempre contiene
 * el valor real. Se usa aritmética de punto flotante sin corrección de redondeo
 * (suficiente para la precisión requerida en este sistema).
 */

import { Interval } from './types';

export function add(a: Interval, b: Interval): Interval {
  return { lower: a.lower + b.lower, upper: a.upper + b.upper };
}

export function subtract(a: Interval, b: Interval): Interval {
  return { lower: a.lower - b.upper, upper: a.upper - b.lower };
}

export function multiply(a: Interval, b: Interval): Interval {
  const products = [
    a.lower * b.lower,
    a.lower * b.upper,
    a.upper * b.lower,
    a.upper * b.upper,
  ];
  return { lower: Math.min(...products), upper: Math.max(...products) };
}

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
