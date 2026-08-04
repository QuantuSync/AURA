/**
 * AURA v2 — Cliente Open-Meteo API
 *
 * Open-Meteo proporciona datos meteorológicos gratuitos y de alta resolución.
 * API docs: https://open-meteo.com/en/docs
 */

import { WeatherMeasurement } from './types';

export async function fetchOpenMeteo(
  latitude: number,
  longitude: number
): Promise<WeatherMeasurement> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=precipitation,wind_speed_10m,temperature_2m&wind_speed_unit=kmh`;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Open-Meteo API error: ${response.status}`);

  const data = await response.json();
  const current = data.current;

  return {
    sourceId: 'open-meteo',
    timestamp: Date.now(),
    latitude,
    longitude,
    precipitation: current.precipitation ?? 0,
    precipitationStddev: 1.5,  // Incertidumbre instrumental estimada
    windSpeed: current.wind_speed_10m ?? 0,
    windSpeedStddev: 2.0,
    temperature: current.temperature_2m ?? 0,
    temperatureStddev: 0.5,
    failureRate: 0.05,
  };
}
