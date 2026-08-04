/**
 * AURA v2 — Captura de los datos reales del hindcast (`npm run hindcast:capture`)
 *
 *   npm run hindcast:capture                 los dos eventos
 *   npm run hindcast:capture -- --event e1   solo E1
 *
 * ES EL ÚNICO PUNTO DEL REPOSITORIO QUE TOCA LA RED, y se ejecuta UNA VEZ. Todo
 * lo demás —el experimento, `verify`, los snapshots— trabaja desde
 * `fixtures/hindcast/`, con el mismo patrón `AURA_OFFLINE` del resto del harness
 * (`src/data/sources/offline.ts`): un experimento que descargara sus datos en
 * cada ejecución no sería reproducible, porque el proveedor puede revisar la
 * serie, cambiar el esquema o simplemente no estar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ ESCRIBE, Y POR QUÉ ASÍ
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   fixtures/hindcast/<evento>/era5.json           respuesta TAL CUAL la sirvió
 *   fixtures/hindcast/<evento>/era5-land.json      la API, menos los campos
 *   fixtures/hindcast/<evento>/ecmwf-ifs.json      volátiles (ver
 *   fixtures/hindcast/<evento>/nasa-power.json     `stripVolatileFields`)
 *   fixtures/hindcast/<evento>/nasa-power-daily.json
 *   fixtures/hindcast/<evento>/manifest.json       procedencia y checksums
 *
 * Los payloads se guardan con `JSON.stringify(…, null, 2)` y NO con la
 * serialización canónica del repositorio: son datos AJENOS, y reordenar sus
 * claves o redondear sus números convertiría el fichero en una interpretación
 * nuestra de la respuesta en vez de en la respuesta. El determinismo se consigue
 * quitando lo volátil, no normalizando lo demás.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LA VERIFICACIÓN DE UNIDADES DE POWER FORMA PARTE DE LA CAPTURA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `PRECTOTCORR` viene en **mm/day también en el endpoint horario**, donde es la
 * tasa instantánea expresada por día (ver `src/data/sources/nasa-power.ts`). Es
 * un factor 24, y ya se coló una vez en este repositorio. En lugar de confiar en
 * el comentario, la captura lo COMPRUEBA contra la propia API: descarga también
 * el endpoint DIARIO de la misma ventana y verifica, día a día,
 *
 *     media de las 24 horas ≈ valor diario
 *
 * que es la identidad que se cumple si —y solo si— las horarias están en mm/day.
 * Si estuvieran en mm/h, el acumulado del día sería la SUMA y la razón entre lo
 * observado y lo esperado sería 24. El resultado de la comprobación, con los
 * números concretos, queda en el manifest. Si falla, la captura LANZA: capturar
 * datos cuya unidad no se ha podido confirmar es peor que no capturarlos.
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  HINDCAST_EVENTS,
  HINDCAST_FEEDS,
  HindcastEvent,
  HindcastFeed,
  NASA_POWER_ATTRIBUTION,
  NASA_POWER_LICENSE,
  captureUrl,
  compactDate,
  eventOf,
  stripVolatileFields,
} from './lib/hindcast-events';
import { HINDCAST_SOURCES } from '@/data/sources/hindcast-characterization';
import { MM_PER_DAY_TO_MM_PER_HOUR } from '@/data/sources/nasa-power';

const FIXTURES_DIR = path.resolve('fixtures', 'hindcast');

/** Umbral de dato ausente de POWER — el mismo criterio que `nasa-power.ts`. */
const FILL_THRESHOLD = -900;

/**
 * Tolerancia relativa de la verificación de unidades: 1 %.
 *
 * El endpoint diario redondea a dos decimales y el horario también, luego la
 * identidad «media de las 24 = diario» no se cumple al bit. Un 1 % deja sitio de
 * sobra a ese redondeo y sigue estando tres órdenes por debajo del factor 24 que
 * la comprobación existe para detectar.
 */
