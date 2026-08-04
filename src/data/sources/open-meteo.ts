/**
 * AURA v2 — Cliente Open-Meteo API
 *
 * Open-Meteo proporciona datos meteorológicos gratuitos y de alta resolución.
 * API docs: https://open-meteo.com/en/docs
 *
 * El transporte (red o fixture) está separado del PARSEO (`parseOpenMeteo`),
 * que es una función pura: es lo que permite testear la interpretación de la
 * respuesta sin tocar la red y reproducir el pipeline byte a byte.
 */

import { WeatherMeasurement } from './types';
import { OPEN_METEO_CHARACTERIZATION } from './characterization';
import { isOffline, loadFixture, parseUtcTimestamp, SourceFetchConfig } from './offline';

/** Forma de la respuesta de `/v1/forecast` con `current=...`. */
export interface OpenMeteoResponse {
  latitude: number;
  longitude: number;
  current_units?: Record<string, string>;
  current: {
    time: string;
    interval: number;
    precipitation?: number;
    wind_speed_10m?: number;
    temperature_2m?: number;
  };
}

export const OPEN_METEO_FIXTURE = 'open-meteo.json';

export function openMeteoUrl(latitude: number, longitude: number): string {
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
    `&current=precipitation,wind_speed_10m,temperature_2m&wind_speed_unit=kmh`
  );
}

/**
 * Interpreta una respuesta de Open-Meteo como medición del marco.
 *
 * UNIDADES. `current.precipitation` es el acumulado de la hora precedente en mm
 * (`current_units.precipitation === 'mm'`), que sobre una hora es directamente
 * mm/h — el marco de `PRECIPITATION_FRAME`. `wind_speed_10m` se pide ya en km/h
 * vía `wind_speed_unit=kmh`.
 *
 * TIMESTAMP. Se usa el instante de la OBSERVACIÓN (`current.time`), no el de la
 * descarga: es lo que `filterByAge` necesita para decidir si una medición está
 * caduca, y lo que hace el resultado independiente de cuándo se ejecutó.
 */
export function parseOpenMeteo(
  data: OpenMeteoResponse,
  latitude: number,
  longitude: number
): WeatherMeasurement {
  const current = data.current;
  if (!current) {
    throw new Error("Open-Meteo: respuesta sin bloque 'current'.");
  }

  const c = OPEN_METEO_CHARACTERIZATION;

  return {
    sourceId: c.sourceId,
    timestamp: parseUtcTimestamp(current.time),
    latitude,
    longitude,
    precipitation: current.precipitation ?? 0,
    precipitationStddev: c.precipitationStddev,
    windSpeed: current.wind_speed_10m ?? 0,
    windSpeedStddev: c.windSpeedStddev,
    temperature: current.temperature_2m ?? 0,
    temperatureStddev: c.temperatureStddev,
    failureRate: c.failureRate,
  };
}

export async function fetchOpenMeteo(
  latitude: number,
  longitude: number,
  config?: SourceFetchConfig
): Promise<WeatherMeasurement> {
  if (isOffline(config)) {
    const data = await loadFixture<OpenMeteoResponse>(OPEN_METEO_FIXTURE, config);
    return parseOpenMeteo(data, latitude, longitude);
  }

  const response = await fetch(openMeteoUrl(latitude, longitude));
  if (!response.ok) throw new Error(`Open-Meteo API error: ${response.status}`);

  return parseOpenMeteo((await response.json()) as OpenMeteoResponse, latitude, longitude);
}
