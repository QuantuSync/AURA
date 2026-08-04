/**
 * AURA v2 — Pipeline reproducible (`npm run repro`)
 *
 * Regenera, para cada escenario de `fixtures/`, TODO lo que puede aparecer en el
 * paper: el resultado íntegro del pipeline, la fila de la tabla resumen y las
 * figuras. Sin red, sin reloj y sin aleatoriedad no sembrada.
 *
 *   fixtures/<esc>/  →  ingesta offline
 *                    →  BPAs (Def. 3.4)
 *                    →  conflicto K_máx / K_global (Def. 3.5-3.6 + extensión)
 *                    →  fusión (Def. 3.6)
 *                    →  conjunto credal (Def. 3.8-3.9) y credal intervalar (§8)
 *                    →  propagación por el DAG de la demo (Ec. 34)
 *                    →  certificado de dos niveles (Def. 5.5 + 5.5′)
 *                    →  out/<esc>/{result.json, summary.csv, figures/*.svg}
 *
 * DETERMINISMO. Dos ejecuciones consecutivas producen bytes idénticos. Las
 * únicas fuentes de variación del pipeline son el reloj y el orden de claves, y
 * las dos están cerradas: los timestamps salen del fixture (no de `Date.now()`),
 * el `CertifiedDecision.timestamp` se excluye explícitamente de la
 * serialización, y todo pasa por `canonicalJson` (ver scripts/lib/canonical.ts).
 * Verificable con `npm run repro && cp -r out a && npm run repro && diff -r a out`.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { FIXTURE_SCENARIOS } from '@/data/sources/offline';
import { DEMO_LOCATION, ingestAll } from '@/data/ingest';
import { extractVariable } from '@/data/normalization';
import { WeatherMeasurement } from '@/data/sources/types';

import {
  DEMO_H_CRIT,
  DEMO_PIPELINE_DAG_PARAMS,
  DEMO_SAFETY_SPEC,
  DemoPipelineResult,
  runDemoPipeline,
} from '@/core/pipeline/demo-pipeline';
import { createDemoDAG } from '@/core/causal-dag/demo-dag';
import { hullOf } from '@/core/credal-propagation/credal-interval-set';
import { credalSetAtNode, propagateCredalThroughDAG } from '@/core/credal-propagation/propagation';
import { BPA, FocalElement } from '@/core/dempster-shafer/types';
import { PRECIPITATION_FRAME } from '@/lib/constants';

import { canonicalJson, toCsv } from './lib/canonical';
import { HorizonSample, coreHull, credalMassFigure, hEvolutionFigure } from './lib/figures';

const OUT_DIR = path.resolve('out');
const FIXTURES_DIR = path.resolve('fixtures');

/** Muestreo del horizonte para la figura de h(t): 41 puntos en [0, 2] h. */
const HORIZON_STEPS = 40;

/** Descripción legible de un elemento focal: qué hipótesis lo componen. */
function describeFocal(fe: FocalElement, bpa: BPA) {
  return {
    indices: [...fe.indices].sort((a, b) => a - b),
    labels: [...fe.indices].sort((a, b) => a - b).map((i) => bpa.frame.hypotheses[i].label),
    mass: fe.mass,
  };
}

function serializeBpa(bpa: BPA) {
  return {
    sourceId: bpa.sourceId,
    // Orden estable de los focales: por índice, no por el orden en que la regla
    // de combinación los fue generando.
    focalElements: [...bpa.focalElements]
      .map((fe) => describeFocal(fe, bpa))
      .sort((a, b) => a.indices.join(',').localeCompare(b.indices.join(','))),
  };
}

function serializeCredalIntervalSet(set: { elements: readonly { mass: number; interval: { lower: number; upper: number } }[]; frameRef: unknown; nodeId?: string }) {
  return {
    ...(set.nodeId !== undefined ? { nodeId: set.nodeId } : {}),
    frameRef: set.frameRef,
    elements: [...set.elements]
      .map((e) => ({ mass: e.mass, interval: { ...e.interval } }))
      .sort((a, b) => a.interval.lower - b.interval.lower || a.interval.upper - b.interval.upper),
  };
}

function serializeMeasurement(m: WeatherMeasurement) {
  return {
    sourceId: m.sourceId,
    observedAt: new Date(m.timestamp).toISOString(),
    timestamp: m.timestamp,
    latitude: m.latitude,
    longitude: m.longitude,
    precipitation: m.precipitation,
    precipitationStddev: m.precipitationStddev,
    windSpeed: m.windSpeed,
    windSpeedStddev: m.windSpeedStddev,
    temperature: m.temperature,
    temperatureStddev: m.temperatureStddev,
    failureRate: m.failureRate,
  };
}