const UNITS_TOLERANCE = 0.01;

const log = (m: string) => process.stdout.write(`  [hindcast:capture] ${m}\n`);

/** Descarga JSON y falla con el cuerpo de la respuesta, que es donde va el motivo. */
async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url);
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} en ${url}\n  respuesta: ${body.slice(0, 400)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`respuesta no-JSON de ${url}: ${body.slice(0, 400)}`);
  }
  // Open-Meteo señala los errores con 200 + {error:true, reason}. Sin esta
  // comprobación, un parámetro mal escrito se versionaría como si fuera un dato.
  const obj = parsed as Record<string, unknown>;
  if (obj['error'] === true) {
    throw new Error(`la API devolvió error en ${url}: ${String(obj['reason'] ?? '(sin motivo)')}`);
  }
  return obj;
}

/** Serializa y escribe un payload; devuelve su tamaño y su sha256. */
async function writePayload(
  dir: string,
  fileName: string,
  payload: unknown
): Promise<{ file: string; bytes: number; sha256: string }> {
  const text = JSON.stringify(payload, null, 2) + '\n';
  await writeFile(path.join(dir, fileName), text, 'utf8');
  return {
    file: fileName,
    bytes: Buffer.byteLength(text, 'utf8'),
    sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
  };
}

/** Resumen de una serie: cuántas horas, cuántos huecos y su rango. */
function seriesSummary(values: readonly (number | null)[], isFill: (v: number) => boolean) {
  const valid: number[] = [];
  let gaps = 0;
  for (const v of values) {
    if (v === null || !Number.isFinite(v) || isFill(v)) gaps++;
    else valid.push(v);
  }
  return {
    hours: values.length,
    validHours: valid.length,
    gapHours: gaps,
    min: valid.length === 0 ? null : Math.min(...valid),
    max: valid.length === 0 ? null : Math.max(...valid),
    sum: valid.reduce((s, v) => s + v, 0),
  };
}

/** Extrae las series de una respuesta de Open-Meteo o de POWER, ya alineadas. */
function summarizeFeed(feed: HindcastFeed, payload: Record<string, unknown>) {
  if (feed.provider === 'open-meteo') {
    const hourly = payload['hourly'] as Record<string, (number | null)[]>;
    const never = () => false;
    return {
      gridPoint: {
        latitude: payload['latitude'] as number,
        longitude: payload['longitude'] as number,
        elevationM: payload['elevation'] as number,
      },
      timeStandard: `UTC (timezone=GMT, utc_offset_seconds=${String(payload['utc_offset_seconds'])})`,
      units: payload['hourly_units'],
      variables: {
        precipitation: seriesSummary(hourly['precipitation'] ?? [], never),
        temperature_2m: seriesSummary(hourly['temperature_2m'] ?? [], never),
      },
    };
  }

  const header = payload['header'] as Record<string, unknown>;
  const parameter = (payload['properties'] as Record<string, unknown>)['parameter'] as Record<
    string,
    Record<string, number>
  >;
  const coords = (payload['geometry'] as { coordinates: number[] }).coordinates;
  const isFill = (v: number) => v <= FILL_THRESHOLD;

  return {
    gridPoint: { latitude: coords[1], longitude: coords[0], elevationM: coords[2] },
    timeStandard:
      `LST (${String(header['time_standard'])}). POWER define LST = UTC + round(lon/15); con ` +
      `las longitudes de los dos eventos ese redondeo vale 0, luego LST ≡ UTC y las claves ` +
      `horarias YYYYMMDDHH se leen directamente como UTC. El experimento lo COMPRUEBA al ` +
      `cargar el fixture y lanza si deja de cumplirse.`,
    fillValue: header['fill_value'],
    units: { PRECTOTCORR: 'mm/day', T2M: 'C' },
    variables: {
      PRECTOTCORR: seriesSummary(Object.values(parameter['PRECTOTCORR'] ?? {}), isFill),
      T2M: seriesSummary(Object.values(parameter['T2M'] ?? {}), isFill),
    },
  };
}

