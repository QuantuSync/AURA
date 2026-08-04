/**
 * AURA v2 — Hindcast: el pipeline completo, hora a hora, sobre dos eventos reales
 *
 *   npm run exp:hindcast          los dos eventos
 *   npm run exp:hindcast:e1       DANA de Valencia, 28-31 oct 2024
 *   npm run exp:hindcast:e2       Filomena, Madrid, 6-12 ene 2021
 *   npm run exp:hindcast:verify   24 h del pico de E1, contra snapshots/
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ⚠ EJERCICIO ILUSTRATIVO, NO VALIDACIÓN OPERATIVA
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Lo que este experimento muestra es el COMPORTAMIENTO DEL PIPELINE cuando la
 * entrada deja de ser un mundo sintético y pasa a ser una serie real: cuánto
 * conflicto ve entre tres reanálisis, qué estrategia de fusión elige, cómo se
 * mueve el conjunto credal y qué dicen los dos niveles del certificado.
 *
 * Lo que NO muestra, y ninguna salida suya puede afirmar:
 *
 *  · **Que AURA «habría evitado» o «habría predicho» nada.** No hay ground
 *    truth: los tres productos son mallas de reanálisis, no el valor en el
 *    punto, de modo que no existe el acierto que habría que medir. Para medir
 *    cobertura hace falta saber qué era verdad, y eso solo lo da el mundo
 *    sintético de `lib/world.ts`.
 *  · **Nada sobre la inundación real de ninguno de los dos episodios.** El DAG
 *    es `createDemoDAG` (Ec. 34): acumulación menos un drenaje constante, con
 *    parámetros DECLARADOS. Es un modelo de juguete, no la hidrología de una
 *    cuenca.
 *  · **Nada sobre el caso virga.** Las tres fuentes asimilan las mismas
 *    observaciones y estiman la MISMA magnitud en la MISMA celda; su desacuerdo
 *    es de modelo, no de altura. Ver
 *    `src/data/sources/hindcast-characterization.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ SE HACE EN CADA HORA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   precipitación de las 3 fuentes (mm/h)
 *     → BPAs con la σ y la δ DECLARADAS A PRIORI (Def. 3.4)
 *     → conflicto: K_máx / K_global crudos, medida por pares y regla C1 (Def. 3.5-3.6)
 *     → fusión (Dempster / cautelosa / envolvente)
 *     → conjunto credal intervalar (§8) y banda de evidencia al 95 %
 *     → propagación por el DAG de la demo, con esa precipitación SOSTENIDA
 *       sobre el horizonte de 2 h (Ec. 34, evaluado en t = 2)
 *     → certificado de dos niveles: veredicto existencial + [Bel(E), Pl(E)]
 *     → decisión ('safe' / 'warning' / 'critical')
 *
 * y, sobre los MISMOS tres valores, los dos baselines clásicos —media ponderada
 * y Kalman estático— con las MISMAS fórmulas que la campaña de cobertura
 * (`lib/methods.ts`), para que la comparación signifique lo mismo en los dos
 * experimentos.
 *
 * «SOSTENIDA EN EL HORIZONTE» es una simplificación declarada, y de las que
 * importan: la Ec. (34) integra una tasa constante durante 2 h, luego la h de la
 * hora t es «lo que se acumularía si lloviera lo de esa hora durante las dos
 * siguientes». NO es la acumulación real del evento, que exigiría integrar la
 * serie. Se hace así porque es exactamente lo que hace el pipeline de la demo, y
 * el objeto del hindcast es ver ESE pipeline sobre datos reales, no construir
 * uno nuevo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SIN ALEATORIEDAD
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * El hindcast es DETERMINISTA por construcción: no consume `ctx.rng` ni una sola
 * vez. La semilla sigue siendo obligatoria porque el contrato del runner lo
 * exige de todo experimento (y esa obligación es lo que hace que nadie la olvide
 * donde sí importa), y `config.json` lo declara explícitamente para que nadie
 * busque una realización del PRNG que no existe.
 */

import { createDemoDAG } from '@/core/causal-dag/demo-dag';
import { toCredalIntervalSet } from '@/core/credal-propagation/credal-interval-set';
import { FusionConfig } from '@/core/dempster-shafer/types';
import {
  DEMO_H_CRIT,
  DEMO_PIPELINE_DAG_PARAMS,
  DEMO_SAFETY_SPEC,
  DEMO_UNSAFE_PROBABILITY_THRESHOLD,
  DemoSource,
  runDemoPipeline,
} from '@/core/pipeline/demo-pipeline';
import { HINDCAST_SOURCES } from '@/data/sources/hindcast-characterization';
import { PRECIPITATION_FRAME } from '@/lib/constants';

