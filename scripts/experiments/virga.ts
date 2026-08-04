/**
 * AURA v2 — Experimento 3: el caso virga, cuantificado
 *
 *   npm run exp:virga             campaña completa (N = 5.000)
 *   npm run exp:virga:verify      versión reducida (N = 200), en snapshots/
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ MIDE, Y POR QUÉ ESA MÉTRICA Y NO LA COBERTURA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * El Ejemplo 3.1 del paper (§3.4) describe el conflicto físico de la *virga*:
 * la precipitación existe en altura y se evapora antes de tocar el suelo, de
 * modo que un sensor mide P* y otro mide γ·P* con γ ∈ [0, 1]. NINGUNA de las
 * dos fuentes miente: las dos aciertan, a alturas distintas. El paper le
 * atribuye a la media ponderada el fallo de producir un valor que «no
 * representa ni lo que ocurre arriba ni lo que ocurre abajo».
 *
 * Esa afirmación es medible y es lo que se mide aquí:
 *
 *     MÉTRICA VIRGA = fracción de mundos en que el intervalo del método
 *                     NO contiene NI P* NI γ·P*.
 *
 * Se prefiere a la cobertura de P* por una razón de fondo: en un mundo de virga
 * hay DOS verdades y elegir una sola como referencia decide el resultado antes
 * de medirlo. La métrica virga es simétrica —basta con representar una de las
 * dos— y por eso es la comparación honesta. La cobertura de cada una por
 * separado se reporta igualmente, para que se vea de dónde sale.
 *
 * γ se sortea uniforme en [0, 1] (el «barrido» del enunciado) y los resultados
 * se desglosan en diez tramos de γ: γ → 1 es un mundo casi sin conflicto y
 * γ → 0 es virga total, y los métodos no se comportan igual en los dos
 * extremos.
 *
 * FALLOS δ. Se dejan activos: son parte del modelo declarado de las fuentes.
 * Como contaminan el caso puro, la métrica se reporta DOS veces — sobre todos
 * los mundos y solo sobre los que no tuvieron ningún fallo de fuente (la
 * condición `virga` en el sentido estricto de `lib/world.ts`).
 *
 * ⚠ Ningún parámetro de AURA se toca (regla dura de la campaña).
 */

import { contains, evaluate, METHOD_IDS, METHOD_LABELS, MethodId } from './lib/methods';
import { nameFor, profileOf } from './lib/profile';
import { wilsonInterval } from './lib/stats';
import { DEFAULT_BAND_WEIGHTS, parseBandWeights, sampleWorld } from './lib/world';
import { ExperimentContext, ExperimentOutput, main } from './runner';

/** Tramos de γ para el desglose. */
const GAMMA_BINS = 10;

/** Contador de los cuatro desenlaces posibles de un mundo de virga. */
class VirgaCounter {
  total = 0;
  /** El intervalo contiene P* y γ·P*. */
  both = 0;
  /** Solo P* (lo que ocurre arriba). */
  onlyTruth = 0;
  /** Solo γ·P* (lo que ocurre abajo). */
  onlyAttenuated = 0;
  /** Ni lo uno ni lo otro — el fallo que el paper atribuye a la media. */
  neither = 0;
  widthSum = 0;

  add(hitTruth: boolean, hitAttenuated: boolean, width: number): void {
    this.total++;
    this.widthSum += width;
    if (hitTruth && hitAttenuated) this.both++;
    else if (hitTruth) this.onlyTruth++;
    else if (hitAttenuated) this.onlyAttenuated++;
    else this.neither++;
  }

  summary() {
    const nz = this.total === 0 ? 1 : this.total;
    const ci = wilsonInterval(this.neither, this.total);
    return {
      total: this.total,
      both: this.both,
      onlyTruth: this.onlyTruth,
      onlyAttenuated: this.onlyAttenuated,
      neither: this.neither,
      neitherFraction: this.neither / nz,
      neitherWilsonLower: ci.lower,
      neitherWilsonUpper: ci.upper,
      truthCoverage: (this.both + this.onlyTruth) / nz,
      attenuatedCoverage: (this.both + this.onlyAttenuated) / nz,
      meanWidth: this.widthSum / nz,
    };
  }
}

type VirgaSummary = ReturnType<VirgaCounter['summary']>;

function counterOf(map: Map<string, VirgaCounter>, key: string): VirgaCounter {
  let c = map.get(key);
  if (c === undefined) {
    c = new VirgaCounter();
    map.set(key, c);
  }
  return c;
}