/**
 * Recorre el horizonte recomputando la propagación credal en cada instante.
 *
 * No basta con interpolar entre t = 0 y t = 2: la Ec. (34) es lineal en t pero
 * la propagación aplica `⊕ [−ε_h, ε_h]` en CADA evaluación (Ec. 24), de modo que
 * el ancho del hull no es una función lineal del horizonte. Se recomputa.
 */
function sampleHorizon(result: DemoPipelineResult): HorizonSample[] {
  const tMax = DEMO_PIPELINE_DAG_PARAMS.horizon.upper;
  const samples: HorizonSample[] = [];

  for (let i = 0; i <= HORIZON_STEPS; i++) {
    const t = (tMax * i) / HORIZON_STEPS;
    const dag = createDemoDAG({ ...DEMO_PIPELINE_DAG_PARAMS, horizon: { lower: t, upper: t } });
    const propagated = credalSetAtNode(
      propagateCredalThroughDAG(result.inputCredalSet, dag, 'P'),
      'h'
    );
    samples.push({ t, hull: hullOf(propagated), core: coreHull(propagated) });
  }

  return samples;
}

const SUMMARY_HEADER = [
  'scenario',
  'K_max',
  'K_global',
  'rule',
  'K_decision',
  'guard',
  'method',
  'credal_lower',
  'credal_upper',
  'reachable_lower',
  'reachable_upper',
  'status',
  'belLower',
  'plUpper',
  'decision',
] as const;

function summaryRow(scenario: string, r: DemoPipelineResult): (string | number)[] {
  return [
    scenario,
    r.fusion.maxConflict,
    r.fusion.globalConflict,
    // La regla y su K_decision viajan en la fila: sin ellos, K_máx y K_global
    // no explican por sí solos por qué se eligió `method` (ver ERRATA §9).
    r.fusion.rule,
    r.fusion.decisionConflict,
    r.fusion.degeneracyGuard ? 1 : 0,
    r.fusion.method,
    r.credalSet.continuousInterval.lower,
    r.credalSet.continuousInterval.upper,
    r.reachableInterval.lower,
    r.reachableInterval.upper,
    r.decision.certificate.status,
    r.probabilityBounds.belLower,
    r.probabilityBounds.plUpper,
    r.decision.status,
  ];
}

interface Manifest {
  scenario: string;
  description: string;
  provenance: string;
  date: string;
  [k: string]: unknown;
}

