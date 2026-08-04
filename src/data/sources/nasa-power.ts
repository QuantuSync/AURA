/**
 * AURA v2 — Cliente NASA POWER API
 *
 * NASA POWER: https://power.larc.nasa.gov/
 * Proporciona datos de reanálisis con cobertura global.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DOS CORRECCIONES RESPECTO DE LA VERSIÓN ANTERIOR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * (1) UNIDAD DE `PRECTOTCORR`: era mm/day leída como mm/h — un factor 24.
 *
 *     POWER documenta `PRECTOTCORR` en **mm/day** en los dos endpoints, y en el
 *     horario el valor es la TASA instantánea expresada por día. Verificado
 *     empíricamente contra la propia API (Madrid-Chamartín, 2026-03-10): las 24
 *     horas suman 85,22 y su MEDIA, 3,551, es exactamente el valor diario 3,55.
 *     Es decir, el acumulado real del día es Σ(horarias)/24 = 3,55 mm.
 *
 *     La versión anterior escribía `params.PRECTOTCORR[dateStr]` directamente en
 *     un campo declarado mm/h, sin convertir — mientras que sí convertía
 *     `WS10M` de m/s a km/h tres líneas más abajo. La falta de conversión era un
 *     descuido, no una decisión: se corrige dividiendo por
 *     {@link MM_PER_DAY_TO_MM_PER_HOUR}.
 *
 * (2) ENDPOINT DIARIO → HORARIO.
 *
 *     El marco de discernimiento es de INTENSIDAD (mm/h) y el DAG de la demo
 *     integra sobre un horizonte de 2 h. Un acumulado diario no puede
 *     representar una tormenta de 45 mm/h: repartido sobre 24 h da 1,9 mm/h, y
 *     la fusión colocaría toda la masa en la hipótesis *nula*. El producto
 *     correcto para este marco es la serie horaria.
 *
 * Ninguna de las dos afecta a los números publicados del pipeline de la demo,
 * que parten de `DemoSource` explícitos y no de esta ingesta.
 */

import { WeatherMeasurement } from './types';
import { NASA_POWER_CHARACTERIZATION } from './characterization';
import { isOffline, loadFixture, SourceFetchConfig } from './offline';

/** Forma de la respuesta de `/api/temporal/hourly/point`. */
export interface NasaPowerResponse {
  properties: {
    parameter: {
      PRECTOTCORR: Record<string, number>;
      WS10M: Record<string, number>;
      T2M: Record<string, number>;
    };
  };
  header?: { fill_value?: number };
}

export const NASA_POWER_FIXTURE = 'nasa-power.json';

/**
 * `PRECTOTCORR` viene en mm/day también en el endpoint horario, donde es la
 * tasa instantánea expresada por día. mm/h = mm/day ÷ 24.
 */
export const MM_PER_DAY_TO_MM_PER_HOUR = 24;

/** m/s → km/h. */
const MS_TO_KMH = 3.6;

/**
 * Umbral de dato ausente. POWER marca los huecos con `header.fill_value`
 * (−999.0). Se compara con holgura porque el valor llega como número de coma
 * flotante y ninguna magnitud física de este marco es negativa: cualquier
 * lectura por debajo de −900 es un hueco, no una medida.
 */
const FILL_THRESHOLD = -900;

export function nasaPowerUrl(latitude: number, longitude: number, dateStr: string): string {
  return (
    `https://power.larc.nasa.gov/api/temporal/hourly/point?parameters=PRECTOTCORR,WS10M,T2M` +
    `&community=RE&longitude=${longitude}&latitude=${latitude}` +
    `&start=${dateStr}&end=${dateStr}&format=JSON`
  );
}

/** `YYYYMMDD` del día anterior al instante dado, en UTC. */
export function previousDayStamp(now: number = Date.now()): string {
  const d = new Date(now - 24 * 60 * 60 * 1000);
  return (
    `${d.getUTCFullYear()}` +
    `${String(d.getUTCMonth() + 1).padStart(2, '0')}` +
    `${String(d.getUTCDate()).padStart(2, '0')}`
  );
}

/** `YYYYMMDDHH` (hora LST de POWER) → epoch ms, interpretando la hora como UTC. */
function hourKeyToTimestamp(key: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})$/.exec(key);
  if (!m) throw new Error(`NASA POWER: clave horaria no reconocida '${key}'.`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]));
}

/**
 * Última hora con dato válido en LAS TRES variables.
 *
 * POWER publica la serie del día completo aunque el reanálisis aún no haya
 * llegado a las últimas horas, rellenando con `fill_value`. Tomar la última
 * clave sin comprobar devolvería −999 como si fuera una medida — un valor que
 * la Def. 3.4 metería en el marco como precipitación negativa.
 *
 * Se exige que las tres variables sean válidas EN LA MISMA hora para que la
 * medición resultante describa un único instante y no una mezcla de instantes.
 */
export function latestValidHour(data: NasaPowerResponse): string {
  const p = data.properties?.parameter;
  if (!p?.PRECTOTCORR) {
    throw new Error('NASA POWER: respuesta sin properties.parameter.PRECTOTCORR.');
  }

  const keys = Object.keys(p.PRECTOTCORR).sort();
  for (let i = keys.length - 1; i >= 0; i--) {
    const k = keys[i];
    const values = [p.PRECTOTCORR[k], p.WS10M?.[k], p.T2M?.[k]];
    if (values.every((v) => typeof v === 'number' && v > FILL_THRESHOLD)) {
      return k;
    }
  }

  throw new Error(
    `NASA POWER: ninguna de las ${keys.length} horas devueltas tiene dato válido ` +
      `simultáneo en PRECTOTCORR, WS10M y T2M (todas marcadas con fill_value). ` +
      `El reanálisis tiene latencia: pide un día anterior.`
  );
}

/**
 * Interpreta una respuesta horaria de POWER como medición del marco.
 *
 * TIMESTAMP: el instante de la hora elegida, no el de la descarga.
 */
export function parseNasaPower(
  data: NasaPowerResponse,
  latitude: number,
  longitude: number
): WeatherMeasurement {
  const hour = latestValidHour(data);
  const p = data.properties.parameter;
  const c = NASA_POWER_CHARACTERIZATION;

  return {
    sourceId: c.sourceId,
    timestamp: hourKeyToTimestamp(hour),
    latitude,
    longitude,
    precipitation: p.PRECTOTCORR[hour] / MM_PER_DAY_TO_MM_PER_HOUR,
    precipitationStddev: c.precipitationStddev,
    windSpeed: p.WS10M[hour] * MS_TO_KMH,
    windSpeedStddev: c.windSpeedStddev,
    temperature: p.T2M[hour],
    temperatureStddev: c.temperatureStddev,
    failureRate: c.failureRate,
  };
}

export async function fetchNASAPOWER(
  latitude: number,
  longitude: number,
  config?: SourceFetchConfig
): Promise<WeatherMeasurement> {
  if (isOffline(config)) {
    const data = await loadFixture<NasaPowerResponse>(NASA_POWER_FIXTURE, config);
    return parseNasaPower(data, latitude, longitude);
  }

  const response = await fetch(nasaPowerUrl(latitude, longitude, previousDayStamp()));
  if (!response.ok) throw new Error(`NASA POWER API error: ${response.status}`);

  return parseNasaPower((await response.json()) as NasaPowerResponse, latitude, longitude);
}
