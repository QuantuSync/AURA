/**
 * AURA v2 — Cliente AEMET OpenData API
 *
 * AEMET OpenData: https://opendata.aemet.es
 * Requiere API key (gratuita con registro).
 */

import { WeatherMeasurement } from './types';

export async function fetchAEMET(
  latitude: number,
  longitude: number,
  apiKey: string
): Promise<WeatherMeasurement> {
  // AEMET no tiene endpoint de punto directo; se obtiene la estación más cercana
  // Aquí se usa el endpoint de observación en tiempo real
  const stationUrl = `https://opendata.aemet.es/opendata/api/observacion/convencional/todas/?api_key=${apiKey}`;

  const response = await fetch(stationUrl);
  if (!response.ok) throw new Error(`AEMET API error: ${response.status}`);

  const meta = await response.json();
  const dataResponse = await fetch(meta.datos);
  if (!dataResponse.ok) throw new Error(`AEMET data fetch error: ${dataResponse.status}`);

  const stations: Record<string, unknown>[] = await dataResponse.json();

  // Encontrar la estación más cercana
  let nearest = stations[0];
  let minDist = Infinity;
  for (const s of stations) {
    const dlat = (s['lat'] as number) - latitude;
    const dlon = (s['lon'] as number) - longitude;
    const dist = Math.sqrt(dlat * dlat + dlon * dlon);
    if (dist < minDist) { minDist = dist; nearest = s; }
  }

  return {
    sourceId: 'aemet',
    timestamp: Date.now(),
    latitude,
    longitude,
    precipitation: (nearest['prec'] as number) ?? 0,
    precipitationStddev: 0.5,
    windSpeed: (nearest['vv'] as number) ?? 0,
    windSpeedStddev: 1.0,
    temperature: (nearest['ta'] as number) ?? 0,
    temperatureStddev: 0.3,
    failureRate: 0.03,
  };
}
