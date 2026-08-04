/**
 * AURA v2 — Los dos eventos del hindcast, y cómo se capturan
 *
 * Definición ÚNICA de qué se descarga y de dónde. La comparte
 * `scripts/capture-hindcast.ts` (que la usa para pedir los datos y para escribir
 * el manifest) con `scripts/experiments/hindcast.ts` (que la usa para leer los
 * fixtures y rotular las salidas), de modo que no puede haber desacuerdo entre
 * lo que el manifest dice que se capturó y lo que el experimento cree estar
 * leyendo.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ⚠ QUÉ ES ESTE EJERCICIO, Y QUÉ NO ES
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Es una demostración ILUSTRATIVA del COMPORTAMIENTO DEL PIPELINE sobre datos
 * reales: qué conflicto ve entre tres reanálisis, qué estrategia de fusión
 * elige, cómo evoluciona el conjunto credal y qué dicen los dos niveles del
 * certificado hora a hora.
 *
 * NO es una validación operativa, y ninguna salida de este hindcast —ni figura,
 * ni tabla, ni frase de README— puede redactarse como «AURA habría evitado X» o
 * «AURA habría predicho X». Tres razones independientes, cada una suficiente:
 *
 *  1. **No hay ground truth.** Los tres productos son reanálisis en malla; el
 *     valor real en el punto no está en ninguno de ellos. Sin verdad no hay
 *     acierto que medir. (Lo que sí se puede medir es la cobertura, y para eso
 *     está la campaña de mundos sintéticos de `scripts/experiments/`.)
 *  2. **El DAG es el de la demo.** `createDemoDAG` es un modelo de juguete de
 *     acumulación menos drenaje (Ec. 34) con parámetros declarados, no un modelo
 *     hidrológico de ninguna cuenca real.
 *  3. **Las fuentes no son independientes** (H3) y comparten observaciones
 *     asimiladas. Ver `src/data/sources/hindcast-characterization.ts`.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 */

/** Coordenadas del punto de un evento. */
export interface EventPoint {
  latitude: number;
  longitude: number;
  /** Por qué ese punto y no otro. Va al manifest. */
  rationale: string;
}

/** Una fuente capturable, con su proveedor y su licencia. */
export interface HindcastFeed {
  /** Clave del fichero en `fixtures/hindcast/<evento>/<key>.json`. */
  key: string;
  /** `sourceId` de `hindcast-characterization.ts`, o `null` si no entra al pipeline. */
  sourceId: string | null;
  label: string;
  provider: 'open-meteo' | 'nasa-power';
  /** Modelo de Open-Meteo (`models=`), si aplica. */
  model?: string;
  /** Resolución nominal declarada, para el manifest. */
  resolution: string;
  license: string;
  attribution: string;
  /** Una línea sobre qué es y por qué está (o no está) en el pipeline. */
  note: string;
}

export interface HindcastEvent {
  /** Identificador estable: directorio de fixtures y nombre del experimento. */
  id: string;
  /** Etiqueta corta para figuras. */
  label: string;
  description: string;
  point: EventPoint;
  /** Primer día del evento, `YYYY-MM-DD`, UTC. */
  startDate: string;
  /** Último día del evento, inclusive, `YYYY-MM-DD`, UTC. */
  endDate: string;
  /**
   * Advertencia OBLIGATORIA del evento, o `null`. Cuando no es `null`, viaja al
   * manifest, al `results.json`, al README y al subtítulo de las cuatro figuras.
   * No es un comentario: es una condición de lectura de todos los números del
   * evento.
   */
  caveat: string | null;
  /**
   * Versión de UNA LÍNEA de {@link caveat}, para la franja visible de las
   * figuras. `null` exactamente cuando `caveat` lo es.
   *
   * Existe porque un SVG no reajusta texto: el caveat íntegro de E2 son ~900
   * caracteres y dibujarlo dentro de la figura o la deforma o lo trunca. La
   * solución NO es truncarlo —la advertencia es obligatoria— sino separar dos
   * papeles: el titular va VISIBLE en la franja roja de la figura, y el texto
   * completo viaja en el `<desc>` del SVG, que es lo que leen los lectores de
   * pantalla y lo que sobrevive a que alguien copie el fichero a otro sitio.
   */
  caveatHeadline: string | null;
}

/**
 * E1 — DANA de Valencia, 28 a 31 de octubre de 2024.
 *
 * El evento principal. La ventana empieza un día antes del episodio para que la
 * serie incluya el régimen previo y el ascenso, no solo el pico.
 */
export const EVENT_E1: HindcastEvent = {
  id: 'e1-dana-valencia-2024',
  label: 'E1 · DANA Valencia 2024',
  description:
    'DANA de Valencia, 28-31 de octubre de 2024. Punto en el interior de la provincia, ' +
    'en la zona de máximos del episodio.',
  point: {
    latitude: 39.42,
    longitude: -0.72,
    rationale:
      'Interior de la provincia de Valencia, en la franja donde se registraron los máximos ' +
      'del episodio. Las coordenadas son las EXACTAS que se enviaron a las tres APIs; cada ' +
      'proveedor las ajusta al centro de su propia celda, y el punto de malla resultante de ' +
      'cada uno queda registrado en `gridPoint` dentro de este manifest.',
  },
  startDate: '2024-10-28',
  endDate: '2024-10-31',
  caveat: null,
  caveatHeadline: null,
};