function run(ctx: ExperimentContext): ExperimentOutput {
  const worlds = ctx.flags.number('worlds', 5000);
  if (!Number.isInteger(worlds) || worlds <= 0) {
    throw new Error(`--worlds debe ser un entero positivo; recibido ${worlds}.`);
  }
  const biasScale = ctx.flags.number('bias-scale', 1);
  const bandWeights = parseBandWeights(ctx.flags.string('band-weights', ''));

  const all = new Map<string, VirgaCounter>(); // `${método}`
  const pure = new Map<string, VirgaCounter>(); // `${método}` sin fallo δ
  const byGamma = new Map<string, VirgaCounter>(); // `${método}|${tramo}`

  const fusionMethods: Record<string, number> = { dempster: 0, cautious: 0, envelope: 0 };
  const fusionByGamma: Record<string, Record<string, number>> = {};
  const decisionConflicts: number[] = [];
  let pureWorlds = 0;

  for (let i = 0; i < worlds; i++) {
    const world = sampleWorld(ctx.rng, {
      bandWeights,
      biasScale,
      jointFailureProbability: 0,
      virgaOnly: true,
      virgaProbability: 1,
    });

    const ev = evaluate(world);
    const attenuatedTruth = world.gamma * world.truth;
    const bin = Math.min(GAMMA_BINS - 1, Math.floor(world.gamma * GAMMA_BINS));
    const binKey = `${(bin / GAMMA_BINS).toFixed(1)}-${((bin + 1) / GAMMA_BINS).toFixed(1)}`;
    const isPure = world.condition === 'virga';
    if (isPure) pureWorlds++;

    fusionMethods[ev.fusionMethod]++;
    decisionConflicts.push(ev.decisionConflict);
    fusionByGamma[binKey] ??= { dempster: 0, cautious: 0, envelope: 0 };
    fusionByGamma[binKey][ev.fusionMethod]++;

    for (const id of METHOD_IDS) {
      const iv = ev.intervals[id];
      const hitTruth = contains(iv, world.truth);
      const hitAtt = contains(iv, attenuatedTruth);
      counterOf(all, id).add(hitTruth, hitAtt, iv.width);
      counterOf(byGamma, `${id}|${binKey}`).add(hitTruth, hitAtt, iv.width);
      if (isPure) counterOf(pure, id).add(hitTruth, hitAtt, iv.width);
    }
  }

  const binKeys = Array.from({ length: GAMMA_BINS }, (_, b) =>
    `${(b / GAMMA_BINS).toFixed(1)}-${((b + 1) / GAMMA_BINS).toFixed(1)}`
  );

  const csvRows: (string | number)[][] = [];
  const emit = (method: MethodId, scope: string, stratum: string, s: VirgaSummary): void => {
    csvRows.push([
      method,
      scope,
      stratum,
      s.total,
      s.neither,
      s.neitherFraction,
      s.neitherWilsonLower,
      s.neitherWilsonUpper,
      s.both,
      s.onlyTruth,
      s.onlyAttenuated,
      s.truthCoverage,
      s.attenuatedCoverage,
      s.meanWidth,
    ]);
  };

  const byMethod: Record<string, unknown> = {};
  for (const id of METHOD_IDS) {
    const global = counterOf(all, id).summary();
    const pureSummary = counterOf(pure, id).summary();
    emit(id, 'todos', 'global', global);
    emit(id, 'sin-fallo', 'global', pureSummary);

    const gamma: Record<string, VirgaSummary> = {};
    for (const key of binKeys) {
      const s = counterOf(byGamma, `${id}|${key}`).summary();
      gamma[key] = s;
      emit(id, 'todos', `gamma ${key}`, s);
    }

    byMethod[id] = {
      label: METHOD_LABELS[id],
      allWorlds: global,
      withoutSourceFailure: pureSummary,
      byGamma: gamma,
    };

    ctx.log(
      `${id.padEnd(18)} ni-P*-ni-γP* ${(global.neitherFraction * 100).toFixed(2)} % ` +
        `(sin fallo δ: ${(pureSummary.neitherFraction * 100).toFixed(2)} %) ` +
        `anchura media ${global.meanWidth.toFixed(2)} mm/h`
    );
  }

  const strategyShares = Object.fromEntries(
    Object.entries(fusionMethods).map(([k, v]) => [k, v / worlds])
  );
  ctx.log(
    `estrategias de fusión: ` +
      Object.entries(strategyShares)
        .map(([k, v]) => `${k} ${(v * 100).toFixed(2)} %`)
        .join(', ')
  );

  const sortedK = [...decisionConflicts].sort((a, b) => a - b);
  const quantile = (q: number) => sortedK[Math.min(sortedK.length - 1, Math.floor(q * sortedK.length))];

  return {
    config: {
      worlds,
      biasScale,
      bandWeights,
      gammaBins: GAMMA_BINS,
      virgaOnly: true,
      defaultBandWeights: DEFAULT_BAND_WEIGHTS,
      methods: Object.fromEntries(METHOD_IDS.map((id) => [id, METHOD_LABELS[id]])),
    },
    results: {
      worlds,
      pureWorlds,
      metric:
        'fracción de mundos en que el intervalo no contiene NI P* NI γ·P* ' +
        '(el fallo que §3.4, Ejemplo 3.1 atribuye a la media)',
      byMethod,
      fusion: {
        counts: fusionMethods,
        shares: strategyShares,
        byGamma: fusionByGamma,
        decisionConflict: {
          min: sortedK[0],
          p25: quantile(0.25),
          median: quantile(0.5),
          p75: quantile(0.75),
          max: sortedK[sortedK.length - 1],
        },
      },
    },
    csvHeader: [
      'method',
      'scope',
      'stratum',
      'n',
      'neither',
      'neither_fraction',
      'neither_wilson_lower',
      'neither_wilson_upper',
      'both',
      'only_truth',
      'only_attenuated',
      'truth_coverage',
      'attenuated_coverage',
      'mean_width',
    ],
    csvRows,
  };
}

const profile = profileOf();

main({
  name: nameFor('virga', profile),
  description:
    'Caso virga (Ejemplo 3.1): fracción de mundos en que el intervalo de cada método no ' +
    'contiene ni P* ni γ·P*, y reparto de estrategias de fusión de AURA por tramo de γ.',
  run,
});