import { coreHull } from '../lib/figures';
import { HindcastEvent, eventOf, HINDCAST_EVENTS } from '../lib/hindcast-events';
import {
  FigureContext,
  HindcastPoint,
  conflictFigure,
  plausibilityFigure,
  precipitationFigure,
  widthFigure,
} from './lib/hindcast-figures';
import { HourRecord, loadEventSeries, peakWindow } from './lib/hindcast-series';
import {
  EVIDENCE_BAND_MASS,
  MethodInterval,
  auraFromValues,
  kalmanInterval,
  pignisticMean,
  weightedMeanInterval,
} from './lib/methods';
import {
  fusionConfigFor,
  measureOverrideOf,
  nameFor,
  profileOf,
  ruleOverrideOf,
} from './lib/profile';
import { ExperimentContext, ExperimentOutput, main } from './runner';

/** Horas del pico de E1 que ve el perfil `verify`. */
const VERIFY_PEAK_HOURS = 24;

/** Semiventana, en horas, del desglose «durante el pico» del análisis. */
const PEAK_WINDOW_HALF_WIDTH = 6;

/** Todo lo que se computa para una hora. */
interface HourResult {
  iso: string;
  timestamp: number;
  precipitation: number[];
  temperature: number[];
  /** Resumen pignístico de la BPA fusionada — solo para ordenar. Ver arriba. */
  fusedPignistic: number;
  maxConflict: number;
  globalConflict: number;
  /** máx_{i≠j} de la MEDIDA vigente — lo que C1 comparó con κ₁ y κ₂. */
  measureConflict: number;
  /**
   * máx_{i≠j} K_floor_ij — el suelo estructural que la medida descuenta, o
   * `null` si la medida no lo define. Con D2 es `null`: la distancia de
   * Jousselme no resta un suelo, elimina el auto-conflicto por construcción.
   */
  maxFloor: number | null;
  decisionConflict: number;
  degeneracyGuard: boolean;
  method: string;
  /** Hull del conjunto credal sobre P (Capa 1). */
  pHull: { lower: number; upper: number };
  /** Banda de evidencia al 95 % sobre P (Capa 1). */
  band: MethodInterval;
  /** Reachable set sobre h (Capa 2) — el del certificado. */
  hReachable: { lower: number; upper: number };
  belLower: number;
  plUpper: number;
  certificateStatus: string;
  decision: string;
  weightedMean: MethodInterval;
  kalman: MethodInterval;
}

const width = (i: { lower: number; upper: number }): number => i.upper - i.lower;

/**
 * Máximo fuera de la diagonal de una matriz simétrica, o `null` si no la hay.
 * Fuera de la diagonal porque la diagonal de `floorMatrix` es el auto-conflicto
 * de cada fuente consigo misma, que no interviene en ninguna decisión.
 */
function maxOffDiagonal(matrix: number[][] | null): number | null {
  if (matrix === null) return null;
  let best = 0;
  for (let i = 0; i < matrix.length; i++) {
    for (let j = i + 1; j < matrix.length; j++) best = Math.max(best, matrix[i][j]);
  }
  return best;
}

function evaluateHour(hour: HourRecord, fusionConfig = fusionConfigFor(undefined)): HourResult {
  const sources: DemoSource[] = HINDCAST_SOURCES.map((c, i) => ({
    sourceId: c.sourceId,
    value: hour.precipitation[i],
    stddev: c.precipitationStddev,
    failureRate: c.failureRate,
  }));

  const r = runDemoPipeline({ sources, fusionConfig });

  // La banda de evidencia al 95 % sale del MISMO conjunto credal de entrada que
  // el pipeline propaga, no de una fusión recalculada aparte.
  const bandHull = coreHull(r.inputCredalSet, EVIDENCE_BAND_MASS);

  return {
    iso: hour.iso,
    timestamp: hour.timestamp,
    precipitation: [...hour.precipitation],
    temperature: [...hour.temperature],
    fusedPignistic: pignisticMean(r.fusion.fused),
    maxConflict: r.fusion.maxConflict,
    globalConflict: r.fusion.globalConflict,
    measureConflict: r.fusion.measureConflict,
    maxFloor: maxOffDiagonal(r.fusion.floorMatrix),
    decisionConflict: r.fusion.decisionConflict,
    degeneracyGuard: r.fusion.degeneracyGuard,
    method: r.fusion.method,
    pHull: {
      lower: r.credalSet.continuousInterval.lower,
      upper: r.credalSet.continuousInterval.upper,
    },
    band: { lower: bandHull.lower, upper: bandHull.upper, width: width(bandHull) },
    hReachable: { lower: r.reachableInterval.lower, upper: r.reachableInterval.upper },
    belLower: r.probabilityBounds.belLower,
    plUpper: r.probabilityBounds.plUpper,
    certificateStatus: r.decision.certificate.status,
    decision: r.decision.status,
    weightedMean: weightedMeanInterval(hour.precipitation, HINDCAST_SOURCES),
    kalman: kalmanInterval(hour.precipitation, HINDCAST_SOURCES),
  };
}