/**
 * E2 — Filomena, Madrid-Chamartín, 6 a 12 de enero de 2021.
 *
 * Evento SECUNDARIO y con una advertencia que condiciona la lectura de todos sus
 * números. Ver {@link EVENT_E2.caveat}: se incluye por la capa de fusión —el
 * acuerdo o desacuerdo entre reanálisis en un régimen físico completamente
 * distinto al de E1— y por el contraste, no porque el DAG pueda modelarlo.
 */
export const EVENT_E2: HindcastEvent = {
  id: 'e2-filomena-madrid-2021',
  label: 'E2 · Filomena Madrid 2021',
  description:
    'Borrasca Filomena, Madrid-Chamartín, 6-12 de enero de 2021. Evento secundario, ' +
    'incluido por la capa de fusión y por el contraste con E1.',
  point: {
    latitude: 40.472,
    longitude: -3.683,
    rationale:
      'Madrid-Chamartín, el mismo punto que usan los escenarios de `fixtures/s*` del ' +
      'pipeline reproducible, para que el hindcast y la demo hablen del mismo sitio.',
  },
  startDate: '2021-01-06',
  endDate: '2021-01-12',
  caveat:
    'CAVEAT OBLIGATORIO — LA PRECIPITACIÓN DE FILOMENA FUE MAYORITARIAMENTE NIEVE, CON ' +
    'T < 0 °C SOSTENIDA. El DAG de la demo (Ec. 34) modela inundación por LLUVIA: acumula ' +
    'precipitación líquida y resta una capacidad de drenaje constante. Ese mecanismo NO ' +
    'existe en E2. La precipitación se acumuló como manto nival y su liberación al drenaje ' +
    'ocurrió días después, en la fusión, con una dinámica que el DAG no representa en ' +
    'absoluto. Por tanto: todo valor de h, de plUpper y toda decisión de E2 describe lo que ' +
    'el pipeline DIRÍA si esa precipitación hubiera sido lluvia, y NO una estimación del ' +
    'riesgo real de aquel episodio. El interés de E2 está en la capa de fusión (acuerdo y ' +
    'conflicto entre reanálisis en un régimen distinto) y en el contraste con E1.',
  caveatHeadline:
    'CAVEAT E2 — La precipitación de Filomena fue mayoritariamente NIEVE, con T < 0 °C ' +
    'sostenida, y el DAG de la demo modela inundación por LLUVIA. Todo h, plUpper y decisión ' +
    'de E2 describe lo que el pipeline DIRÍA si aquello hubiera sido lluvia; no es riesgo ' +
    'real. Texto completo en la descripción del SVG y en el manifest.',
};

export const HINDCAST_EVENTS: readonly HindcastEvent[] = [EVENT_E1, EVENT_E2];

export const HINDCAST_EVENT_IDS = HINDCAST_EVENTS.map((e) => e.id);

/** Resuelve un evento por su id o por su alias corto (`e1`, `e2`). */
export function eventOf(idOrAlias: string): HindcastEvent {
  const found = HINDCAST_EVENTS.find(
    (e) => e.id === idOrAlias || e.id.startsWith(`${idOrAlias}-`)
  );
  if (found === undefined) {
    throw new Error(
      `evento de hindcast desconocido: '${idOrAlias}'. Disponibles: ` +
        `${HINDCAST_EVENT_IDS.join(', ')} (o sus alias e1, e2).`
    );
  }
  return found;
}

// ─────────────────────────────────────────────────────────────────────────────
// Las fuentes
// ─────────────────────────────────────────────────────────────────────────────

export const OPEN_METEO_LICENSE = 'CC BY 4.0';
export const OPEN_METEO_ATTRIBUTION =
  'Datos meteorológicos de Open-Meteo.com (archivo ERA5/IFS de Copernicus/ECMWF), ' +
  'bajo licencia CC BY 4.0. https://open-meteo.com/';
export const NASA_POWER_LICENSE = 'dominio público (se exige atribución)';
export const NASA_POWER_ATTRIBUTION =
  'These data were obtained from the NASA Langley Research Center (LaRC) POWER Project ' +
  'funded through the NASA Earth Science/Applied Science Program.';

/**
 * Las CUATRO series que se capturan. Solo tres entran en el pipeline: ERA5-Land
 * se captura como EVIDENCIA de que no sirve precipitación (ver su `note`).
 */
