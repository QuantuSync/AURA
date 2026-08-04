/**
 * AURA v2 — Mundo sintético con ground truth conocido
 *
 * El generador de mundos que comparten los tres experimentos de cobertura
 * (`coverage`, `h1-violation`, `virga`). Su razón de ser: para medir cobertura
 * hace falta saber qué era verdad, y ninguna serie observacional lo dice. Aquí
 * la verdad se sortea primero y las mediciones se derivan de ella, de modo que
 * «el intervalo contiene P*» es una pregunta con respuesta exacta.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ ES DECLARADO Y QUÉ SE TOMA DEL SISTEMA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * DEL SISTEMA, sin tocar (regla dura de la campaña): σ_i y δ_i salen de
 * `SOURCE_CHARACTERIZATIONS` y el marco de `PRECIPITATION_FRAME`. El mundo usa
 * como probabilidad REAL de fallo de cada fuente exactamente la δ_i que el
 * sistema declara — es decir, AURA opera aquí BIEN ESPECIFICADO. Si la
 * cobertura falla, no es por una δ mal puesta.
 *
 * DECLARADO POR EL EXPERIMENTO, y por tanto discutible (ver el README):
 *   · los pesos de la mezcla de intensidades ({@link DEFAULT_BAND_WEIGHTS}),
 *   · el sesgo sistemático por fuente ({@link DECLARED_SOURCE_BIAS}), que no
 *     existe en `characterization.ts` porque nadie lo ha calibrado,
 *   · la probabilidad de conflicto físico tipo virga y el reparto de fuentes
 *     entre «arriba» y «abajo».
 *
 * Ninguno de los tres es una calibración. Son órdenes de magnitud plausibles
 * elegidos ANTES de mirar ningún resultado, y todos son configurables por CLI
 * para que el lector pueda mover el mundo y ver qué se mueve con él.
 */

import { SOURCE_CHARACTERIZATIONS } from '@/data/sources/characterization';
import { PRECIPITATION_FRAME } from '@/lib/constants';
import { Rng, normal, uniform } from '@/lib/prng';

/** Fuentes del mundo, en el orden canónico de `characterization.ts`. */
export const SOURCES = SOURCE_CHARACTERIZATIONS;

