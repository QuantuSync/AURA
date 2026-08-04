/**
 * AURA v2 — Lectura de las series horarias del hindcast desde `fixtures/`
 *
 * Convierte los payloads capturados por `npm run hindcast:capture` en una serie
 * horaria ALINEADA de las tres fuentes del pipeline. Sin red: el único punto del
 * repositorio que la toca es el script de captura.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LOS DOS PROBLEMAS QUE RESUELVE, Y NINGUNO ES DE PARSEO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * (1) ALINEACIÓN TEMPORAL. Open-Meteo entrega instantes ISO sin zona (con
 *     `timezone=GMT` son UTC) y NASA POWER entrega claves `YYYYMMDDHH` en **LST**,
 *     su hora solar local. Fusionar tres fuentes exige que las tres describan EL
 *     MISMO instante; si POWER estuviera desplazada una hora, el conflicto medido
 *     sería el de comparar la lluvia de las 12 con la de las 13, y no habría nada
 *     en la salida que lo delatara.
 *
 *     POWER define LST = UTC + round(lon / 15). Con las longitudes de los dos
 *     eventos (−0,72° y −3,683°) ese redondeo vale 0 y LST ≡ UTC. Es una
 *     coincidencia afortunada de estos dos puntos, NO una propiedad de POWER, de
 *     modo que {@link assertPowerLstIsUtc} lo COMPRUEBA y lanza si deja de
 *     cumplirse. Sin esa comprobación, mover el punto del hindcast 8 grados al
 *     este introduciría un desfase silencioso de una hora.
 *
 * (2) UNIDADES DE POWER. `PRECTOTCORR` viene en mm/day también en el endpoint
 *     horario y hay que dividir por 24 (`MM_PER_DAY_TO_MM_PER_HOUR`). La captura
 *     ya lo verificó contra el endpoint diario de la misma ventana y dejó los
 *     números en el manifest; aquí solo se aplica la conversión, importando la
 *     constante del cliente de producción para que no puedan divergir.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HUECOS: SE EXCLUYE LA HORA, NO SE IMPUTA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Una hora entra en la serie solo si las TRES fuentes tienen dato válido de
 * precipitación y de temperatura en ella. Las que no, se excluyen y se listan
 * una a una en el resultado del experimento (`excludedHours`), con el motivo.
 *
 * La alternativa —imputar el hueco con la media de las otras dos, o con la hora
 * anterior— sería fatal en este pipeline concreto: inventaría una tercera
 * medición CONCORDANTE con las otras dos, bajando artificialmente el conflicto y
 * estrechando el conjunto credal. Es decir, el error iría en la dirección NO
 * conservadora, y encima sería invisible. Excluir la hora reduce la muestra, que
 * es un coste que se ve.
 *
 * (En la captura efectiva de los dos eventos no hubo ningún hueco en las tres
 * fuentes usadas; el camino existe para que la ausencia de huecos sea un HECHO
 * COMPROBADO y no una suposición.)
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { HINDCAST_SOURCES } from '@/data/sources/hindcast-characterization';
import { MM_PER_DAY_TO_MM_PER_HOUR } from '@/data/sources/nasa-power';
import { parseUtcTimestamp } from '@/data/sources/offline';

import { HindcastEvent, PIPELINE_FEEDS } from '../../lib/hindcast-events';

/** Umbral de dato ausente de POWER — mismo criterio que `nasa-power.ts`. */
const FILL_THRESHOLD = -900;

/** Raíz de los fixtures del hindcast. Respeta `AURA_FIXTURES_DIR` como el resto. */
export function hindcastFixturesDir(): string {
  return path.resolve(process.env['AURA_FIXTURES_DIR'] ?? 'fixtures', 'hindcast');
}

/** Una hora con las tres fuentes presentes y alineadas. */
export interface HourRecord {
  /** Epoch ms, UTC. */
  timestamp: number;
  /** `YYYY-MM-DDTHH:00Z`. Clave legible y estable de la hora. */
  iso: string;
  /** mm/h, en el orden de `HINDCAST_SOURCES`. */
  precipitation: number[];
  /** °C, en el orden de `HINDCAST_SOURCES`. */
  temperature: number[];
}

/** Una hora descartada, con el motivo exacto. */
export interface ExcludedHour {
  iso: string;
  reason: string;
}

