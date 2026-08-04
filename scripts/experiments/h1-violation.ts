/**
 * AURA v2 — Experimento 2: degradación bajo violación de H1
 *
 *   npm run exp:h1              barrido completo (2.000 mundos por punto)
 *   npm run exp:h1:verify       versión reducida (200), en snapshots/
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ MIDE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * H1 del Teorema 6.1 (§6.1) es la hipótesis de COBERTURA SENSORIAL: la
 * distribución real es compatible con al menos una fuente. Cuando TODAS las
 * fuentes fallan a la vez, H1 es falsa y ninguna garantía del sistema aplica —
 * el certificado sigue siendo válido *condicionado a H1*, y H1 no se cumple.
 *
 * El barrido lleva la fracción de mundos así de 0 % a 50 % en pasos de 5 %, y
 * mide cómo cae la cobertura de cada método. Lo que se quiere ver no es tanto
 * el nivel como la ESTRUCTURA de la caída, y por eso cada punto se reporta tres
 * veces: sobre todos los mundos, solo sobre los violados y solo sobre los no
 * violados. Un método que degrada únicamente dentro de los mundos violados
 * mantiene su garantía donde la garantía aplica; uno que degrada también fuera
 * está contaminado por un fallo que ni siquiera le tocaba.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MUNDOS SIN VIRGA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `virgaProbability = 0` en todo el barrido: el experimento aísla UNA
 * perturbación. Los mundos no violados conservan los fallos independientes δ_i,
 * porque son parte del modelo declarado de las fuentes y quitarlos mediría un
 * sistema que no existe.
 *
 * Consecuencia que conviene tener presente al leer la curva: los mundos no
 * violados se sortean igual en todos los puntos del barrido, luego la cobertura
 * restringida a ellos NO debería depender de la fracción. Si dependiera, el
 * muestreo estaría mal.
 *
 * ⚠ Ningún parámetro de AURA se toca (regla dura de la campaña).
 */

import { degradationFigure, DegradationSeries } from './lib/figures';
import { contains, evaluate, METHOD_IDS, METHOD_LABELS } from './lib/methods';
import { nameFor, profileOf } from './lib/profile';
import { StratumSummary, StratumTable } from './lib/stats';
import { DEFAULT_BAND_WEIGHTS, parseBandWeights, sampleWorld } from './lib/world';
import { ExperimentContext, ExperimentOutput, main } from './runner';

/** Ámbitos de reporte de cada punto del barrido. */
const SCOPES = ['all', 'violated', 'intact'] as const;
type Scope = (typeof SCOPES)[number];

function run(ctx: ExperimentContext): ExperimentOutput {
  const worldsPerPoint = ctx.flags.number('worlds', 2000);
  if (!Number.isInteger(worldsPerPoint) || worldsPerPoint <= 0) {
    throw new Error(`--worlds debe ser un entero positivo; recibido ${worldsPerPoint}.`);
  }
  const maxFraction = ctx.flags.number('max-fraction', 0.5);
  const step = ctx.flags.number('step', 0.05);
  const biasScale = ctx.flags.number('bias-scale', 1);
  const bandWeights = parseBandWeights(ctx.flags.string('band-weights', ''));

  if (!(step > 0) || !(maxFraction >= 0) || maxFraction > 1) {
    throw new Error(`--step debe ser > 0 y --max-fraction estar en [0, 1].`);
  }

  const steps = Math.round(maxFraction / step);
  // La fracción se reconstruye como i/steps·maxFraction y no acumulando `step`:
  // sumar 0,05 diez veces da 0,4999999999999999 y el eje de la figura dejaría
  // de ser reproducible entre versiones de V8.
  const fractions = Array.from({ length: steps + 1 }, (_, i) => (i * maxFraction) / steps);

  const csvRows: (string | number)[][] = [];
  const points: Record<
    string,
    { fraction: number; byMethod: Record<string, Record<Scope, StratumSummary>> }
  > = {};
  const curves: Record<string, { fraction: number; coverage: number }[]> = {};
  for (const id of METHOD_IDS) curves[id] = [];

  for (const fraction of fractions) {
    const table = new StratumTable(); // clave: `${método}|${ámbito}`
    let violatedCount = 0;

    for (let i = 0; i < worldsPerPoint; i++) {
      const world = sampleWorld(ctx.rng, {
        bandWeights,
        biasScale,
        jointFailureProbability: fraction,
        virgaOnly: false,
        virgaProbability: 0,
      });
      const violated = world.condition === 'h1-violation';
      if (violated) violatedCount++;

      const ev = evaluate(world);
      for (const id of METHOD_IDS) {
        const iv = ev.intervals[id];
        const hit = contains(iv, world.truth);
        table.get(`${id}|all`).add(hit, iv.width);
        table.get(`${id}|${violated ? 'violated' : 'intact'}`).add(hit, iv.width);
      }
    }

    const byMethod: Record<string, Record<Scope, StratumSummary>> = {};
    for (const id of METHOD_IDS) {
      const scoped = {} as Record<Scope, StratumSummary>;
      for (const scope of SCOPES) {
        const s = table.get(`${id}|${scope}`).summary();
        scoped[scope] = s;
        csvRows.push([
          fraction,
          id,
          scope,
          s.total,
          s.successes,
          s.coverage,
          s.wilsonLower,
          s.wilsonUpper,
          s.meanWidth,
          s.medianWidth,
        ]);
      }
      byMethod[id] = scoped;
      curves[id].push({ fraction, coverage: scoped.all.coverage });
    }

    points[fraction.toFixed(4)] = { fraction, byMethod };

    ctx.log(
      `violación ${(fraction * 100).toFixed(0).padStart(2)} % ` +
        `(${violatedCount}/${worldsPerPoint} mundos): ` +
        METHOD_IDS.map(
          (id) => `${id.split('-')[0]}${id.includes('banda') ? '95' : ''}=` +
            `${(byMethod[id].all.coverage * 100).toFixed(1)}%`
        ).join('  ')
    );
  }

  const artifacts: Record<string, string> = {
    'figures/f3-h1-degradation.svg': degradationFigure({
      title: 'Degradación de la cobertura al violar H1',
      subtitle:
        `${worldsPerPoint} mundos por punto, semilla ${ctx.flags.seed}; ` +
        `violación = las tres fuentes fallan a la vez`,
      series: METHOD_IDS.map((id): DegradationSeries => ({ method: id, points: curves[id] })),
    }),
  };

  return {
    config: {
      worldsPerPoint,
      maxFraction,
      step,
      fractions,
      biasScale,
      bandWeights,
      virgaProbability: 0,
      defaultBandWeights: DEFAULT_BAND_WEIGHTS,
      methods: Object.fromEntries(METHOD_IDS.map((id) => [id, METHOD_LABELS[id]])),
    },
    results: {
      worldsPerPoint,
      fractions,
      scopes: {
        all: 'todos los mundos del punto',
        violated: 'solo los mundos con las tres fuentes caídas (H1 falsa)',
        intact: 'solo los mundos restantes (H1 puede cumplirse)',
      },
      points,
    },
    csvHeader: [
      'violation_fraction',
      'method',
      'scope',
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

main({
  name: nameFor('h1-violation', profile),
  description:
    'Cobertura de cada método frente a la fracción de mundos en que todas las fuentes fallan ' +
    'simultáneamente (violación directa de H1 del Teorema 6.1), de 0 % a 50 %.',
  run,
});