export const HINDCAST_FEEDS: readonly HindcastFeed[] = [
  {
    key: 'era5',
    sourceId: 'era5',
    label: 'ERA5 (Open-Meteo Archive)',
    provider: 'open-meteo',
    model: 'era5',
    resolution: '0,25° ≈ 25 km',
    license: OPEN_METEO_LICENSE,
    attribution: OPEN_METEO_ATTRIBUTION,
    note: 'Reanálisis global de ECMWF. Fuente 1 del pipeline.',
  },
  {
    key: 'era5-land',
    sourceId: null,
    label: 'ERA5-Land (Open-Meteo Archive)',
    provider: 'open-meteo',
    model: 'era5_land',
    resolution: '0,1° ≈ 9 km',
    license: OPEN_METEO_LICENSE,
    attribution: OPEN_METEO_ATTRIBUTION,
    note:
      'CAPTURADA PERO NO USADA. Era la segunda fuente prevista. Open-Meteo expone ERA5-Land ' +
      'en su Archive API pero NO sirve precipitación para él: devuelve null en TODAS las ' +
      'horas de los dos eventos, y también para `rain` y `snowfall`; solo la temperatura ' +
      'tiene datos. El fichero se versiona igualmente para que esa ausencia sea verificable ' +
      'sin volver a la red. Su sustituto en el pipeline es `ecmwf-ifs`, de la misma clase de ' +
      'resolución (~9 km).',
  },
  {
    key: 'ecmwf-ifs',
    sourceId: 'ecmwf-ifs',
    label: 'ECMWF IFS (Open-Meteo Archive)',
    provider: 'open-meteo',
    model: 'ecmwf_ifs',
    resolution: '≈ 9 km',
    license: OPEN_METEO_LICENSE,
    attribution: OPEN_METEO_ATTRIBUTION,
    note:
      'Archivo del ANÁLISIS OPERATIVO de ECMWF (no un reanálisis: es el modelo tal como ' +
      'estaba en producción en cada fecha). Fuente 2 del pipeline, en sustitución de ' +
      'ERA5-Land.',
  },
  {
    key: 'nasa-power',
    sourceId: 'nasa-power',
    label: 'NASA POWER horario (MERRA-2)',
    provider: 'nasa-power',
    resolution: '0,5° × 0,625° ≈ 50 km',
    license: NASA_POWER_LICENSE,
    attribution: NASA_POWER_ATTRIBUTION,
    note:
      'Reanálisis MERRA-2 de NASA/GMAO servido por el endpoint horario de POWER. Fuente 3 ' +
      'del pipeline, y la más gruesa de las tres.',
  },
];

/** Las tres fuentes que SÍ entran en el pipeline, en orden. */
export const PIPELINE_FEEDS = HINDCAST_FEEDS.filter((f) => f.sourceId !== null);

// ─────────────────────────────────────────────────────────────────────────────
// URLs de captura
// ─────────────────────────────────────────────────────────────────────────────

/** `YYYY-MM-DD` → `YYYYMMDD`, el formato de fecha de NASA POWER. */
export const compactDate = (iso: string): string => iso.replace(/-/g, '');

/**
 * URL de captura de una fuente para un evento.
 *
 * `timezone=GMT` en Open-Meteo NO es un detalle: sin él la API devuelve horas
 * locales y las series de los tres proveedores dejarían de estar alineadas.
 */
export function captureUrl(feed: HindcastFeed, event: HindcastEvent): string {
  const { latitude, longitude } = event.point;

  if (feed.provider === 'open-meteo') {
    return (
      `https://archive-api.open-meteo.com/v1/archive` +
      `?latitude=${latitude}&longitude=${longitude}` +
      `&start_date=${event.startDate}&end_date=${event.endDate}` +
      `&hourly=precipitation,temperature_2m` +
      `&models=${feed.model}` +
      `&timezone=GMT`
    );
  }

  return (
    `https://power.larc.nasa.gov/api/temporal/hourly/point` +
    `?parameters=PRECTOTCORR,T2M&community=RE` +
    `&latitude=${latitude}&longitude=${longitude}` +
    `&start=${compactDate(event.startDate)}&end=${compactDate(event.endDate)}` +
    `&format=JSON`
  );
}

/**
 * Elimina de una respuesta los campos VOLÁTILES antes de versionarla.
 *
 * Las dos APIs devuelven, junto a los datos, cuánto tardaron en servirlos:
 * `generationtime_ms` en Open-Meteo, `times.{data,process}` en POWER. Son
 * milisegundos de reloj de pared del servidor y cambian en cada llamada. Si
 * entraran en el fixture, dos capturas de EXACTAMENTE los mismos datos darían
 * ficheros distintos y checksums distintos, y el checksum del manifest dejaría
 * de significar «estos son los datos» para significar «esta fue aquella
 * llamada».
 *
 * Quitándolos, re-capturar produce bytes idénticos mientras el proveedor no
 * revise el dato — que es justo lo que un checksum de procedencia debe detectar.
 *
 * Muta en superficie sobre una copia; no toca los arrays de datos.
 */
export function stripVolatileFields(payload: unknown): unknown {
  if (payload === null || typeof payload !== 'object') return payload;
  const copy = { ...(payload as Record<string, unknown>) };
  delete copy['generationtime_ms'];
  delete copy['times'];
  return copy;
}
