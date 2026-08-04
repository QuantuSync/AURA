/**
 * AURA v2 — Ingesta de las tres fuentes
 *
 * Punto único desde el que el pipeline obtiene las mediciones, en red o desde
 * fixtures según {@link SourceFetchConfig}.
 */

import { WeatherMeasurement } from './sources/types';
import { SourceFetchConfig, isOffline } from './sources/offline';
import { fetchAEMET } from './sources/aemet';
import { fetchOpenMeteo } from './sources/open-meteo';
import { fetchNASAPOWER } from './sources/nasa-power';

/** Emplazamiento de la demo (§7 del paper). */
export const DEMO_LOCATION = {
  name: 'Madrid-Chamartín',
  latitude: 40.4718,
  longitude: -3.6828,
} as const;

export interface IngestParams extends SourceFetchConfig {
  latitude?: number;
  longitude?: number;
  /** Clave de AEMET OpenData. Innecesaria en modo offline. */
  aemetApiKey?: string;
}

/**
 * ORDEN FIJO de las fuentes: `aemet`, `open-meteo`, `nasa-power`.
 *
 * No es cosmético. `FusionResult` expone `conflictMatrix`, `sourceWeights` y
 * `sequentialConflicts`, todos indexados por posición, y la reducción secuencial
 * de Dempster recorre las BPAs en el orden dado. Un orden que dependiera de qué
 * petición HTTP conteste antes haría irreproducibles esos campos. Es además el
 * orden de `DEMO_SOURCES_LIGHT_RAIN`, lo que permite comparar directamente el
 * escenario reproducido con el de referencia.
 */
export const SOURCE_ORDER = ['aemet', 'open-meteo', 'nasa-power'] as const;

/**
 * Obtiene las tres mediciones, en {@link SOURCE_ORDER}.
 *
 * @throws si falta la clave de AEMET estando en modo online — antes se enviaba
 *         `undefined` en la query y la API respondía un 401 opaco.
 */
export async function ingestAll(params: IngestParams = {}): Promise<WeatherMeasurement[]> {
  const {
    latitude = DEMO_LOCATION.latitude,
    longitude = DEMO_LOCATION.longitude,
    aemetApiKey,
    ...config
  } = params;

  if (!isOffline(config) && !aemetApiKey) {
    throw new Error(
      'ingestAll: AEMET OpenData exige API key en modo online. Pásala en ' +
        '`aemetApiKey`, o usa el modo offline (AURA_OFFLINE=1) para leer de fixtures.'
    );
  }

  // Secuencial y en orden: son tres peticiones y la reproducibilidad de los
  // campos indexados por posición importa más que ahorrar unos milisegundos.
  const aemet = await fetchAEMET(latitude, longitude, aemetApiKey ?? '', config);
  const openMeteo = await fetchOpenMeteo(latitude, longitude, config);
  const nasa = await fetchNASAPOWER(latitude, longitude, config);

  return [aemet, openMeteo, nasa];
}