/** [0, P_máx] — el dominio declarado por H0. Una medición nunca sale de aquí. */
export const DOMAIN = {
  lower: PRECIPITATION_FRAME.hypotheses[0].lower,
  upper: PRECIPITATION_FRAME.domainBound,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Intensidad verdadera
// ─────────────────────────────────────────────────────────────────────────────

export interface IntensityBand {
  name: string;
  /** mm/h, inclusivo. */
  lower: number;
  /** mm/h, exclusivo. */
  upper: number;
}

/**
 * Tramos de intensidad del muestreo, en mm/h.
 *
 * NO COINCIDEN con las hipótesis de `PRECIPITATION_FRAME` (0-5, 5-15, 15-30,
 * 30-60, 60-500), y es deliberado: si el muestreo se alineara con el marco,
 * cada mundo caería limpiamente dentro de una hipótesis y la cobertura mediría
 * un problema más fácil que el real. Los tramos de aquí son la clasificación
 * meteorológica al uso y cortan las hipótesis por dentro.
 *
 * El techo de 120 mm/h está muy por debajo del `domainBound` de 500: H0
 * (soporte acotado) se cumple en TODOS los mundos por construcción. Es lo que
 * permite leer un fallo de cobertura del nivel existencial como bug de
 * soundness y no como violación de hipótesis.
 */
export const INTENSITY_BANDS: readonly IntensityBand[] = [
  { name: 'seco', lower: 0, upper: 2 },
  { name: 'ligera', lower: 2, upper: 15 },
  { name: 'moderada', lower: 15, upper: 30 },
  { name: 'intensa', lower: 30, upper: 60 },
  { name: 'extrema', lower: 60, upper: 120 },
];

/**
 * Pesos de la mezcla — DECLARADOS, no calibrados.
 *
 * Reproducen la forma cualitativa de la distribución de intensidades horarias
 * en latitudes medias: la mayoría de las horas con precipitación son débiles y
 * la cola intensa es rara. No salen de ninguna serie: quien quiera otra
 * climatología pasa `--band-weights`.
 *
 * El peso de *extrema* (3 %) es alto para una climatología real. Se sube a
 * propósito: con 10.000 mundos, un 0,3 % daría 30 casos y el intervalo de
 * Wilson del tramo sería inútil. Es un muestreo por importancia declarado, y
 * por eso los resultados se reportan SIEMPRE desglosados por tramo además de
 * en global.
 */
export const DEFAULT_BAND_WEIGHTS: readonly number[] = [0.3, 0.35, 0.2, 0.12, 0.03];

/**
 * Sesgo sistemático por fuente (mm/h) — DECLARADO, no calibrado.
 *
 * `characterization.ts` declara σ_i y δ_i pero NO sesgo, porque nadie lo ha
 * medido (ver su aviso «VALORES DECLARADOS, NO CALIBRADOS»). Un mundo sin
 * ningún sesgo sería, sin embargo, irrealmente favorable a todos los métodos:
 * tres estimadores insesgados promedian hacia la verdad y la cobertura sale
 * bien por construcción. Se declara por tanto un sesgo pequeño frente a σ_i,
 * con el signo que la literatura instrumental hace plausible:
 *
 *   · aemet      −0,20  el pluviómetro SUBESTIMA por pérdida de captación con
 *                       viento (*undercatch*), efecto bien documentado;
 *   · open-meteo +0,30  modelo numérico, tiende a la llovizna espuria;
 *   · nasa-power +0,50  reanálisis global de celda gruesa: reparte un evento
 *                       convectivo local sobre toda la celda y sobrestima la
 *                       intensidad de fondo.
 *
 * NINGÚN método conoce estos valores: los tres los sufren por igual. Se
 * escalan con `--bias-scale` (0 los apaga).
 */
export const DECLARED_SOURCE_BIAS: Readonly<Record<string, number>> = {
  aemet: -0.2,
  'open-meteo': 0.3,
  'nasa-power': 0.5,
};

// ─────────────────────────────────────────────────────────────────────────────
// Configuración del mundo
// ─────────────────────────────────────────────────────────────────────────────

export interface WorldConfig {
  /** Pesos de {@link INTENSITY_BANDS}; se normalizan. */
  bandWeights: readonly number[];
  /** P(mundo con conflicto físico tipo virga). */
  virgaProbability: number;
  /** Multiplicador de {@link DECLARED_SOURCE_BIAS}. */
  biasScale: number;
  /**
   * P(TODAS las fuentes fallan a la vez) — violación DIRECTA de H1 del
   * Teorema 6.1 (ninguna fuente cubre la verdad). Es el barrido del
   * experimento 2; vale 0 en los otros dos.
   *
   * Cuando se activa, sustituye al resto de modos: el mundo no es ni virga ni
   * de fallo independiente, es un mundo sin evidencia válida.
   */
  jointFailureProbability: number;
  /**
   * Si `true`, TODOS los mundos son de virga (experimento 3) y γ se sortea
   * uniforme en [0, 1]. Ignora `virgaProbability`.
   */
  virgaOnly: boolean;
}

export const DEFAULT_WORLD_CONFIG: WorldConfig = {
  bandWeights: DEFAULT_BAND_WEIGHTS,
  virgaProbability: 0.15,
  biasScale: 1,
  jointFailureProbability: 0,
  virgaOnly: false,
};

/**
 * Condición del mundo, para el desglose de resultados. DISJUNTAS por
 * precedencia: `h1-violation` > `delta-failure` > `virga` > `clean`.
 *
 * El fallo de fuente domina a la virga porque es la perturbación más fuerte: un
 * mundo de virga en el que además una fuente devolvió ruido uniforme no informa
 * sobre el conflicto físico, informa sobre el fallo.
 */
export type WorldCondition = 'clean' | 'delta-failure' | 'virga' | 'h1-violation';

export interface World {
  /** P* — intensidad real de precipitación (mm/h). */
  truth: number;
  /** Tramo de {@link INTENSITY_BANDS} del que se sorteó P*. */
  band: string;
  condition: WorldCondition;
  /** Medición de cada fuente, en el orden de {@link SOURCES}. */
  values: number[];
  /** Qué fuentes fallaron (medición corrupta, independiente de P*). */
  failed: boolean[];
  /** `true` si el mundo tiene conflicto físico tipo virga. */
  virga: boolean;
  /** γ ∈ [0, 1] — atenuación física de la virga. Solo con `virga === true`. */
  gamma: number;
  /** Qué fuentes miden γ·P* (las «de abajo»). Solo con `virga === true`. */
  attenuated: boolean[];
}

/** Combinaciones de k índices de [0, n), en orden lexicográfico. */
function combinations(n: number, k: number): number[][] {
  const out: number[][] = [];
  const walk = (start: number, acc: number[]): void => {
    if (acc.length === k) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i < n; i++) walk(i + 1, [...acc, i]);
  };
  walk(0, []);
  return out;
}