/** Valores de referencia del suelo estructural de conflicto, en mm/h. */
const FLOOR_PROBE_VALUES = [0, 0.5, 1, 2, 5, 10, 20, 40] as const;

/**
 * SUELO ESTRUCTURAL DE CONFLICTO: el K que ve el sistema cuando las tres fuentes
 * están de acuerdo PERFECTO.
 *
 * Se calcula fusionando tres mediciones IDÉNTICAS —el mismo valor exacto en las
 * tres— con las σ y δ declaradas a priori. Todo el conflicto que quede ahí no
 * puede ser desacuerdo: es un residuo de que las tres BPAs reparten esa misma
 * medición de forma distinta sobre las hipótesis del marco, porque sus σ son
 * distintas (5,0 / 1,8 / 10,0 mm/h, en el orden canónico de las fuentes). La fuente fina concentra casi toda la masa
 * en una hipótesis y la gruesa la extiende sobre tres; el solape entre ellas es
 * incompleto, y K_ij > 0 aunque midan lo mismo.
 *
 * Es la magnitud que separa las dos lecturas posibles de un K alto en el
 * hindcast —«las fuentes se contradicen» frente a «la discretización y la
 * heterogeneidad de σ producen conflicto por sí solas»— y por eso se computa y
 * se publica junto al perfil observado en lugar de dejarlo a la interpretación.
 *
 * Se computa con el K CRUDO y con la MEDIDA vigente, en columnas separadas: el
 * primero es el suelo que motivó la corrección de `docs/ERRATA.md` §9 Capa 3, y
 * el segundo es lo que queda de él después. Comparar los dos es el objeto de la
 * Fase C, que es DESCRIPCIÓN y no validación —los resultados del hindcast ya
 * eran conocidos cuando se eligió la medida—.
 *
 * Generaliza el «hallazgo colateral» del README de experimentos (los fixtures
 * son más concordantes que el ruido real): allí el efecto se atribuía a la
 * DISPERSIÓN entre mediciones; aquí se ve que existe incluso con dispersión
 * CERO, por la sola heterogeneidad de las σ declaradas.
 */
function structuralConflictFloor(fusionConfig = fusionConfigFor(undefined)) {
  return FLOOR_PROBE_VALUES.map((v) => {
    const r = auraFromValues(
      HINDCAST_SOURCES.map(() => v),
      HINDCAST_SOURCES,
      fusionConfig
    );
    return {
      valueMmH: v,
      /** K_máx CRUDO — el suelo tal como lo veía la medida D0. */
      maxConflict: r.maxConflict,
      /** El mismo suelo visto por la MEDIDA vigente. Es la columna nueva. */
      measureConflict: r.measureConflict,
      /** máx K_floor descontado, o `null` si la medida no define suelo. */
      maxFloor: r.maxFloor,
      globalConflict: r.globalConflict,
      method: r.fusionMethod,
      reachesDempster: r.fusionMethod === 'dempster',
    };
  });
}

/** Cuantiles de una muestra, por el mismo criterio que `virga.ts`. */
function quantiles(values: readonly number[]) {
  const s = [...values].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { min: s[0], p25: q(0.25), median: q(0.5), p75: q(0.75), p95: q(0.95), max: s[s.length - 1] };
}

/** Reparto de estrategias de fusión sobre un subconjunto de horas. */
function methodShares(rows: readonly HourResult[]) {
  const counts: Record<string, number> = { dempster: 0, cautious: 0, envelope: 0 };
  for (const r of rows) counts[r.method]++;
  const nz = rows.length === 0 ? 1 : rows.length;
  return {
    counts,
    shares: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v / nz])),
    hours: rows.length,
  };
}

const hoursBetween = (a: number, b: number): number => (a - b) / 3_600_000;

