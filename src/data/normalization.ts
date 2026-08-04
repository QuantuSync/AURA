/**
 * AURA v2 — Normalización y alineación temporal de fuentes
 */

import { WeatherMeasurement } from './sources/types';

/**
 * Filtra mediciones demasiado antiguas para la fusión.
 * @param measurements - Lista de mediciones
 * @param maxAgeMs - Antigüedad máxima en ms (default 1h)
 */
export function filterByAge(
  measurements: WeatherMeasurement[],
  maxAgeMs: number = 60 * 60 * 1000
): WeatherMeasurement[] {
  const now = Date.now();
  return measurements.filter((m) => now - m.timestamp <= maxAgeMs);
}

/**
 * Extrae los valores de una variable específica como array de
 * { value, stddev, failureRate, sourceId }.
 */
export function extractVariable(
  measurements: WeatherMeasurement[],
  variable: 'precipitation' | 'windSpeed' | 'temperature'
): { value: number; stddev: number; failureRate: number; sourceId: string }[] {
  return measurements.map((m) => ({
    value: m[variable],
    stddev: m[`${variable}Stddev` as keyof WeatherMeasurement] as number,
    failureRate: m.failureRate,
    sourceId: m.sourceId,
  }));
}
