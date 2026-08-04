/**
 * AURA v2 — Caracterización (σ, δ) de las fuentes del HINDCAST
 *
 * Módulo hermano de `./characterization.ts`. Aquél declara σ y δ de las tres
 * fuentes de la DEMO (AEMET, Open-Meteo forecast, NASA POWER) y sus valores
 * respaldan los números publicados del pipeline reproducible. Éste declara los
 * de las tres fuentes del hindcast sobre eventos reales, que son productos
 * DISTINTOS aunque dos compartan proveedor.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DECLARACIÓN A PRIORI — QUÉ SIGNIFICA Y POR QUÉ IMPORTA AQUÍ MÁS QUE NUNCA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Estos valores se fijaron y se commitearon ANTES de ejecutar el pipeline sobre
 * un solo dato del hindcast. No es una formalidad: σ y δ son las dos perillas
 * que gobiernan el conflicto, la estrategia de fusión y la anchura del conjunto
 * credal. Ajustarlas después de ver el resultado convierte el hindcast en un
 * ejercicio de retro-ajuste con el que se puede demostrar cualquier cosa.
 *
 * REGLA DURA: si los resultados sugieren que la caracterización es mala, **se
 * REPORTA**, no se retoca. Los valores están bloqueados por
 * `__tests__/data/hindcast-characterization.test.ts`, que los pinea uno a uno:
 * cualquier cambio rompe la suite y aparece en el diff del pull request como lo
 * que es —una redeclaración deliberada de una hipótesis del sistema—, no como un
 * ajuste silencioso.
 *
 * Se derivan de DOS REGLAS CERRADAS y de un único parámetro por fuente, el
 * tamaño de celda del producto. No hay ningún número escrito a mano por fuente:
 * `sigmaPrecipitation()` y `sigmaTemperature()` son funciones puras del tamaño
 * de celda, de modo que no existe el grado de libertad con el que se podría
 * afinar una fuente concreta a la vista de su serie.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REGLA 1 — σ DE LA PRECIPITACIÓN: LINEAL EN EL LADO DE CELDA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *     σ_P(L) = SIGMA_P_PER_10KM · (L / 10 km)
 *
 * La σ de la Def. 3.4 no representa aquí un error instrumental —un reanálisis no
 * tiene instrumento— sino el **error de representatividad**: la distancia
 * esperada entre el valor de la CELDA y el valor en el PUNTO. La precipitación
 * es un campo intermitente y de escala convectiva (celdas de unos pocos km),
 * luego promediar sobre una celda de lado L destruye la varianza espacial dentro
 * de ella, y lo hace tanto más cuanto mayor sea L. Se declara crecimiento lineal
 * en L y no en √L —que es lo habitual para campos suaves— precisamente porque el
 * campo NO es suave: al duplicar el lado de la celda, un núcleo convectivo
 * queda diluido en cuatro veces más área, y el defecto del valor de celda frente
 * al del punto crece con el área, no con su raíz. Lineal en L es el término
 * intermedio conservador entre √L (campo suave) y L² (dilución pura de área).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REGLA 2 — σ DE LA TEMPERATURA: RAÍZ DEL LADO DE CELDA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *     σ_T(L) = SIGMA_T_AT_10KM · √(L / 10 km)
 *
 * La temperatura a 2 m SÍ es un campo aproximadamente suave a estas escalas, con
 * la excepción conocida del gradiente orográfico: la fuente de error dominante
 * al bajar de resolución es que la altitud de la celda deja de ser la del punto
 * (el gradiente adiabático es ~0,65 °C / 100 m). Ese error crece mucho más
 * despacio que el de la precipitación, y √L es el escalado estándar de un error
 * de representatividad sobre un campo con estructura espacial correlacionada.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * δ — IGUALES Y PEQUEÑAS, POR AUSENCIA DE HISTÓRICO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * δ_i es la Ec. (4): la masa que la fuente reserva sobre Θ, "por si he fallado".
 * Calibrarla exige un histórico de fallos POR PRODUCTO —cuántas veces esta
 * fuente devolvió algo sin relación con la realidad— y ese histórico no existe
 * en este repositorio para ninguno de los tres. En ausencia de él:
 *
 *  · **IGUALES.** No hay ninguna base para ordenar los tres productos por
 *    fiabilidad. Declararlas distintas sería inventar una ordenación, y esa
 *    ordenación entraría directamente en los pesos de la regla cautelosa (Ec. 7)
 *    y en la BPA de cada fuente.
 *  · **PEQUEÑAS PERO NO NULAS.** δ = 0 afirmaría que el producto no puede fallar,
 *    lo que es falso: un reanálisis puede colocar la convección en la celda
 *    equivocada, errar el tipo de precipitación (el caso de E2) o arrastrar un
 *    hueco de asimilación. δ = {@link HINDCAST_FAILURE_RATE} deja masa sobre Θ
 *    suficiente para que la cola torrencial siga siendo plausible —que es lo que
 *    mantiene honesto el nivel existencial— sin dominar la fusión.
 *
 * ⚠ CONSECUENCIA CONOCIDA: δ igual para las tres implica pesos de fiabilidad
 * IGUALES en la Ec. (7) y en el baseline de media ponderada. La media ponderada
 * del hindcast es por tanto una media aritmética, y su diferencia con el Kalman
 * estático viene SOLO de las σ. Es una consecuencia de la declaración, no un
 * error del baseline.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ LIMITACIÓN DECLARADA: LAS TRES FUENTES NO SON INDEPENDIENTES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Las tres son productos de asimilación de datos que ingieren **el mismo pool de
 * observaciones globales** (SYNOP, radiosondeos, satélites operativos). ERA5 y
 * el análisis operativo del IFS salen además del mismo centro y de versiones
 * emparentadas del mismo modelo. Consecuencias, todas ellas anticipadas y
 * ninguna corregible con estos datos:
 *
 *  1. **Se espera conflicto BAJO.** El desacuerdo entre ellas mide diferencias de
 *     resolución, de física de convección y de ciclo de asimilación, no
 *     observaciones independientes que se contradigan. K_máx alto sería aquí la
 *     sorpresa, no lo esperado.
 *  2. **H3 (independencia de fuentes) del Teorema 6.1 NO se cumple** en sentido
 *     estricto. La fusión de Dempster supone evidencia independiente; con
 *     fuentes correlacionadas, la concordancia se sobre-cuenta y el conjunto
 *     credal resultante es más estrecho de lo que la evidencia real justifica.
 *     La dirección del error es la NO conservadora, y por eso se declara aquí.
 *  3. **El caso virga del paper (Ejemplo 3.1, §3.4) NO puede reproducirse con
 *     estas fuentes.** Aquel conflicto es físico y vertical —un sensor mide en
 *     altura, otro en superficie, ninguno miente— y exige fuentes que observen
 *     el fenómeno a alturas distintas (radar/satélite frente a pluviómetro). Tres
 *     reanálisis dan tres estimaciones de LA MISMA magnitud en LA MISMA celda:
 *     su desacuerdo es de modelo, no de altura. El hindcast no puede, por
 *     construcción, decir nada sobre el caso virga.
 *
 * La única forma de romper (1)-(3) sería añadir una fuente de observación
 * directa e independiente —una red de pluviómetros como AEMET— y eso exige API
 * key, lo que sacaría al hindcast del régimen reproducible sin credenciales. Ver
 * `fixtures/hindcast/<evento>/manifest.json`.
 */

