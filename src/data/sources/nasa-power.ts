/**
 * AURA v2 — Cliente NASA POWER API
 *
 * NASA POWER: https://power.larc.nasa.gov/
 * Proporciona datos de reanálisis con cobertura global.
 */

import { WeatherMeasurement } from './types';

export async function fetchNASAPOWER(
  latitude: number,
  longitude: number
): Promise<WeatherMeasurement> {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const dateStr = yesterday.toISOString().slice(0, 10).replace(/-/g, '');

  const url = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR,WS10M,T2M&community=RE&longitude=${longitude}&latitude=${latitude}&start=${dateStr}&end=${dateStr}&format=JSON`;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`NASA POWER API error: ${response.status}`);

  const data = await response.json();
  const params = data.properties.parameter;

  return {
    sourceId: 'nasa-power',
    timestamp: Date.now(),
    latitude,
    longitude,
    precipitation: params.PRECTOTCORR[dateStr] ?? 0,
    precipitationStddev: 2.0,
    windSpeed: (params.WS10M[dateStr] ?? 0) * 3.6,  // m/s → km/h
    windSpeedStddev: 3.0,
    temperature: params.T2M[dateStr] ?? 0,
    temperatureStddev: 1.0,
    failureRate: 0.08,
  };
}