/**
 * Comprueba contra la API que `PRECTOTCORR` horario está en mm/day.
 *
 * @throws si la identidad «media de las 24 horas = valor diario» no se cumple
 *         dentro de {@link UNITS_TOLERANCE} en algún día de la ventana.
 */
function verifyPowerUnits(
  hourly: Record<string, unknown>,
  daily: Record<string, unknown>
): Record<string, unknown> {
  const hourlyP = ((hourly['properties'] as Record<string, unknown>)['parameter'] as Record<
    string,
    Record<string, number>
  >)['PRECTOTCORR'];
  const dailyP = ((daily['properties'] as Record<string, unknown>)['parameter'] as Record<
    string,
    Record<string, number>
  >)['PRECTOTCORR'];

  const byDay = new Map<string, number[]>();
  for (const [key, value] of Object.entries(hourlyP)) {
    if (value <= FILL_THRESHOLD) continue;
    const day = key.slice(0, 8);
    byDay.set(day, [...(byDay.get(day) ?? []), value]);
  }

  const days: Record<string, unknown>[] = [];
  for (const day of [...byDay.keys()].sort()) {
    const values = byDay.get(day)!;
    const sum = values.reduce((s, v) => s + v, 0);
    const mean = sum / values.length;
    const reported = dailyP[day];
    if (reported === undefined || reported <= FILL_THRESHOLD) continue;

    // Denominador seguro: en un día seco reported ≈ 0 y la razón relativa no
    // significa nada; se compara entonces en valor absoluto contra el redondeo.
    const ok =
      Math.abs(mean - reported) <= Math.max(UNITS_TOLERANCE * Math.abs(reported), 0.02);
    days.push({
      day,
      hours: values.length,
      sumOfHourly: sum,
      meanOfHourly: mean,
      dailyEndpointValue: reported,
      ratioSumToDaily: reported === 0 ? null : sum / reported,
      meanMatchesDaily: ok,
    });
    if (!ok) {
      throw new Error(
        `verificación de unidades de NASA POWER FALLIDA en ${day}: la media de las ` +
          `${values.length} horas es ${mean.toFixed(4)} y el endpoint diario reporta ` +
          `${reported}. Si las horarias estuvieran en mm/h, el diario sería la SUMA ` +
          `(${sum.toFixed(2)}). La captura se aborta: no se versionan datos cuya unidad ` +
          `no se ha podido confirmar. Ver src/data/sources/nasa-power.ts.`
      );
    }
  }

  if (days.length === 0) {
    throw new Error(
      'verificación de unidades de NASA POWER imposible: ningún día de la ventana tiene ' +
        'a la vez horas válidas y valor diario válido.'
    );
  }

  return {
    conclusion:
      'PRECTOTCORR del endpoint HORARIO está en mm/day (tasa instantánea expresada por ' +
      'día), NO en mm/h. Comprobado contra el endpoint diario de la MISMA ventana: la ' +
      'MEDIA de las 24 horas coincide con el valor diario, luego el acumulado real del día ' +
      `es Σ(horarias)/24. La conversión a mm/h del marco es dividir por ` +
      `${MM_PER_DAY_TO_MM_PER_HOUR}, que es lo que hace el pipeline.`,
    ifItWereMmPerHour:
      'Entonces el acumulado del día sería la SUMA de las horarias y la razón ' +
      'suma/diario valdría 1. Se observa ≈ 24 en todos los días de la ventana, que es ' +
      'exactamente el factor en disputa.',
    toleranceRelative: UNITS_TOLERANCE,
    days,
  };
}