/** Índice de la banda según los pesos acumulados. */
function pickBand(u: number, weights: readonly number[]): number {
  const total = weights.reduce((s, w) => s + w, 0);
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i] / total;
    if (u < acc) return i;
  }
  return weights.length - 1;
}

const clampToDomain = (x: number): number =>
  Math.min(DOMAIN.upper, Math.max(DOMAIN.lower, x));

/**
 * Sortea un mundo completo.
 *
 * ORDEN DE EXTRACCIONES FIJO. Todas las variables auxiliares —γ, el reparto de
 * fuentes de la virga— se sortean SIEMPRE, se usen o no. Así el flujo del PRNG
 * no depende de qué rama tomó el mundo anterior, y dos configuraciones que solo
 * difieren en, por ejemplo, `virgaProbability` siguen recorriendo la misma
 * secuencia de intensidades verdaderas. Cuesta tres extracciones por mundo y
 * hace comparables barridos que si no lo serían.
 */
export function sampleWorld(rng: Rng, config: WorldConfig): World {
  const n = SOURCES.length;

  // ── 1. Intensidad real ─────────────────────────────────────────────────────
  const bandIndex = pickBand(rng(), config.bandWeights);
  const band = INTENSITY_BANDS[bandIndex];
  const truth = uniform(rng, band.lower, band.upper);

  // ── 2. Modo del mundo ──────────────────────────────────────────────────────
  const uJoint = rng();
  const uVirga = rng();
  const jointFailure = uJoint < config.jointFailureProbability;
  const virga = !jointFailure && (config.virgaOnly || uVirga < config.virgaProbability);

  // ── 3. Parámetros de la virga (siempre sorteados; ver la nota de arriba) ───
  const gamma = rng();
  const uSplit = rng();
  const uSubset = rng();
  // k ∈ {1, …, n−1}: al menos una fuente arriba y al menos una abajo. Un
  // reparto degenerado (todas iguales) no es un conflicto, es un mundo normal
  // con otra verdad.
  const k = 1 + Math.min(n - 2, Math.floor(uSplit * (n - 1)));
  const subsets = combinations(n, k);
  const chosen = subsets[Math.min(subsets.length - 1, Math.floor(uSubset * subsets.length))];
  const attenuated = Array.from({ length: n }, (_, i) => virga && chosen.includes(i));

  // ── 4. Fallo de cada fuente ────────────────────────────────────────────────
  const failed: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const u = rng();
    failed.push(jointFailure || u < SOURCES[i].failureRate);
  }

  // ── 5. Mediciones ──────────────────────────────────────────────────────────
  const values: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = SOURCES[i];
    if (failed[i]) {
      // Fallo: la medición no guarda relación alguna con P*. Uniforme sobre el
      // marco, que es la ignorancia máxima compatible con H0.
      values.push(uniform(rng, DOMAIN.lower, DOMAIN.upper));
      continue;
    }
    const base = attenuated[i] ? gamma * truth : truth;
    const bias = (DECLARED_SOURCE_BIAS[c.sourceId] ?? 0) * config.biasScale;
    values.push(clampToDomain(base + bias + normal(rng, 0, c.precipitationStddev)));
  }

  const anyFailed = failed.some(Boolean);
  const condition: WorldCondition = jointFailure
    ? 'h1-violation'
    : anyFailed
      ? 'delta-failure'
      : virga
        ? 'virga'
        : 'clean';

  return { truth, band: band.name, condition, values, failed, virga, gamma, attenuated };
}

/** Pesos de banda desde un flag `--band-weights 0.3,0.35,0.2,0.12,0.03`. */
export function parseBandWeights(raw: string): readonly number[] {
  if (raw === '') return DEFAULT_BAND_WEIGHTS;
  const parts = raw.split(',').map((s) => Number(s.trim()));
  if (parts.length !== INTENSITY_BANDS.length || parts.some((w) => !Number.isFinite(w) || w < 0)) {
    throw new Error(
      `--band-weights debe ser ${INTENSITY_BANDS.length} números no negativos separados ` +
        `por comas (${INTENSITY_BANDS.map((b) => b.name).join(', ')}); recibido '${raw}'.`
    );
  }
  if (parts.reduce((s, w) => s + w, 0) <= 0) {
    throw new Error('--band-weights: la suma de los pesos debe ser positiva.');
  }
  return parts;
}