/** σ y δ declarados de una fuente del hindcast, con su tamaño de celda. */
export interface HindcastSourceCharacterization {
  /** Identificador estable. Es clave de fixture, de CSV y de resultado. */
  sourceId: string;
  /** Etiqueta legible para figuras y tablas. */
  label: string;
  /**
   * Lado nominal de la celda del producto, en km. **Es el ÚNICO parámetro por
   * fuente**: σ_P y σ_T se derivan de él por las reglas 1 y 2 del encabezado.
   */
  cellSizeKm: number;
  /** σ de la precipitación (mm/h) — regla 1. */
  precipitationStddev: number;
  /** σ de la temperatura (°C) — regla 2. */
  temperatureStddev: number;
  /** δ_i ∈ [0, 1) — Def. 3.4 / Ec. (4). Igual para las tres; ver encabezado. */
  failureRate: number;
}

/** Lado de celda de referencia de las dos reglas de escalado, en km. */
export const REFERENCE_CELL_KM = 10;

/** σ_P a {@link REFERENCE_CELL_KM}, en mm/h. Regla 1, lineal en L. */
export const SIGMA_P_PER_10KM = 2.0;

/** σ_T a {@link REFERENCE_CELL_KM}, en °C. Regla 2, escalado en √L. */
export const SIGMA_T_AT_10KM = 1.0;

/**
 * δ declarada de las tres fuentes del hindcast. Ver el encabezado: iguales por
 * ausencia de histórico de fallos por producto, no nulas porque un reanálisis
 * puede errar.
 */
export const HINDCAST_FAILURE_RATE = 0.02;

/** Regla 1 — σ de la precipitación, lineal en el lado de celda. */
export function sigmaPrecipitation(cellSizeKm: number): number {
  return SIGMA_P_PER_10KM * (cellSizeKm / REFERENCE_CELL_KM);
}

/** Regla 2 — σ de la temperatura, en √(lado de celda). */
export function sigmaTemperature(cellSizeKm: number): number {
  return SIGMA_T_AT_10KM * Math.sqrt(cellSizeKm / REFERENCE_CELL_KM);
}

/**
 * Construye la caracterización de una fuente APLICANDO las dos reglas.
 *
 * No admite σ por parámetro a propósito: es lo que impide que alguien declare
 * una σ "a mano" para una fuente concreta después de ver su serie.
 */
