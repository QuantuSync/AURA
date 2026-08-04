/**
 * AURA v2 — Cliente AEMET OpenData API
 *
 * AEMET OpenData: https://opendata.aemet.es
 * Requiere API key (gratuita con registro).
 *
 * La API responde en DOS PASOS: la petición al endpoint devuelve un sobre con
 * `estado`, `descripcion` y una URL `datos` de un solo uso; los datos reales se
 * descargan de esa segunda URL. El modo offline reproduce los dos pasos
 * (`aemet-metadata.json` + `aemet-observacion.json`) en lugar de saltarse el
 * sobre, para que el fixture sea un registro fiel del intercambio real.
 */

import { WeatherMeasurement } from './types';
import { AEMET_CHARACTERIZATION } from './characterization';
import { isOffline, loadFixture, parseUtcTimestamp, SourceFetchConfig } from './offline';

/** Sobre de respuesta de AEMET OpenData. */
export interface AemetEnvelope {
  descripcion: string;
  estado: number;
  datos: string;
  metadatos?: string;
}

/**
 * Observación convencional de una estación. AEMET omite los campos que la
 * estación no reporta, de ahí que todo sea opcional salvo la identificación.
 */
export interface AemetObservation {
  idema: string;
  ubi?: string;
  lat: number;
  lon: number;
  fint: string;
  /** Precipitación acumulada en la última hora (mm) = mm/h. */
  prec?: number;
  /** Velocidad media del viento (m/s). */
  vv?: number;
  /** Temperatura del aire (°C). */
  ta?: number;
  [key: string]: unknown;
}

export const AEMET_METADATA_FIXTURE = 'aemet-metadata.json';
export const AEMET_OBSERVACION_FIXTURE = 'aemet-observacion.json';

/** m/s → km/h. AEMET reporta `vv` en m/s; el marco de viento es km/h. */
const MS_TO_KMH = 3.6;

export function aemetUrl(apiKey: string): string {
  return `https://opendata.aemet.es/opendata/api/observacion/convencional/todas/?api_key=${apiKey}`;
}

/**
 * Estación más cercana al punto pedido, por distancia euclídea en grados.
 *
 * Es una aproximación deliberada: sobre el entorno de una ciudad (décimas de
 * grado) el error frente a la distancia geodésica es irrelevante para *ordenar*
 * candidatas, que es lo único que se hace con ella.
 *
 * DESEMPATE DETERMINISTA por `idema`: sin él, dos estaciones equidistantes
 * darían resultados distintos según el orden en que AEMET las devuelva, y el
 * pipeline dejaría de ser reproducible.
 */
export function nearestStation(
  stations: readonly AemetObservation[],
  latitude: number,
  longitude: number
): AemetObservation {
  if (stations.length === 0) {
    throw new Error('AEMET: la respuesta no contiene ninguna estación.');
  }

  let best = stations[0];
  let bestDist = Infinity;
  for (const s of stations) {
    const dlat = s.lat - latitude;
    const dlon = s.lon - longitude;
    const dist = Math.sqrt(dlat * dlat + dlon * dlon);
    if (dist < bestDist || (dist === bestDist && s.idema < best.idema)) {
      bestDist = dist;
      best = s;
    }
  }
  return best;
}

/**
 * Interpreta el array de observaciones como medición del marco.
 *
 * TIMESTAMP: el `fint` de la estación elegida, en UTC (ver `parseUtcTimestamp`).
 */
export function parseAemet(
  stations: readonly AemetObservation[],
  latitude: number,
  longitude: number
): WeatherMeasurement {
  const nearest = nearestStation(stations, latitude, longitude);
  const c = AEMET_CHARACTERIZATION;

  return {
    sourceId: c.sourceId,
    timestamp: parseUtcTimestamp(nearest.fint),
    latitude,
    longitude,
    precipitation: nearest.prec ?? 0,
    precipitationStddev: c.precipitationStddev,
    windSpeed: (nearest.vv ?? 0) * MS_TO_KMH,
    windSpeedStddev: c.windSpeedStddev,
    temperature: nearest.ta ?? 0,
    temperatureStddev: c.temperatureStddev,
    failureRate: c.failureRate,
  };
}

export async function fetchAEMET(
  latitude: number,
  longitude: number,
  apiKey: string,
  config?: SourceFetchConfig
): Promise<WeatherMeasurement> {
  if (isOffline(config)) {
    const envelope = await loadFixture<AemetEnvelope>(AEMET_METADATA_FIXTURE, config);
    if (envelope.estado !== 200) {
      throw new Error(`AEMET API error: estado ${envelope.estado} (${envelope.descripcion})`);
    }
    const stations = await loadFixture<AemetObservation[]>(AEMET_OBSERVACION_FIXTURE, config);
    return parseAemet(stations, latitude, longitude);
  }

  const response = await fetch(aemetUrl(apiKey));
  if (!response.ok) throw new Error(`AEMET API error: ${response.status}`);

  const envelope = (await response.json()) as AemetEnvelope;
  if (envelope.estado !== 200) {
    throw new Error(`AEMET API error: estado ${envelope.estado} (${envelope.descripcion})`);
  }

  const dataResponse = await fetch(envelope.datos);
  if (!dataResponse.ok) throw new Error(`AEMET data fetch error: ${dataResponse.status}`);

  return parseAemet((await dataResponse.json()) as AemetObservation[], latitude, longitude);
}
