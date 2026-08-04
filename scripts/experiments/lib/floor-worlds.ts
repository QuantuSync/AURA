/**
 * AURA v2 — Mundos sintéticos con las σ del HINDCAST y dispersión controlada
 *
 * El tercer bloque de la Fase A de `scripts/experiments/conflict-floor.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ ES Y QUÉ NO ES — LÉASE ANTES QUE EL CÓDIGO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * **NO son los datos del hindcast.** Aquí no se lee ni un byte de
 * `fixtures/hindcast/`. Lo único que se toma prestado del hindcast son las σ y
 * las δ declaradas a priori en `src/data/sources/hindcast-characterization.ts`
 * (5,0 / 1,8 / 10,0 mm/h y δ = 0,02), que es el parámetro que PRODUCE el suelo
 * estructural que esta iteración corrige. La verdad y las mediciones se sortean
 * aquí, con la semilla del experimento.
 *
 * La distinción no es formal, es lo que sostiene la honestidad del
 * pre-registro: los resultados del hindcast YA SON CONOCIDOS, y seleccionar una
 * medida mirándolos sería retro-ajuste. Sobre estos mundos, en cambio, existe
 * ground truth y «acertar» tiene una respuesta que no depende de nadie.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ RÉGIMEN REPRODUCE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * El régimen en que el suelo hace daño: **las tres fuentes están de acuerdo**.
 * La dispersión entre las tres mediciones se acota por
 * {@link MAX_DISPERSION_MM_H} = 0,5 mm/h, muy por debajo de la σ más fina
 * (1,8 mm/h), de modo que cualquier conflicto que el sistema vea aquí es
 * discretización y no desacuerdo. La pregunta que el bloque responde es
 * exactamente la del paso 4 del criterio: **¿qué fracción de estos mundos
 * concordantes alcanza la regla de Dempster?**
 *
 * DECLARADO, y por tanto discutible:
 *  · la dispersión máxima (0,5 mm/h) y su ley (uniforme en [0, d] por mundo, y
 *    las tres mediciones uniformes en una ventana de anchura d centrada en P*);
 *  · que NO se inyectan fallos de fuente. δ sigue entrando en cada BPA como masa
 *    sobre Θ (Ec. 4), que es lo que el sistema declara; lo que no se hace es
 *    corromper una medición, porque un mundo con una fuente devolviendo ruido no
 *    es un mundo concordante y no informa sobre el suelo;
 *  · los pesos de intensidad, que son los MISMOS de `./world.ts` para que los
 *    tres bloques de la Fase A hablen de la misma climatología.
 *
 * Los tres se fijaron antes de ejecutar nada y son configurables por CLI.
 */

import { HINDCAST_SOURCES } from '@/data/sources/hindcast-characterization';
import { Rng, uniform } from '@/lib/prng';

import { EstimatorSource } from './methods';
import { DEFAULT_BAND_WEIGHTS, DOMAIN, INTENSITY_BANDS } from './world';

/**
 * Fuentes del bloque: las tres del hindcast, con sus σ y δ declaradas a priori.
 *
 * Se reduce a {@link EstimatorSource} a propósito, para que sea evidente que de
 * la caracterización del hindcast solo se usan σ y δ —no el tamaño de celda, no
 * las etiquetas, no nada que ligue este bloque a un evento concreto—.
 */
export const HINDCAST_SIGMA_SOURCES: readonly EstimatorSource[] = HINDCAST_SOURCES.map((c) => ({
  sourceId: c.sourceId,
  precipitationStddev: c.precipitationStddev,
  failureRate: c.failureRate,
}));

/**
 * Dispersión máxima entre las tres mediciones de un mundo, en mm/h.
 *
 * 0,5 mm/h es menos de un tercio de la σ más fina declarada (1,8 mm/h): a esa
 * distancia las tres fuentes están diciendo lo mismo dentro de su propio ruido
 * declarado, y ninguna regla de fusión razonable debería leer ahí un conflicto.
 */
export const MAX_DISPERSION_MM_H = 0.5;

/** Un mundo del bloque. */
export interface FloorWorld {
  /** P* — intensidad real (mm/h). */
  truth: number;
  /** Tramo de {@link INTENSITY_BANDS} del que se sorteó P*. */
  band: string;
  /** Medición de cada fuente, en el orden de {@link HINDCAST_SIGMA_SOURCES}. */
  values: number[];
  /** Dispersión efectiva: máx − mín de las tres mediciones (mm/h). */
  dispersion: number;
}

export interface FloorWorldConfig {
  /** Pesos de {@link INTENSITY_BANDS}; se normalizan. */
  bandWeights: readonly number[];
  /** Cota superior de la dispersión, en mm/h. */
  maxDispersion: number;
}

export const DEFAULT_FLOOR_WORLD_CONFIG: FloorWorldConfig = {
  bandWeights: DEFAULT_BAND_WEIGHTS,
  maxDispersion: MAX_DISPERSION_MM_H,
};

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

const clampToDomain = (x: number): number => Math.min(DOMAIN.upper, Math.max(DOMAIN.lower, x));

/**
 * Sortea un mundo concordante.
 *
 * ORDEN DE EXTRACCIONES FIJO, igual que en `sampleWorld`: banda, verdad,
 * anchura de la ventana y una extracción por fuente. Ninguna es condicional, de
 * modo que dos configuraciones que solo difieran en `maxDispersion` recorren la
 * misma secuencia de intensidades verdaderas y son comparables mundo a mundo.
 *
 * ⚠ El recorte al dominio puede reducir la dispersión efectiva por debajo de la
 * sorteada cuando P* está pegado a 0 (las tres mediciones se aplastan contra el
 * borde). Es correcto —una medición negativa de precipitación no existe— y por
 * eso {@link FloorWorld.dispersion} se reporta MEDIDA sobre los valores finales
 * y no supuesta: el experimento verifica sobre ella que la cota se respeta.
 */
export function sampleFloorWorld(rng: Rng, config: FloorWorldConfig): FloorWorld {
  const band = INTENSITY_BANDS[pickBand(rng(), config.bandWeights)];
  const truth = uniform(rng, band.lower, band.upper);

  const spread = uniform(rng, 0, config.maxDispersion);
  const half = spread / 2;

  const values = HINDCAST_SIGMA_SOURCES.map(() =>
    clampToDomain(uniform(rng, truth - half, truth + half))
  );

  return {
    truth,
    band: band.name,
    values,
    dispersion: Math.max(...values) - Math.min(...values),
  };
}