export interface EventSeries {
  event: HindcastEvent;
  hours: HourRecord[];
  excluded: ExcludedHour[];
  /** Punto de malla que devolvió cada fuente, para la trazabilidad. */
  gridPoints: { sourceId: string; latitude: number; longitude: number; elevationM: number }[];
  /** Horas que cada fuente trajo, antes de la intersección. */
  perSourceHours: { sourceId: string; hours: number; validHours: number }[];
}

/** Serie de una variable de una fuente, indexada por hora ISO. */
type Indexed = Map<string, number | null>;

const isoOf = (timestamp: number): string =>
  `${new Date(timestamp).toISOString().slice(0, 13)}:00Z`;

/**
 * Comprueba que la hora LST de POWER coincide con UTC en esta longitud.
 *
 * @throws si no, con el desfase concreto. Ver el punto (1) del encabezado.
 */
export function assertPowerLstIsUtc(longitude: number, eventId: string): void {
  const offsetHours = Math.round(longitude / 15);
  if (offsetHours !== 0) {
    throw new Error(
      `hindcast ${eventId}: NASA POWER entrega horas en LST = UTC + round(lon/15), y con ` +
        `lon = ${longitude}° ese offset vale ${offsetHours} h, no 0. Las claves YYYYMMDDHH ` +
        `NO pueden leerse como UTC: la serie de POWER quedaría desplazada ${offsetHours} h ` +
        `frente a las de Open-Meteo y el conflicto medido sería el de instantes distintos. ` +
        `Añade la conversión LST→UTC antes de mover el hindcast a esta longitud.`
    );
  }
}

/** Indexa una respuesta horaria de Open-Meteo por hora ISO. */
function indexOpenMeteo(
  payload: Record<string, unknown>,
  variable: string
): Indexed {
  const hourly = payload['hourly'] as Record<string, unknown>;
  const times = hourly['time'] as string[];
  const values = hourly[variable] as (number | null)[] | undefined;

  const out: Indexed = new Map();
  for (let i = 0; i < times.length; i++) {
    const v = values?.[i];
    out.set(
      isoOf(parseUtcTimestamp(times[i])),
      v === null || v === undefined || !Number.isFinite(v) ? null : v
    );
  }
  return out;
}

/** `YYYYMMDDHH` → epoch ms, leyendo la hora como UTC (ver `assertPowerLstIsUtc`). */
function powerKeyToTimestamp(key: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})$/.exec(key);
  if (!m) throw new Error(`NASA POWER: clave horaria no reconocida '${key}'.`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]));
}

/** Indexa una respuesta horaria de POWER por hora ISO, aplicando `scale`. */
function indexPower(
  payload: Record<string, unknown>,
  parameter: string,
  scale: number
): Indexed {
  const params = (payload['properties'] as Record<string, unknown>)['parameter'] as Record<
    string,
    Record<string, number>
  >;
  const series = params[parameter];
  if (series === undefined) {
    throw new Error(`NASA POWER: la respuesta no trae el parámetro '${parameter}'.`);
  }

  const out: Indexed = new Map();
  for (const [key, value] of Object.entries(series)) {
    const invalid = !Number.isFinite(value) || value <= FILL_THRESHOLD;
    out.set(isoOf(powerKeyToTimestamp(key)), invalid ? null : value / scale);
  }
  return out;
}

async function readPayload(dir: string, file: string): Promise<Record<string, unknown>> {
  const full = path.join(dir, file);
  let raw: string;
  try {
    raw = await readFile(full, 'utf8');
  } catch {
    throw new Error(
      `hindcast: no se encuentra el fixture '${full}'. Los fixtures del hindcast se ` +
        `capturan UNA VEZ con \`npm run hindcast:capture\` y se versionan; el experimento ` +
        `no toca la red.`
    );
  }
  return JSON.parse(raw) as Record<string, unknown>;
}

/**
 * Carga la serie horaria alineada de un evento.
 *
 * El orden de las columnas de `precipitation` y `temperature` es el de
 * `HINDCAST_SOURCES`, que es parte del contrato de los artefactos versionados.
 */
