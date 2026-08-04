/**
 * AURA v2 — Experimento 1: cobertura y anchura globales
 *
 *   npm run exp:coverage              campaña completa (N = 10.000)
 *   npm run exp:coverage:verify       versión reducida (N = 200), en snapshots/
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ MIDE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Sortea mundos sintéticos con ground truth conocido (`lib/world.ts`), hace que
 * los cuatro estimadores de `lib/methods.ts` produzcan su intervalo sobre LAS
 * MISMAS mediciones, y cuenta dos cosas por método: con qué frecuencia el
 * intervalo contiene P* (cobertura, con intervalo de Wilson al 95 %) y cuánto
 * mide (anchura media y mediana). Desglosado en global, por tramo de intensidad
 * y por condición del mundo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CÓMO LEER LOS DOS NIVELES DE AURA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `aura-existencial` no compite con los baselines: promete algo distinto (bajo
 * H0-H2, contener x* CASI SIEMPRE, no el 95 % de las veces) y lo paga en
 * anchura. Su número interesante no es «cuánto mejor que el 95 %» sino si
 * alguna vez baja de 100 % — y eso sería un bug de soundness, no un resultado
 * (ver {@link SOUNDNESS_NOTE}).
 *
 * `aura-banda-95` es el que sí es comparable: mismo nivel nominal, misma
 * pregunta, y sin garantía formal detrás.
 *
 * ⚠ NINGÚN parámetro de AURA se ajusta aquí. σ_i, δ_i, κ₁, κ₂ y el marco entran
 * tal cual desde `characterization.ts` y `constants.ts`. Si un resultado
 * sugiere que están mal puestos, se REPORTA en el README; no se corrige en el
 * experimento que lo mide.
 */

import { canonicalJson } from '../lib/canonical';
import {
  coverageBarsFigure,
  CoverageGroup,
  widthCoverageFigure,
  WidthCoveragePoint,
} from './lib/figures';
import {
  contains,
  evaluate,
  METHOD_IDS,
  METHOD_LABELS,
  MethodId,
  EVIDENCE_BAND_MASS,
  Z_95,
} from './lib/methods';
import { fusionConfigFor, nameFor, profileOf, ruleOverrideOf } from './lib/profile';
import { StratumSummary, StratumTable } from './lib/stats';
import {
  DECLARED_SOURCE_BIAS,
  DEFAULT_BAND_WEIGHTS,
  DOMAIN,
  INTENSITY_BANDS,
  parseBandWeights,
  sampleWorld,
  SOURCES,
  WorldCondition,
} from './lib/world';
import { ExperimentContext, ExperimentOutput, main } from './runner';

/**
 * Qué se considera un bug y qué es un resultado.
 *
 * El nivel existencial de AURA lleva una garantía DEMOSTRADA (Lema 6.1, §6.1):
 * bajo H0 (soporte acotado) y H1 (alguna fuente cubre la verdad), el intervalo
 * credal contiene x*. En este mundo H0 se cumple SIEMPRE por construcción —P*
 * se sortea en [0, 120] y el marco declara P_máx = 500—, luego una cobertura
 * existencial por debajo del 100 % en mundos donde además se cumple H1 sería un
 * fallo de soundness del motor y hay que corregirlo antes de dar los números
 * por buenos.
 *
 * La de los baselines puede salir tan baja como salga: no prometen nada, y ese
 * es justamente el resultado que el experimento busca.
 */
export const SOUNDNESS_NOTE =
  'Cobertura existencial < 100 % en mundos con H0 y H1 satisfechas = bug de soundness.';

/** Orden de presentación de las condiciones. */
const CONDITION_ORDER: readonly WorldCondition[] = [
  'clean',
  'delta-failure',
  'virga',
  'h1-violation',
];

const CONDITION_LABELS: Readonly<Record<string, string>> = {
  clean: 'sin fallo',
  'delta-failure': 'fallo δ',
  virga: 'virga',
  'h1-violation': 'violación H1',
};

const BAND_ORDER = INTENSITY_BANDS.map((b) => b.name);

