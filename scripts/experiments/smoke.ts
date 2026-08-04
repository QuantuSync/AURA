/**
 * AURA v2 — Experimento de ejemplo: `smoke`
 *
 * El experimento MÍNIMO que ejercita el contrato completo de
 * `scripts/experiments/README.md`: semilla obligatoria, PRNG compartido,
 * salida canónica en `out/experiments/smoke/`. Entra en `npm run verify`, de
 * modo que si el runner se rompe se sabe en el mismo commit y no seis meses
 * después, al lanzar el primer experimento de verdad.
 *
 * QUÉ MIDE. Barre `--samples` escenarios de tres fuentes concordantes en torno a
 * una intensidad verdadera sorteada en [0, 60) mm/h, ejecuta el pipeline de la
 * demo sobre cada uno y tabula cómo se reparten los dos niveles del certificado.
 * Es el barrido que hace visible la tesis de docs/ERRATA.md §8 sobre un rango
 * continuo de evidencia: el nivel EXISTENCIAL es constante —siempre
 * 'unsafe-possible', mismo reachable set— mientras Pl(E) recorre cuatro órdenes
 * de magnitud y la decisión operativa cambia de 'warning' a 'critical'.
 *
 * NO ES una campaña de cobertura: no muestrea mundos ni comprueba
 * Bel(E) ≤ P(E) ≤ Pl(E) contra una probabilidad empírica — eso lo hace la
 * property B10 (`__tests__/properties/credal-propagation.property.test.ts`) con
 * 20.000 casos. Aquí solo se verifica el invariante barato 0 ≤ Bel ≤ Pl ≤ 1.
 */

import {
  DEMO_UNSAFE_PROBABILITY_THRESHOLD,
  DemoSource,
  runDemoPipeline,
} from '@/core/pipeline/demo-pipeline';
import { DEFAULT_FUSION_CONFIG } from '@/core/dempster-shafer/types';
import { SOURCE_CHARACTERIZATIONS } from '@/data/sources/characterization';
import { normal, uniform } from '@/lib/prng';
import { ExperimentContext, ExperimentOutput, main } from './runner';

/** Intensidad verdadera máxima sorteada (mm/h): cubre de *nula* a *intensa*. */
const MAX_TRUE_PRECIPITATION = 60;

function run(ctx: ExperimentContext): ExperimentOutput {
  const samples = ctx.flags.number('samples', 200);
  if (!Number.isInteger(samples) || samples <= 0) {
    throw new Error(`--samples debe ser un entero positivo; recibido ${samples}.`);
  }

  const rows: (string | number)[][] = [];
  const byDecision: Record<string, number> = {};
  const byMethod: Record<string, number> = {};
  const statuses = new Set<string>();
  const reachables = new Set<string>();
  const plUppers: number[] = [];
  let boundsViolations = 0;

  for (let i = 0; i < samples; i++) {
    const truth = uniform(ctx.rng, 0, MAX_TRUE_PRECIPITATION);

    // Cada fuente observa la misma verdad con su propio ruido y su propia δ,
    // tomadas de la caracterización única de src/data/sources/.
    const sources: DemoSource[] = SOURCE_CHARACTERIZATIONS.map((c) => ({
      sourceId: c.sourceId,
      // La Def. 3.4 exige un valor dentro del dominio del marco: se recorta a
      // [0, ∞) porque una precipitación negativa no es una medición ruidosa,
      // es una medición imposible.
      value: Math.max(0, normal(ctx.rng, truth, c.precipitationStddev)),
      stddev: c.precipitationStddev,
      failureRate: c.failureRate,
    }));

    const r = runDemoPipeline({ sources });
    const { belLower, plUpper } = r.probabilityBounds;

    if (!(belLower >= 0 && belLower <= plUpper && plUpper <= 1)) boundsViolations++;

    statuses.add(r.decision.certificate.status);
    reachables.add(`[${r.reachableInterval.lower}, ${r.reachableInterval.upper}]`);
    byDecision[r.decision.status] = (byDecision[r.decision.status] ?? 0) + 1;
    byMethod[r.fusion.method] = (byMethod[r.fusion.method] ?? 0) + 1;
    plUppers.push(plUpper);

    rows.push([
      i,
      truth,
      ...sources.map((s) => s.value),
      r.fusion.method,
      r.fusion.decisionConflict,
      r.decision.certificate.status,
      belLower,
      plUpper,
      r.decision.status,
    ]);
  }

  const sorted = [...plUppers].sort((a, b) => a - b);
  const quantile = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

  ctx.log(
    `${samples} escenarios; Pl(E) de ${sorted[0].toExponential(3)} a ` +
      `${sorted[sorted.length - 1].toExponential(3)}; decisiones ${JSON.stringify(byDecision)}`
  );

  return {
    config: {
      samples,
      maxTruePrecipitation: MAX_TRUE_PRECIPITATION,
      // El reparto de estrategias de este barrido depende de la regla Y de la
      // medida de conflicto vigentes (ver docs/ERRATA.md §9): sin las dos,
      // `fusionMethods` no dice bajo qué sistema se contó.
      conflictRule: DEFAULT_FUSION_CONFIG.rule,
      conflictMeasure: DEFAULT_FUSION_CONFIG.measure,
    },
    results: {
      samples,
      // El punto del experimento: un único status y un único reachable set para
      // todo el barrido. Si algún día estos conjuntos tienen más de un elemento,
      // el nivel existencial habrá dejado de ser constante y merece explicación.
      existentialStatuses: [...statuses].sort(),
      distinctReachableIntervals: [...reachables].sort(),
      fusionMethods: byMethod,
      decisions: byDecision,
      unsafeProbabilityThreshold: DEMO_UNSAFE_PROBABILITY_THRESHOLD,
      plUpper: {
        min: sorted[0],
        p25: quantile(0.25),
        median: quantile(0.5),
        p75: quantile(0.75),
        max: sorted[sorted.length - 1],
      },
      boundsViolations,
    },
    csvHeader: [
      'i',
      'true_precipitation',
      ...SOURCE_CHARACTERIZATIONS.map((c) => `${c.sourceId}_value`),
      'method',
      'K_decision',
      'status',
      'belLower',
      'plUpper',
      'decision',
    ],
    csvRows: rows,
  };
}

main({
  name: 'smoke',
  description:
    'Barrido de intensidad verdadera en [0, 60) mm/h sobre el pipeline de la demo: ' +
    'el nivel existencial se mantiene constante mientras Pl(E) y la decisión operativa varían.',
  run,
});
