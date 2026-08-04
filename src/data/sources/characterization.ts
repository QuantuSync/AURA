/**
 * AURA v2 — Caracterización de incertidumbre de las fuentes
 *
 * σ (desviación estándar instrumental) y δ (tasa de fallo, Def. 3.4 / Ec. 4) de
 * cada fuente, en un único sitio.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTE MÓDULO EXISTE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Estas magnitudes estaban DUPLICADAS y en desacuerdo consigo mismas: cada
 * cliente de `./` las declaraba en línea, y `DEMO_SOURCES_LIGHT_RAIN` /
 * `DEMO_SOURCES_HEAVY_RAIN` (src/core/pipeline/demo-pipeline.ts) declaraban
 * otras distintas para las mismas tres fuentes — con σ_prec (0,5 / 1,5 / 2,0)
 * frente a (1,5 / 2,0 / 2,5) y las δ de AEMET y Open-Meteo intercambiadas.
 *
 * Mientras la ingesta real y la demo fueran caminos separados el desacuerdo era
 * invisible. Deja de serlo en cuanto el pipeline reproducible (`npm run repro`)
 * alimenta la demo DESDE los clientes: con dos caracterizaciones distintas, el
 * escenario de lluvia ligera reproducido por fixtures NO daría el
 * plUpper ≈ 1,559e-4 publicado, y el número del paper dejaría de ser regenerable.
 *
 * Se ha unificado sobre los valores de `demo-pipeline.ts` porque son los que
 * respaldan TODOS los números publicados (README, docs/ERRATA.md §8 y las
 * regresiones de `__tests__/core/pipeline/`). El acuerdo entre ambas
 * declaraciones está bloqueado por test en
 * `__tests__/data/characterization.test.ts`: si alguien cambia una, falla.
 *
 * ⚠ VALORES DECLARADOS, NO CALIBRADOS — igual que `DEMO_H_MODEL_ERROR_BOUND`.
 * Son órdenes de magnitud plausibles (un pluviómetro es más preciso que un
 * reanálisis global), no el resultado de comparar cada fuente contra una
 * referencia. Calibrarlos exige series históricas por fuente; hasta entonces H1
 * del Teorema 6.1 se asume también aquí.
 */

/** σ y δ de una fuente, por variable. */
export interface SourceCharacterization {
  sourceId: string;
  /** σ de la precipitación (mm/h). */
  precipitationStddev: number;
  /** σ de la velocidad del viento (km/h). */
  windSpeedStddev: number;
  /** σ de la temperatura (°C). */
  temperatureStddev: number;
  /** δ_i ∈ [0, 1) — masa que la Def. 3.4 / Ec. (4) reserva sobre Θ. */
  failureRate: number;
}

export const AEMET_CHARACTERIZATION: SourceCharacterization = {
  sourceId: 'aemet',
  precipitationStddev: 1.5,
  windSpeedStddev: 1.0,
  temperatureStddev: 0.3,
  failureRate: 0.05,
};

export const OPEN_METEO_CHARACTERIZATION: SourceCharacterization = {
  sourceId: 'open-meteo',
  precipitationStddev: 2.0,
  windSpeedStddev: 2.0,
  temperatureStddev: 0.5,
  failureRate: 0.03,
};

export const NASA_POWER_CHARACTERIZATION: SourceCharacterization = {
  sourceId: 'nasa-power',
  precipitationStddev: 2.5,
  windSpeedStddev: 3.0,
  temperatureStddev: 1.0,
  failureRate: 0.08,
};

export const SOURCE_CHARACTERIZATIONS: readonly SourceCharacterization[] = [
  AEMET_CHARACTERIZATION,
  OPEN_METEO_CHARACTERIZATION,
  NASA_POWER_CHARACTERIZATION,
];