async function captureEvent(event: HindcastEvent): Promise<void> {
  const dir = path.join(FIXTURES_DIR, event.id);
  await mkdir(dir, { recursive: true });

  log(`${event.id} — ${event.startDate} … ${event.endDate} @ ` +
    `${event.point.latitude}, ${event.point.longitude}`);

  const sources: Record<string, unknown>[] = [];
  const payloads = new Map<string, Record<string, unknown>>();

  for (const feed of HINDCAST_FEEDS) {
    const url = captureUrl(feed, event);
    const raw = await fetchJson(url);
    const payload = stripVolatileFields(raw) as Record<string, unknown>;
    payloads.set(feed.key, payload);

    const written = await writePayload(dir, `${feed.key}.json`, payload);
    const summary = summarizeFeed(feed, payload);

    sources.push({
      key: feed.key,
      sourceId: feed.sourceId,
      usedInPipeline: feed.sourceId !== null,
      label: feed.label,
      provider: feed.provider,
      ...(feed.model !== undefined ? { model: feed.model } : {}),
      url,
      resolution: feed.resolution,
      license: feed.license,
      attribution: feed.attribution,
      note: feed.note,
      ...summary,
      ...written,
    });

    const v = Object.entries(summary.variables) as [
      string,
      { validHours: number; hours: number },
    ][];
    log(`  ${feed.key.padEnd(11)} ` + v.map(([k, s]) => `${k} ${s.validHours}/${s.hours}`).join('  '));
  }

  // Endpoint DIARIO de POWER: solo para la verificación de unidades.
  const dailyUrl =
    `https://power.larc.nasa.gov/api/temporal/daily/point` +
    `?parameters=PRECTOTCORR&community=RE` +
    `&latitude=${event.point.latitude}&longitude=${event.point.longitude}` +
    `&start=${compactDate(event.startDate)}&end=${compactDate(event.endDate)}` +
    `&format=JSON`;
  const daily = stripVolatileFields(await fetchJson(dailyUrl)) as Record<string, unknown>;
  const dailyWritten = await writePayload(dir, 'nasa-power-daily.json', daily);
  const unitsVerification = verifyPowerUnits(payloads.get('nasa-power')!, daily);
  log(`  unidades POWER verificadas contra el endpoint diario: mm/day confirmado`);

  const manifest = {
    schemaVersion: 1,
    event: {
      id: event.id,
      label: event.label,
      description: event.description,
      startDate: event.startDate,
      endDate: event.endDate,
      timeZone: 'UTC',
    },

    // Va PRIMERO y en mayúsculas a propósito: es la condición de lectura de todo
    // lo que hay debajo.
    nature:
      'EJERCICIO ILUSTRATIVO DEL COMPORTAMIENTO DEL PIPELINE SOBRE DATOS REALES. NO es una ' +
      'validación operativa. No hay ground truth (los tres productos son mallas de ' +
      'reanálisis, no el valor en el punto), el DAG es el de juguete de la demo (Ec. 34) y ' +
      'las fuentes no son independientes. Ninguna salida derivada de estos datos puede ' +
      'redactarse como «AURA habría evitado X» o «AURA habría predicho X».',
    caveat: event.caveat,

    point: {
      requested: { latitude: event.point.latitude, longitude: event.point.longitude },
      rationale: event.point.rationale,
      note:
        'Las coordenadas de `requested` son las EXACTAS que se enviaron a las tres APIs. ' +
        'Cada proveedor las ajusta al centro de su celda; el punto de malla que devolvió ' +
        'cada uno está en `sources[].gridPoint`, y las diferencias entre ellos son un ' +
        'efecto directo de la resolución de cada producto.',
    },

    capturedAt: new Date().toISOString(),

    resolutionWarning:
      'LOS REANÁLISIS SUAVIZAN LOS EXTREMOS CONVECTIVOS LOCALES. Los tres productos dan el ' +
      'valor MEDIO sobre una celda de 9, 25 y 50 km de lado; un núcleo convectivo de unos ' +
      'pocos km queda diluido en esa media. Los picos puntuales medidos por pluviómetros ' +
      'pueden superar CON MUCHO el valor de celda del mismo instante y lugar, y en los dos ' +
      'eventos de este hindcast lo hicieron. Ninguna cifra de estas series debe leerse como ' +
      '«lo que llovió en ese punto»: es «lo que el producto asigna a la celda que contiene ' +
      'ese punto». Es también el motivo por el que σ de la caracterización a priori crece ' +
      'linealmente con el lado de celda (ver `characterization` más abajo).',

    aemet:
      'AEMET QUEDA FUERA DEL HINDCAST. Su OpenData requiere API key, y un experimento que ' +
      'dependa de una credencial no es reproducible por quien no la tenga: quien clone este ' +
      'repositorio no podría regenerar los fixtures. La consecuencia está asumida y ' +
      'declarada: sin AEMET no hay ninguna fuente de OBSERVACIÓN DIRECTA en el hindcast, ' +
      'las tres son productos de asimilación que comparten observaciones, y por tanto (a) se ' +
      'espera conflicto bajo, (b) H3 del Teorema 6.1 no se cumple en sentido estricto y (c) ' +
      'el caso virga del paper (Ejemplo 3.1) no puede reproducirse aquí. Ver ' +
      'src/data/sources/hindcast-characterization.ts.',

    offline:
      'Tras esta captura, TODO lo demás funciona sin red desde estos ficheros, con el mismo ' +
      'patrón AURA_OFFLINE del resto del harness (src/data/sources/offline.ts). ' +
      '`npm run exp:hindcast` no toca la red.',

    payloadSerialization:
      'Los payloads se guardan tal como los sirvió la API, con indentación de 2, MENOS los ' +
      'campos volátiles de temporización (`generationtime_ms` en Open-Meteo, `times` en ' +
      'POWER), que son milisegundos de reloj del servidor y cambiarían el checksum en cada ' +
      'llamada sin que cambiara ningún dato. No se reordenan claves ni se redondean ' +
      'números: son datos ajenos.',

    unitsVerification,

    characterization: HINDCAST_SOURCES.map((c) => ({
      sourceId: c.sourceId,
      cellSizeKm: c.cellSizeKm,
      precipitationStddev: c.precipitationStddev,
      temperatureStddev: c.temperatureStddev,
      failureRate: c.failureRate,
      declaredAPriori: true,
    })),
    characterizationNote:
      'σ y δ se declararon y commitearon ANTES de ejecutar el pipeline sobre un solo dato ' +
      'de estas series, y están bloqueados por ' +
      '__tests__/data/hindcast-characterization.test.ts. Se copian aquí para que el ' +
      'manifest de procedencia diga, por sí solo, bajo qué caracterización se produjeron los ' +
      'resultados del evento.',

    sources: [...sources, { key: 'nasa-power-daily', sourceId: null, usedInPipeline: false,
      label: 'NASA POWER diario (solo verificación de unidades)', provider: 'nasa-power',
      url: dailyUrl, resolution: '0,5° × 0,625° ≈ 50 km', license: NASA_POWER_LICENSE,
      attribution: NASA_POWER_ATTRIBUTION,
      note: 'Se captura únicamente para comprobar contra la API que PRECTOTCORR horario está ' +
        'en mm/day. No entra en el pipeline.',
      ...dailyWritten }],
  };

  await writeFile(
    path.join(dir, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8'
  );
  log(`  manifest escrito en ${path.join(dir, 'manifest.json')}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const idx = argv.findIndex((a) => a === '--event' || a.startsWith('--event='));
  let events = HINDCAST_EVENTS;
  if (idx !== -1) {
    const value = argv[idx].includes('=') ? argv[idx].split('=')[1] : argv[idx + 1];
    if (value === undefined) throw new Error('--event necesita un valor (e1, e2 o un id).');
    events = [eventOf(value)];
  }

  for (const event of events) {
    await captureEvent(event);
  }

  log(`captura completa: ${events.length} evento(s) en ${FIXTURES_DIR}`);
}

main().catch((e) => {
  process.stderr.write(`\ncapture-hindcast: ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