async function runScenario(scenario: string) {
  const manifest = JSON.parse(
    await readFile(path.join(FIXTURES_DIR, scenario, 'manifest.json'), 'utf8')
  ) as Manifest;

  const measurements = await ingestAll({
    offline: true,
    scenario,
    fixturesDir: FIXTURES_DIR,
  });

  const sources = extractVariable(measurements, 'precipitation');
  const result = runDemoPipeline({ sources });

  const cert = result.decision.certificate;

  const serialized = {
    schemaVersion: 1,
    scenario: {
      name: scenario,
      description: manifest.description,
      provenance: manifest.provenance,
      date: manifest.date,
      location: DEMO_LOCATION,
    },
    // ── Ingesta ────────────────────────────────────────────────────────────
    measurements: measurements.map(serializeMeasurement),
    sources,
    frame: {
      variable: PRECIPITATION_FRAME.variable,
      unit: PRECIPITATION_FRAME.unit,
      domainBound: PRECIPITATION_FRAME.domainBound,
      hypotheses: PRECIPITATION_FRAME.hypotheses,
    },
    // ── Capa 1 ─────────────────────────────────────────────────────────────
    bpas: result.bpas.map(serializeBpa),
    fusion: {
      method: result.fusion.method,
      maxConflict: result.fusion.maxConflict,
      globalConflict: result.fusion.globalConflict,
      rule: result.fusion.rule,
      decisionConflict: result.fusion.decisionConflict,
      normalizedConflict: result.fusion.normalizedConflict,
      degeneracyGuard: result.fusion.degeneracyGuard,
      conflictMatrix: result.fusion.conflictMatrix,
      sourceWeights: result.fusion.sourceWeights,
      sequentialConflicts: result.fusion.sequentialConflicts,
      envelope: result.fusion.envelope?.bounds,
      fused: serializeBpa(result.fusion.fused),
    },
    credalSetEq10: {
      continuousInterval: result.credalSet.continuousInterval,
      fusionMethod: result.credalSet.fusionMethod,
      maxConflict: result.credalSet.maxConflict,
      bounds: result.credalSet.bounds.map((b) => ({
        hypothesis: b.hypothesis,
        label: PRECIPITATION_FRAME.hypotheses[b.hypothesis].label,
        belief: b.belief,
        plausibility: b.plausibility,
      })),
    },
    inputCredalSet: serializeCredalIntervalSet(result.inputCredalSet),
    // ── Capa 2 ─────────────────────────────────────────────────────────────
    dag: {
      params: {
        initialLevel: DEMO_PIPELINE_DAG_PARAMS.initialLevel,
        drainageCapacity: DEMO_PIPELINE_DAG_PARAMS.drainageCapacity,
        horizon: DEMO_PIPELINE_DAG_PARAMS.horizon,
        modelErrorBound: DEMO_PIPELINE_DAG_PARAMS.modelErrorBound,
      },
      nodes: result.dag.nodes.map((nd) => ({ id: nd.id, label: nd.label, unit: nd.unit })),
      edges: result.dag.edges.map((e) => ({ from: e.from, to: e.to, weight: e.weight })),
      equations: result.dag.equations.map((eq) => ({
        nodeId: eq.nodeId,
        modelErrorBound: eq.modelErrorBound,
      })),
    },
    propagatedCredalSet: serializeCredalIntervalSet(result.propagatedCredalSet),
    reachableInterval: result.reachableInterval,
    // ── Capa 3 ─────────────────────────────────────────────────────────────
    probabilityBounds: result.probabilityBounds,
    certificate: {
      status: cert.status,
      reachableInterval: cert.reachableInterval,
      spec: cert.spec,
      witness: cert.witness,
      basis: cert.basis,
      assumptions: cert.assumptions,
      domainBounds: cert.domainBounds,
      probabilityBounds: cert.probabilityBounds,
      justification: cert.justification,
    },
    // `timestamp` de CertifiedDecision se omite deliberadamente: es `Date.now()`
    // y es la única fuente de no-determinismo del pipeline.
    decision: {
      status: result.decision.status,
      severity: result.decision.severity,
      escalationBasis: result.decision.escalationBasis,
    },
  };

  const dir = path.join(OUT_DIR, scenario);
  await mkdir(path.join(dir, 'figures'), { recursive: true });

  const row = summaryRow(scenario, result);

  await writeFile(path.join(dir, 'result.json'), canonicalJson(serialized), 'utf8');
  await writeFile(path.join(dir, 'summary.csv'), toCsv(SUMMARY_HEADER, [row]), 'utf8');

  await writeFile(
    path.join(dir, 'figures', 'h-evolution.svg'),
    hEvolutionFigure({
      scenario,
      samples: sampleHorizon(result),
      hCrit: DEMO_H_CRIT,
      unit: 'mm',
    }),
    'utf8'
  );

  await writeFile(
    path.join(dir, 'figures', 'credal-mass.svg'),
    credalMassFigure({
      scenario,
      frame: PRECIPITATION_FRAME,
      sourceBpas: result.bpas,
      fused: result.fusion.fused,
      method: result.fusion.method,
    }),
    'utf8'
  );

  return { row, result };
}

async function main() {
  // Borrado previo: sin él, un escenario renombrado dejaría su directorio
  // huérfano en out/ y la comparación contra snapshots/ lo daría por bueno.
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const rows: (string | number)[][] = [];

  for (const scenario of FIXTURE_SCENARIOS) {
    const { row, result } = await runScenario(scenario);
    rows.push(row);
    process.stdout.write(
      `  ${scenario.padEnd(18)} ${result.fusion.method.padEnd(9)} ` +
        `Pl(E)=${result.probabilityBounds.plUpper.toExponential(4)} ` +
        `Bel(E)=${result.probabilityBounds.belLower.toExponential(4)} ` +
        `${result.decision.certificate.status} / ${result.decision.status}\n`
    );
  }

  // Resumen agregado: la tabla de los cuatro escenarios en un solo fichero, que
  // es la forma en que entra en el paper. La copia por escenario de
  // out/<esc>/summary.csv permite leer cada caso aislado.
  await writeFile(path.join(OUT_DIR, 'summary.csv'), toCsv(SUMMARY_HEADER, rows), 'utf8');

  process.stdout.write(`\n  ${rows.length} escenarios escritos en ${OUT_DIR}\n`);
}

main().catch((e) => {
  process.stderr.write(`\nreproduce: ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
