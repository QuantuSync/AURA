/**
 * AURA v2 — Data Source Types
 */

export interface WeatherMeasurement {
  sourceId: string;
  timestamp: number;
  latitude: number;
  longitude: number;
  precipitation: number;   // mm/h
  precipitationStddev: number;
  windSpeed: number;       // km/h
  windSpeedStddev: number;
  temperature: number;     // °C
  temperatureStddev: number;
  failureRate: number;     // δ ∈ [0, 1)
}