function characterize(
  sourceId: string,
  label: string,
  cellSizeKm: number
): HindcastSourceCharacterization {
  return {
    sourceId,
    label,
    cellSizeKm,
    precipitationStddev: sigmaPrecipitation(cellSizeKm),
    temperatureStddev: sigmaTemperature(cellSizeKm),
    failureRate: HINDCAST_FAILURE_RATE,
  };
}

/**
 * ERA5 vía Open-Meteo Archive (`models=era5`).
 *
 * Reanálisis global de ECMWF en malla regular de 0,25°. A la latitud de los dos
 * eventos (~40 °N) eso son ~28 km en longitud y ~28 km en latitud; se declara
 * **25 km**, el valor con que ECMWF documenta habitualmente el producto y el que
 * usa el manifest. σ_P = 5,0 mm/h, σ_T = 1,58 °C.
 */
export const ERA5_CHARACTERIZATION = characterize(
  'era5',
  'ERA5 (reanálisis ECMWF, ~25 km)',
  25
);

/**
 * Análisis operativo del IFS vía Open-Meteo Archive (`models=ecmwf_ifs`).
 *
 * ~9 km, la resolución más fina de las tres. **No es un reanálisis**: es el
 * archivo del análisis operativo de ECMWF, es decir, sucesivas versiones del
 * modelo tal como estaban en producción en cada fecha, no un sistema congelado
 * reprocesando el histórico. Para lo que aquí se usa —una serie horaria de un
 * punto en una ventana de días— la diferencia es irrelevante; se anota porque
 * cambia el significado de la palabra «reanálisis» en las tres afirmaciones de
 * dependencia del encabezado, no su contenido: sigue asimilando el mismo pool de
 * observaciones. σ_P = 1,8 mm/h, σ_T = 0,95 °C.
 *
 * ⚠ SUSTITUYE A ERA5-LAND, que era la segunda fuente prevista para el hindcast.
 * Open-Meteo expone ERA5-Land (~9 km) en su Archive API pero **NO sirve
 * precipitación** para él: devuelve `null` en las 24 horas, en los dos eventos y
 * también para `rain` y `snowfall` (solo la temperatura tiene datos). Está
 * capturado igualmente en `fixtures/hindcast/<evento>/era5-land.json` como
 * evidencia reproducible de esa ausencia, y NO entra en el pipeline. El IFS es
 * su sustituto natural: misma clase de resolución (~9 km) y producto
 * genuinamente distinto de ERA5, que es lo que la tercera fuente debía aportar.
 */
export const ECMWF_IFS_CHARACTERIZATION = characterize(
  'ecmwf-ifs',
  'ECMWF IFS (análisis operativo, ~9 km)',
  9
);

/**
 * MERRA-2 vía NASA POWER horario (`PRECTOTCORR`, `T2M`).
 *
 * Reanálisis de NASA/GMAO en malla de 0,5° × 0,625°, la MÁS GRUESA de las tres:
 * ~55 km en latitud y ~53 km a 40 °N en longitud. Se declara **50 km**, el
 * redondeo con que POWER documenta el producto. σ_P = 10,0 mm/h, σ_T = 2,24 °C.
 *
 * Esa σ_P de 10 mm/h es, con diferencia, la mayor de las tres, y es la
 * consecuencia DESEADA de la regla 1: una celda de 50 km promedia un núcleo
 * convectivo sobre 2.500 km², y su valor de celda no es una medida del punto en
 * ningún sentido útil. La BPA resultante reparte masa sobre varias hipótesis del
 * marco en vez de concentrarla, que es exactamente lo que debe hacer una fuente
 * poco informativa.
 */
export const NASA_POWER_MERRA2_CHARACTERIZATION = characterize(
  'nasa-power',
  'NASA POWER / MERRA-2 (~50 km)',
  50
);

/**
 * Las tres fuentes del hindcast, EN ESTE ORDEN.
 *
 * El orden es parte del contrato: fija el orden de las BPAs que entran en la
 * fusión, el de las columnas del `timeline.csv` y el de las series de las
 * figuras. `fuse` es invariante al orden de las fuentes salvo redondeo, pero los
 * artefactos versionados no lo son, y un orden que dependiera de cómo se leyó el
 * fixture haría fallar los snapshots sin que nada real hubiera cambiado.
 */
export const HINDCAST_SOURCES: readonly HindcastSourceCharacterization[] = [
  ERA5_CHARACTERIZATION,
  ECMWF_IFS_CHARACTERIZATION,
  NASA_POWER_MERRA2_CHARACTERIZATION,
];

/** Identificadores de las tres fuentes, en el orden de {@link HINDCAST_SOURCES}. */
export const HINDCAST_SOURCE_IDS = HINDCAST_SOURCES.map((s) => s.sourceId);