/** Todo lo que la Tarea 4 pregunta, computado y no redactado a mano. */
function analyze(
  event: HindcastEvent,
  rows: readonly HourResult[],
  fusionConfig: FusionConfig
) {
  const meanOf = (r: HourResult) =>
    r.precipitation.reduce((s, v) => s + v, 0) / r.precipitation.length;

  const peakByMean = rows.reduce((best, r) => (meanOf(r) > meanOf(best) ? r : best), rows[0]);
  const peakBySource = HINDCAST_SOURCES.map((c, i) => {
    const best = rows.reduce((b, r) => (r.precipitation[i] > b.precipitation[i] ? r : b), rows[0]);
    return { sourceId: c.sourceId, iso: best.iso, valueMmH: best.precipitation[i] };
  });
  const peakByFused = rows.reduce((b, r) => (r.fusedPignistic > b.fusedPignistic ? r : b), rows[0]);

  const critical = rows.filter((r) => r.decision === 'critical');
  const first = critical[0] ?? null;
  const last = critical[critical.length - 1] ?? null;

  const peakWindowRows = rows.filter(
    (r) => Math.abs(hoursBetween(r.timestamp, peakByMean.timestamp)) <= PEAK_WINDOW_HALF_WIDTH
  );

  // ¿Los baselines dicen algo distinto de su intervalo fijo? La anchura es la
  // prueba directa: si el conjunto de anchuras distintas tiene un solo elemento,
  // el intervalo no responde a la evidencia en absoluto.
  const distinctWidths = (pick: (r: HourResult) => MethodInterval) =>
    new Set(rows.map((r) => pick(r).width.toFixed(9))).size;
  const missesSomeSource = (pick: (r: HourResult) => MethodInterval) =>
    rows.filter((r) => {
      const iv = pick(r);
      return r.precipitation.some((v) => v < iv.lower || v > iv.upper);
    }).length;

  const belowZero = rows.filter((r) => r.temperature.every((t) => t < 0));
  const allTemps = rows.flatMap((r) => r.temperature);

  const floor = structuralConflictFloor(fusionConfig);
  const floorAtZero = floor.find((f) => f.valueMmH === 0)!.maxConflict;
  const measureFloorAtZero = floor.find((f) => f.valueMmH === 0)!.measureConflict;

  return {
    hours: rows.length,

    peak: {
      bySource: peakBySource,
      byMeanOfSources: { iso: peakByMean.iso, meanMmH: meanOf(peakByMean) },
      byFusedPignistic: { iso: peakByFused.iso, pignisticMmH: peakByFused.fusedPignistic },
      note:
        'El pico «de las fuentes» es el de la media de las tres, y es la referencia contra ' +
        'la que se mide el escalado. Los picos por fuente se dan aparte porque no coinciden ' +
        'entre sí: la resolución de cada producto decide cuándo y cuánto ve.',
    },

    escalation: {
      pCritical: DEMO_UNSAFE_PROBABILITY_THRESHOLD,
      criticalHours: critical.length,
      warningHours: rows.filter((r) => r.decision === 'warning').length,
      safeHours: rows.filter((r) => r.decision === 'safe').length,
      firstCriticalIso: first?.iso ?? null,
      lastCriticalIso: last?.iso ?? null,
      firstCriticalPlUpper: first?.plUpper ?? null,
      hoursFromFirstCriticalToSourcePeak:
        first === null ? null : hoursBetween(peakByMean.timestamp, first.timestamp),
      // Si el primer 'critical' es la PRIMERA hora evaluada, el cruce del umbral
      // pudo ocurrir antes de que empezara la ventana capturada, y la distancia
      // al pico es una COTA INFERIOR, no una medida. Callarlo convertiría un
      // artefacto del recorte temporal en una afirmación sobre el evento.
      firstCriticalAtWindowStart: first !== null && first.iso === rows[0].iso,
      maxPlUpper: Math.max(...rows.map((r) => r.plUpper)),
      maxBelLower: Math.max(...rows.map((r) => r.belLower)),
      plUpperAtSourcePeak: peakByMean.plUpper,
      note:
        'hoursFromFirstCriticalToSourcePeak > 0 significa que plUpper cruzó p_crít ANTES ' +
        'del pico de precipitación de las fuentes, y cuántas horas antes. Es una ' +
        'observación sobre la SERIE, no una afirmación de anticipación operativa: el ' +
        'pipeline ve cada hora aislada y sin ninguna información del futuro.',
    },

    fusionDuringPeak: {
      window: `±${PEAK_WINDOW_HALF_WIDTH} h alrededor de ${peakByMean.iso}`,
      ...methodShares(peakWindowRows),
      wholeEvent: methodShares(rows),
    },

    baselines: {
      weightedMean: {
        distinctWidths: distinctWidths((r) => r.weightedMean),
        widthMmH: rows[0].weightedMean.width,
        hoursExcludingSomeSource: missesSomeSource((r) => r.weightedMean),
      },
      kalman: {
        distinctWidths: distinctWidths((r) => r.kalman),
        widthMmH: rows[0].kalman.width,
        hoursExcludingSomeSource: missesSomeSource((r) => r.kalman),
      },
      auraBand95: {
        distinctWidths: distinctWidths((r) => r.band),
        minWidthMmH: Math.min(...rows.map((r) => r.band.width)),
        maxWidthMmH: Math.max(...rows.map((r) => r.band.width)),
        meanWidthMmH: rows.reduce((s, r) => s + r.band.width, 0) / rows.length,
      },
      note:
        '`distinctWidths` = 1 significa que la anchura del intervalo es la MISMA en todas ' +
        'las horas del evento: depende solo de σ y δ, no de lo que las fuentes hayan medido. ' +
        '`hoursExcludingSomeSource` cuenta las horas en que el intervalo del baseline deja ' +
        'FUERA a alguna de las tres fuentes que dice resumir.',
    },

    conflictProfile: {
      maxConflict: quantiles(rows.map((r) => r.maxConflict)),
      globalConflict: quantiles(rows.map((r) => r.globalConflict)),
      measureConflict: quantiles(rows.map((r) => r.measureConflict)),
      decisionConflict: quantiles(rows.map((r) => r.decisionConflict)),
      degeneracyGuardHours: rows.filter((r) => r.degeneracyGuard).length,
      hoursWithAnyPrecipitation: rows.filter((r) => r.precipitation.some((v) => v > 0)).length,
      hoursAllDry: rows.filter((r) => r.precipitation.every((v) => v === 0)).length,
      structuralFloor: floor,
      // La comparación explícita, para que no dependa de que alguien cruce dos
      // tablas: cuánto del conflicto MÍNIMO del evento sobra por encima del que
      // habría con acuerdo perfecto y precipitación nula. Un valor ≈ 0 dice que
      // el mínimo observado NO mide desacuerdo entre reanálisis.
      minObservedMaxConflictAboveFloor:
        quantiles(rows.map((r) => r.maxConflict)).min - floorAtZero,
      floorAtZeroPrecipitation: floorAtZero,
      /**
       * El MISMO suelo visto por la medida vigente, y el mínimo observado en el
       * evento medido con ella. Es la comparación que la iteración del suelo
       * pide: cuánto del conflicto mínimo sobrevive a la corrección de escala.
       */
      measureFloorAtZeroPrecipitation: measureFloorAtZero,
      minObservedMeasureConflictAboveFloor:
        quantiles(rows.map((r) => r.measureConflict)).min - measureFloorAtZero,
      measure: fusionConfig.measure,
      kappa1: fusionConfig.kappa1,
      floorExceedsKappa1: floorAtZero > fusionConfig.kappa1,
      measureFloorExceedsKappa1: measureFloorAtZero > fusionConfig.kappa1,
      structuralFloorNote:
        'K_máx y K_global con las TRES FUENTES MIDIENDO EXACTAMENTE LO MISMO. Es el conflicto ' +
        'que el sistema ve con acuerdo perfecto, y por tanto un SUELO que ningún dato puede ' +
        'bajar: procede de que las tres BPAs reparten la misma medición de forma distinta ' +
        'sobre las hipótesis del marco, porque sus σ declaradas son 5,0 / 1,8 / 10,0 mm/h. ' +
        'Compárese con `maxConflict.min` observado: si coinciden, el mínimo del evento no ' +
        'mide desacuerdo entre reanálisis, mide discretización. `floorExceedsKappa1` es la ' +
        'consecuencia dura: si el suelo ya supera κ₁, la regla de Dempster es INALCANZABLE ' +
        'en ese régimen por mucho que las fuentes concuerden.',
      note:
        'Las tres fuentes son productos de asimilación que comparten observaciones, luego ' +
        'este perfil mide diferencias de resolución y de física de convección, NO evidencia ' +
        'independiente en contradicción. Se esperaba conflicto bajo antes de ejecutar nada. ' +
        'Léase SIEMPRE contra `structuralFloor`.',
    },

    temperature: {
      hoursAllSourcesBelowZero: belowZero.length,
      fractionAllSourcesBelowZero: belowZero.length / rows.length,
      minC: Math.min(...allTemps),
      maxC: Math.max(...allTemps),
      meanC: allTemps.reduce((s, v) => s + v, 0) / allTemps.length,
      note:
        event.caveat === null
          ? 'La temperatura se captura y se reporta, pero NO entra en el DAG de la demo: la ' +
            'Ec. (34) solo consume precipitación. Está aquí para poder afirmar en qué régimen ' +
            'físico ocurrió cada evento.'
          : 'CRÍTICO EN ESTE EVENTO. Con T < 0 °C sostenida la precipitación no fue lluvia, y ' +
            'el DAG de la demo —que acumula lluvia y resta un drenaje constante— no modela el ' +
            'mecanismo real. El pipeline no consume la temperatura y por tanto NO PUEDE ' +
            'saberlo: dirá exactamente lo mismo que diría con lluvia. Ese silencio es el ' +
            'hallazgo, y es un límite del MODELO (el DAG), no del motor de fusión. Conecta ' +
            'con el modo de fallo «hielo bloqueando drenes» que §6.3 (H2) del paper cita como ' +
            'ejemplo de error de modelo no capturado por ε_h.',
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────

const CSV_HEADER = [
  'iso',
  'hour_index',
  ...HINDCAST_SOURCES.map((c) => `prec_${c.sourceId.replace(/-/g, '_')}`),
  ...HINDCAST_SOURCES.map((c) => `temp_${c.sourceId.replace(/-/g, '_')}`),
  'fused_pignistic',
  'K_max',
  'K_global',
  'K_measure',
  'K_floor',
  'K_decision',
  'guard',
  'method',
  'p_hull_lower',
  'p_hull_upper',
  'band95_lower',
  'band95_upper',
  'band95_width',
  'h_reachable_lower',
  'h_reachable_upper',
  'belLower',
  'plUpper',
  'certificate',
  'decision',
  'wmean_lower',
  'wmean_upper',
  'kalman_lower',
  'kalman_upper',
] as const;

function csvRow(r: HourResult, index: number): (string | number)[] {
  return [
    r.iso,
    index,
    ...r.precipitation,
    ...r.temperature,
    r.fusedPignistic,
    r.maxConflict,
    r.globalConflict,
    r.measureConflict,
    r.maxFloor ?? '',
    r.decisionConflict,
    r.degeneracyGuard ? 1 : 0,
    r.method,
    r.pHull.lower,
    r.pHull.upper,
    r.band.lower,
    r.band.upper,
    r.band.width,
    r.hReachable.lower,
    r.hReachable.upper,
    r.belLower,
    r.plUpper,
    r.certificateStatus,
    r.decision,
    r.weightedMean.lower,
    r.weightedMean.upper,
    r.kalman.lower,
    r.kalman.upper,
  ];
}

/** Fila completa de una hora, para la tabla de horas clave de `results.json`. */
const keyHourRecord = (r: HourResult) =>
  Object.fromEntries(CSV_HEADER.map((k, i) => [k, csvRow(r, -1)[i]]).filter(([k]) => k !== 'hour_index'));

async function run(ctx: ExperimentContext): Promise<ExperimentOutput> {
  const fusionConfig = fusionConfigFor(ruleOverride, measureOverride);
  const series = await loadEventSeries(event);

  const peakHours = ctx.flags.number('peak-hours', VERIFY_PEAK_HOURS);
  const selected =
    profile === 'verify' ? peakWindow(series.hours, peakHours) : series.hours;

  ctx.log(
    `${event.id}: ${series.hours.length} horas alineadas, ` +
      `${series.excluded.length} excluidas, ${selected.length} evaluadas` +
      (profile === 'verify' ? ` (ventana de pico de ${peakHours} h)` : '')
  );

  const rows = selected.map((h) => evaluateHour(h, fusionConfig));

  const keyHours = [...rows]
    .sort((a, b) => b.fusedPignistic - a.fusedPignistic || a.timestamp - b.timestamp)
    .slice(0, 5)
    .map(keyHourRecord);

  const meanOfSources = (r: HourResult) =>
    r.precipitation.reduce((s, v) => s + v, 0) / r.precipitation.length;
  const keyHoursBySourceMean = [...rows]
    .sort((a, b) => meanOfSources(b) - meanOfSources(a) || a.timestamp - b.timestamp)
    .slice(0, 5)
    .map(keyHourRecord);

  const analysis = analyze(event, rows, fusionConfig);

  ctx.log(
    `  fusión: ` +
      Object.entries(analysis.fusionDuringPeak.wholeEvent.shares)
        .map(([k, v]) => `${k} ${(v * 100).toFixed(1)} %`)
        .join(', ')
  );
  ctx.log(
    `  decisión: ${analysis.escalation.criticalHours} critical / ` +
      `${analysis.escalation.warningHours} warning / ${analysis.escalation.safeHours} safe · ` +
      `plUpper máx ${analysis.escalation.maxPlUpper.toExponential(3)}`
  );

  const points: HindcastPoint[] = rows.map((r) => ({
    iso: r.iso,
    precipitation: r.precipitation,
    band: r.band,
    hull: r.pHull,
    maxConflict: r.maxConflict,
    globalConflict: r.globalConflict,
    plUpper: r.plUpper,
    widths: {
      band: r.band.width,
      weightedMean: r.weightedMean.width,
      kalman: r.kalman.width,
    },
  }));

  const figureContext: FigureContext = {
    title: `${event.label} — hindcast ILUSTRATIVO del pipeline AURA v2`,
    subtitle:
      `${event.startDate} … ${event.endDate} · ${event.point.latitude}, ` +
      `${event.point.longitude} · ${rows.length} horas · regla ${fusionConfig.rule} · ` +
      `NO es validación operativa: sin ground truth y con el DAG de juguete de la demo`,
    caveatHeadline: event.caveatHeadline,
    caveat: event.caveat,
    sourceLabels: HINDCAST_SOURCES.map((c) => c.label),
    points,
  };

  const dagParams = { ...DEMO_PIPELINE_DAG_PARAMS };

  return {
    config: {
      event: {
        id: event.id,
        label: event.label,
        startDate: event.startDate,
        endDate: event.endDate,
        latitude: event.point.latitude,
        longitude: event.point.longitude,
      },
      profile,
      peakHours: profile === 'verify' ? peakHours : null,
      conflictRule: fusionConfig.rule,
      conflictMeasure: fusionConfig.measure,
      kappa1: fusionConfig.kappa1,
      kappa2: fusionConfig.kappa2,
      kappaDegeneracy: fusionConfig.kappaDegeneracy,
      evidenceBandMass: EVIDENCE_BAND_MASS,
      hCrit: DEMO_H_CRIT,
      pCritical: DEMO_UNSAFE_PROBABILITY_THRESHOLD,
      safeRegion: DEMO_SAFETY_SPEC.safeRegion,
      dag: {
        initialLevel: dagParams.initialLevel,
        drainageCapacity: dagParams.drainageCapacity,
        horizon: dagParams.horizon,
        modelErrorBound: dagParams.modelErrorBound,
        nodes: createDemoDAG(dagParams).nodes.map((nd) => nd.id),
      },
      frame: {
        variable: PRECIPITATION_FRAME.variable,
        unit: PRECIPITATION_FRAME.unit,
        domainBound: PRECIPITATION_FRAME.domainBound,
      },
      characterization: HINDCAST_SOURCES.map((c) => ({
        sourceId: c.sourceId,
        cellSizeKm: c.cellSizeKm,
        precipitationStddev: c.precipitationStddev,
        temperatureStddev: c.temperatureStddev,
        failureRate: c.failureRate,
      })),
      randomness:
        'NINGUNA. El hindcast no consume ctx.rng: la entrada son series fijas de fixtures y ' +
        'todo el pipeline es determinista. La semilla es obligatoria por el contrato del ' +
        'runner, y no influye en ningún número de esta salida.',
      network:
        'NINGUNA. Los datos salen de fixtures/hindcast/, capturados una vez con ' +
        '`npm run hindcast:capture`.',
    },

    results: {
      nature:
        'EJERCICIO ILUSTRATIVO DEL COMPORTAMIENTO DEL PIPELINE SOBRE DATOS REALES. No es una ' +
        'validación operativa y ninguna cifra de aquí puede redactarse como «AURA habría ' +
        'evitado X» o «AURA habría predicho X»: no hay ground truth (los tres productos son ' +
        'mallas de reanálisis, no el valor en el punto), el DAG es el de juguete de la demo ' +
        '(Ec. 34) y las tres fuentes no son independientes (H3).',

      /**
       * La declaración que exige la corrección del suelo estructural. Va en el
       * resultado y no solo en el README porque un `results.json` que se cite
       * suelto tiene que poder decir por sí mismo qué NO es.
       */
      selectionDisclosure:
        'ESTA EJECUCIÓN ES DESCRIPCIÓN, NO VALIDACIÓN CIEGA. Los resultados del hindcast bajo la ' +
        'medida D0 YA ERAN CONOCIDOS —ejecutados, commiteados y descritos en docs/ERRATA.md §9— ' +
        'ANTES de que se eligiera la medida de conflicto con que se vuelve a ejecutar aquí. La ' +
        'selección de la medida se hizo EXCLUSIVAMENTE sobre mundos sintéticos con ground truth ' +
        '(`npm run exp:conflict-floor`, semilla 20261007), y el bloque que usa las σ del ' +
        'hindcast usa esas σ sobre mundos sintéticos NUEVOS, no sobre estos datos. Ninguna cifra ' +
        'de esta salida puede presentarse como confirmación independiente de la medida elegida.',

      caveat: event.caveat,

      event: {
        id: event.id,
        label: event.label,
        description: event.description,
        startDate: event.startDate,
        endDate: event.endDate,
        point: {
          latitude: event.point.latitude,
          longitude: event.point.longitude,
          rationale: event.point.rationale,
        },
      },

      data: {
        hoursAvailable: series.hours.length,
        hoursEvaluated: rows.length,
        excludedHours: series.excluded,
        excludedHoursPolicy:
          'Una hora entra solo si las TRES fuentes tienen precipitación y temperatura ' +
          'válidas. No se imputa: imputar inventaría una tercera medición concordante, ' +
          'bajaría el conflicto y estrecharía el conjunto credal — error en la dirección NO ' +
          'conservadora y además invisible.',
        perSourceHours: series.perSourceHours,
        gridPoints: series.gridPoints,
        gridPointsNote:
          'Punto de malla que devolvió cada proveedor para las MISMAS coordenadas pedidas. ' +
          'Las diferencias entre ellos son un efecto directo de la resolución de cada ' +
          'producto, y parte de por qué las tres series no coinciden.',
      },

      keyHours,
      keyHoursNote:
        'Las 5 horas de mayor precipitación FUSIONADA, ordenadas de más a menos. El criterio ' +
        'de orden es la esperanza pignística de la BPA fusionada, un resumen puntual que se ' +
        'usa SOLO para ordenar y para ninguna decisión: una BPA no tiene un valor, tiene un ' +
        'conjunto credal.',
      keyHoursCaveat:
        'OJO AL SESGO DE ESTE ORDEN, que es un hallazgo por sí mismo. Cuando la Def. 3.6 ' +
        'escala a ENVOLVENTE, la BPA fusionada deja de ser una estimación y pasa a ser una ' +
        'cobertura conservadora repartida sobre todo el marco, de modo que su esperanza ' +
        'pignística SUBE con el conflicto y no solo con la lluvia. «Mayor precipitación ' +
        'fusionada» ordena por tanto una mezcla de intensidad y desacuerdo, y en E1 las cinco ' +
        'horas seleccionadas son precisamente horas de envolvente. Se publica igual porque es ' +
        'la lectura literal de «precipitación fusionada», y junto a ella va ' +
        '`keyHoursBySourceMean`, que ordena por la media cruda de las tres fuentes y no tiene ' +
        'ese acoplamiento.',
      keyHoursBySourceMean,
      keyHoursBySourceMeanNote:
        'Las mismas 5 filas, ordenadas por la MEDIA ARITMÉTICA de las tres fuentes — un ' +
        'criterio ciego al conflicto y a la estrategia de fusión. Es la tabla que hay que ' +
        'mirar para preguntar «cuándo llovió más según los productos»; `keyHours` es la que ' +
        'hay que mirar para preguntar «cuándo dijo más el sistema».',

      analysis,
    },

    csvHeader: [...CSV_HEADER],
    csvRows: rows.map(csvRow),

    artifacts: {
      'figures/f1-precipitacion-credal.svg': precipitationFigure(figureContext),
      'figures/f2-conflicto.svg': conflictFigure(figureContext, {
        kappa1: fusionConfig.kappa1,
        kappa2: fusionConfig.kappa2,
        kappaDegeneracy: fusionConfig.kappaDegeneracy,
      }),
      'figures/f3-plupper.svg': plausibilityFigure(
        figureContext,
        DEMO_UNSAFE_PROBABILITY_THRESHOLD
      ),
      'figures/f4-anchuras.svg': widthFigure(figureContext),
    },
  };
}

/**
 * Lee `--event` antes de `main()`, con la MISMA lógica pre-`parseFlags` que
 * `profileOf` y por el mismo motivo: el evento entra en el nombre del
 * experimento, y el nombre fija el directorio de salida y con él el snapshot.
 */
function eventFromArgv(argv: readonly string[] = process.argv.slice(2)): HindcastEvent {
  let value: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--event') value = argv[i + 1];
    else if (argv[i].startsWith('--event=')) value = argv[i].slice('--event='.length);
  }
  if (value === undefined) {
    throw new Error(
      `--event es obligatorio en el hindcast: cada evento escribe en su propio directorio ` +
        `de salida. Disponibles: ${HINDCAST_EVENTS.map((e) => e.id).join(', ')} ` +
        `(o sus alias e1, e2).`
    );
  }
  return eventOf(value);
}

const profile = profileOf();
const ruleOverride = ruleOverrideOf();
const measureOverride = measureOverrideOf();
const event = eventFromArgv();

main({
  name: nameFor(`hindcast-${event.id.split('-')[0]}`, profile, ruleOverride, measureOverride),
  description:
    `Hindcast ILUSTRATIVO del pipeline completo, hora a hora, sobre ${event.label}. ` +
    `Tres reanálisis públicos sin API key, regla de conflicto del sistema, DAG de la demo y ` +
    `los dos baselines clásicos. NO es una validación operativa.`,
  run,
});