export async function loadEventSeries(event: HindcastEvent): Promise<EventSeries> {
  const dir = path.join(hindcastFixturesDir(), event.id);
  assertPowerLstIsUtc(event.point.longitude, event.id);

  const precipitation: Indexed[] = [];
  const temperature: Indexed[] = [];
  const gridPoints: EventSeries['gridPoints'] = [];
  const perSourceHours: EventSeries['perSourceHours'] = [];

  for (const feed of PIPELINE_FEEDS) {
    const payload = await readPayload(dir, `${feed.key}.json`);

    if (feed.provider === 'open-meteo') {
      precipitation.push(indexOpenMeteo(payload, 'precipitation'));
      temperature.push(indexOpenMeteo(payload, 'temperature_2m'));
      gridPoints.push({
        sourceId: feed.sourceId!,
        latitude: payload['latitude'] as number,
        longitude: payload['longitude'] as number,
        elevationM: payload['elevation'] as number,
      });
    } else {
      // POWER: mm/day → mm/h en la precipitación; la temperatura ya está en °C.
      precipitation.push(indexPower(payload, 'PRECTOTCORR', MM_PER_DAY_TO_MM_PER_HOUR));
      temperature.push(indexPower(payload, 'T2M', 1));
      const coords = (payload['geometry'] as { coordinates: number[] }).coordinates;
      gridPoints.push({
        sourceId: feed.sourceId!,
        latitude: coords[1],
        longitude: coords[0],
        elevationM: coords[2],
      });
    }

    const last = precipitation.length - 1;
    const values = [...precipitation[last].values()];
    perSourceHours.push({
      sourceId: feed.sourceId!,
      hours: values.length,
      validHours: values.filter((v) => v !== null).length,
    });
  }

  // Unión de instantes, en orden cronológico: una hora que falte ENTERA en una
  // fuente debe aparecer como excluida, no desaparecer sin dejar rastro.
  const allIso = new Set<string>();
  for (const idx of precipitation) for (const k of idx.keys()) allIso.add(k);
  for (const idx of temperature) for (const k of idx.keys()) allIso.add(k);

  const hours: HourRecord[] = [];
  const excluded: ExcludedHour[] = [];

  for (const iso of [...allIso].sort()) {
    const p: number[] = [];
    const t: number[] = [];
    const missing: string[] = [];

    for (let i = 0; i < HINDCAST_SOURCES.length; i++) {
      const id = HINDCAST_SOURCES[i].sourceId;
      const pv = precipitation[i].get(iso);
      const tv = temperature[i].get(iso);
      if (pv === undefined || pv === null) missing.push(`${id}.precipitación`);
      else p.push(pv);
      if (tv === undefined || tv === null) missing.push(`${id}.temperatura`);
      else t.push(tv);
    }

    if (missing.length > 0) {
      excluded.push({
        iso,
        reason: `sin dato válido en: ${missing.join(', ')} (hueco o fill_value; no se imputa)`,
      });
      continue;
    }

    hours.push({ timestamp: Date.parse(iso), iso, precipitation: p, temperature: t });
  }

  if (hours.length === 0) {
    throw new Error(
      `hindcast ${event.id}: ninguna hora tiene dato válido simultáneo en las tres fuentes ` +
        `(${excluded.length} horas excluidas). Revisa la captura.`
    );
  }

  return { event, hours, excluded, gridPoints, perSourceHours };
}

/**
 * Ventana deslizante de `width` horas que MAXIMIZA la precipitación media de las
 * tres fuentes. Empates, a favor de la más temprana.
 *
 * Es la definición del «pico» que usa el perfil `verify`, y se calcula SOLO a
 * partir de los datos de entrada —nunca de la salida del pipeline— para que la
 * ventana no dependa de la regla de conflicto, de la caracterización ni de nada
 * que el experimento pueda cambiar después. Si dependiera, cambiar cualquiera de
 * esas cosas movería la ventana y el snapshot diferiría por dos motivos a la vez.
 */
export function peakWindow(hours: readonly HourRecord[], width: number): HourRecord[] {
  if (hours.length <= width) return [...hours];

  const meanOf = (h: HourRecord) =>
    h.precipitation.reduce((s, v) => s + v, 0) / h.precipitation.length;

  let best = 0;
  let bestSum = -Infinity;
  let running = 0;
  for (let i = 0; i < hours.length; i++) {
    running += meanOf(hours[i]);
    if (i >= width) running -= meanOf(hours[i - width]);
    if (i >= width - 1 && running > bestSum) {
      bestSum = running;
      best = i - width + 1;
    }
  }

  return hours.slice(best, best + width);
}