function run(ctx: ExperimentContext): ExperimentOutput {
  // Regla de conflicto efectiva. Sin `--rule` es la del sistema; con ella
  // se reproducen los números de una regla anterior (ver ERRATA §9) en un
  // directorio de salida propio.
  const fusionConfig = fusionConfigFor(ruleOverride);
  const worlds = ctx.flags.number('worlds', 10000);
  if (!Number.isInteger(worlds) || worlds <= 0) {
    throw new Error(`--worlds debe ser un entero positivo; recibido ${worlds}.`);
  }
  const virgaProbability = ctx.flags.number('virga-prob', 0.15);
  const biasScale = ctx.flags.number('bias-scale', 1);
  const bandWeights = parseBandWeights(ctx.flags.string('band-weights', ''));

  const config = {
    bandWeights,
    biasScale,
    jointFailureProbability: 0,
    virgaOnly: false,
    virgaProbability,
  };

  // Un acumulador por método y por eje de desglose.
  const globals = new StratumTable(); // clave: método
  const byBand = new StratumTable(); // clave: `${método}|${tramo}`
  const byCondition = new StratumTable(); // clave: `${método}|${condición}`

  const fusionMethods: Record<string, number> = { dempster: 0, cautious: 0, envelope: 0 };
  /**
   * Reparto de estrategias DENTRO de cada condición. Es lo que hace verificable
   * el hallazgo colateral del README: con qué frecuencia escala AURA a la
   * envolvente en mundos SIN fallo ni conflicto físico, es decir cuánto se
   * aparta el régimen real del que sugieren los cuatro fixtures.
   */
  const fusionByCondition: Record<string, Record<string, number>> = {};
  const conditionCounts: Record<string, number> = {};
  const bandCounts: Record<string, number> = {};

  // Testigos de soundness: mundos en que el nivel existencial NO contuvo a P*.
  const soundnessViolations: {
    world: number;
    truth: number;
    values: number[];
    condition: string;
    interval: { lower: number; upper: number };
  }[] = [];
  let h0Violations = 0;

  for (let i = 0; i < worlds; i++) {
    const world = sampleWorld(ctx.rng, config);
    const ev = evaluate(world, fusionConfig);

    if (world.truth < DOMAIN.lower || world.truth > DOMAIN.upper) h0Violations++;

    fusionMethods[ev.fusionMethod]++;
    fusionByCondition[world.condition] ??= { dempster: 0, cautious: 0, envelope: 0 };
    fusionByCondition[world.condition][ev.fusionMethod]++;
    conditionCounts[world.condition] = (conditionCounts[world.condition] ?? 0) + 1;
    bandCounts[world.band] = (bandCounts[world.band] ?? 0) + 1;

    for (const id of METHOD_IDS) {
      const iv = ev.intervals[id];
      const hit = contains(iv, world.truth);
      globals.get(id).add(hit, iv.width);
      byBand.get(`${id}|${world.band}`).add(hit, iv.width);
      byCondition.get(`${id}|${world.condition}`).add(hit, iv.width);

      if (id === 'aura-existencial' && !hit && soundnessViolations.length < 20) {
        soundnessViolations.push({
          world: i,
          truth: world.truth,
          values: world.values,
          condition: world.condition,
          interval: { lower: iv.lower, upper: iv.upper },
        });
      }
    }
  }

  // ── Tabulación ─────────────────────────────────────────────────────────────
  const csvRows: (string | number)[][] = [];
  const byMethod: Record<string, unknown> = {};

  const emit = (method: MethodId, kind: string, stratum: string, s: StratumSummary): void => {
    csvRows.push([
      method,
      kind,
      stratum,
      s.total,
      s.successes,
      s.coverage,
      s.wilsonLower,
      s.wilsonUpper,
      s.meanWidth,
      s.medianWidth,
    ]);
  };

  for (const id of METHOD_IDS) {
    const global = globals.get(id).summary();
    emit(id, 'global', 'todos', global);

    const bands: Record<string, StratumSummary> = {};
    for (const b of BAND_ORDER) {
      const key = `${id}|${b}`;
      if (!byBand.keys().includes(key)) continue;
      const s = byBand.get(key).summary();
      bands[b] = s;
      emit(id, 'tramo', b, s);
    }

    const conditions: Record<string, StratumSummary> = {};
    for (const c of CONDITION_ORDER) {
      const key = `${id}|${c}`;
      if (!byCondition.keys().includes(key)) continue;
      const s = byCondition.get(key).summary();
      conditions[c] = s;
      emit(id, 'condicion', c, s);
    }

    byMethod[id] = { label: METHOD_LABELS[id], global, byBand: bands, byCondition: conditions };
  }

  // ── Figuras ────────────────────────────────────────────────────────────────
  const barsFor = (
    summary: (id: MethodId) => StratumSummary
  ): CoverageGroup['bars'] => {
    const bars: CoverageGroup['bars'] = {};
    for (const id of METHOD_IDS) bars[id] = summary(id);
    return bars;
  };

  const groups: CoverageGroup[] = [
    { label: 'global', bars: barsFor((id) => globals.get(id).summary()) },
    ...CONDITION_ORDER.filter((c) => (conditionCounts[c] ?? 0) > 0).map((c) => ({
      label: CONDITION_LABELS[c],
      bars: barsFor((id) => byCondition.get(`${id}|${c}`).summary()),
    })),
  ];

  const points: WidthCoveragePoint[] = [];
  for (const id of METHOD_IDS) {
    const g = globals.get(id).summary();
    points.push({ method: id, stratum: 'global', meanWidth: g.meanWidth, coverage: g.coverage });
    for (const c of CONDITION_ORDER) {
      if ((conditionCounts[c] ?? 0) === 0) continue;
      const s = byCondition.get(`${id}|${c}`).summary();
      points.push({
        method: id,
        stratum: CONDITION_LABELS[c],
        meanWidth: s.meanWidth,
        coverage: s.coverage,
      });
    }
  }

  const subtitle =
    `${worlds} mundos sintéticos, semilla ${ctx.flags.seed}; ` +
    `σ y δ de characterization.ts sin modificar`;

  const artifacts: Record<string, string> = {
    'figures/f1-coverage-by-condition.svg': coverageBarsFigure({
      title: 'Cobertura empírica por método y condición',
      subtitle,
      groups,
    }),
    'figures/f2-width-vs-coverage.svg': widthCoverageFigure({
      title: 'Anchura del intervalo frente a cobertura',
      subtitle,
      points,
    }),
  };

  // ── Traza ──────────────────────────────────────────────────────────────────
  for (const id of METHOD_IDS) {
    const s = globals.get(id).summary();
    ctx.log(
      `${id.padEnd(18)} cobertura ${(s.coverage * 100).toFixed(2)} % ` +
        `[${(s.wilsonLower * 100).toFixed(2)}, ${(s.wilsonUpper * 100).toFixed(2)}] ` +
        `anchura media ${s.meanWidth.toFixed(2)} mm/h`
    );
  }
  if (soundnessViolations.length > 0) {
    ctx.log(
      `⚠ SOUNDNESS: ${globals.get('aura-existencial').total - globals.get('aura-existencial').successes} ` +
        `mundos con P* fuera del intervalo existencial. ${SOUNDNESS_NOTE}`
    );
    ctx.log(`  primer testigo: ${canonicalJson(soundnessViolations[0]).replace(/\s+/g, ' ')}`);
  }

  return {
    config: {
      // La regla de decisión de la Def. 3.6 con que se produjeron estos
      // números. Sin ella, `results.json` no dice bajo qué sistema se midió.
      conflictRule: fusionConfig.rule,
      kappa1: fusionConfig.kappa1,
      kappa2: fusionConfig.kappa2,
      kappaDegeneracy: fusionConfig.kappaDegeneracy,
      worlds,
      virgaProbability,
      biasScale,
      bandWeights,
      declaredSourceBias: DECLARED_SOURCE_BIAS,
      evidenceBandMass: EVIDENCE_BAND_MASS,
      z95: Z_95,
      sources: SOURCES.map((c) => ({
        sourceId: c.sourceId,
        precipitationStddev: c.precipitationStddev,
        failureRate: c.failureRate,
      })),
      intensityBands: INTENSITY_BANDS,
      defaultBandWeights: DEFAULT_BAND_WEIGHTS,
      domain: DOMAIN,
    },
    results: {
      worlds,
      bandCounts,
      conditionCounts,
      fusionMethods,
      fusionByCondition,
      byMethod,
      soundness: {
        note: SOUNDNESS_NOTE,
        h0Violations,
        existentialMisses:
          globals.get('aura-existencial').total - globals.get('aura-existencial').successes,
        witnesses: soundnessViolations,
      },
    },
    csvHeader: [
      'method',
      'stratum_kind',
      'stratum',
      'n',
      'covered',
      'coverage',
      'wilson_lower',
      'wilson_upper',
      'mean_width',
      'median_width',
    ],
    csvRows,
    artifacts,
  };
}

const profile = profileOf();
const ruleOverride = ruleOverrideOf();

main({
  name: nameFor('coverage', profile, ruleOverride),
  description:
    'Cobertura empírica y anchura del intervalo de los dos niveles de AURA frente a media ' +
    'ponderada y Kalman estático, sobre mundos sintéticos con ground truth conocido.',
  run,
});
