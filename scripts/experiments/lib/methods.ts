/**
 * AURA v2 — Los cuatro estimadores que se comparan
 *
 * Todos reciben EL MISMO mundo (las mismas mediciones, la misma realización del
 * PRNG) y devuelven un intervalo sobre la precipitación en mm/h. La comparación
 * es por tanto pareada: cualquier diferencia de cobertura es del método, no del
 * muestreo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ SE COMPARA CONTRA QUÉ
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * AURA emite DOS niveles y hay que contarlos por separado, porque prometen
 * cosas distintas:
 *
 *  · `aura-existencial` — el intervalo credal continuo de la Def. 3.9 / Ec. (10)
 *    (`CredalSet.continuousInterval`). Es el que lleva la GARANTÍA: bajo H0-H2,
 *    el Lema 6.1 demuestra x* ∈ [x̲, x̄]. Se espera cobertura ≈ 100 % y una
 *    anchura enorme; ambas cosas son la misma cosa. NO es comparable con un
 *    intervalo al 95 %: prometer «casi siempre» y prometer «el 95 % de las
 *    veces» son contratos distintos, y el primero se paga en anchura.
 *
 *  · `aura-banda-95` — la banda de evidencia: el menor conjunto de elementos
 *    focales tomados por masa DESCENDENTE que acumula ≥ 95 % de la masa credal,
 *    y su hull. Este SÍ es comparable con los baselines: mismo nivel nominal,
 *    misma pregunta. Pero NO tiene garantía —es un resumen informativo del
 *    conjunto credal, no un certificado— y por eso se reporta siempre junto al
 *    existencial y nunca en su lugar.
 *
 * Los dos baselines IGNORAN EL CONFLICTO POR DISEÑO. No es un hombre de paja:
 * es exactamente lo que hace un sistema de fusión clásico, y medir cuánto le
 * cuesta es el objeto del experimento.
 */

import { buildCredalSet } from '@/core/dempster-shafer/credal-set';
import { createBPAFromGaussian } from '@/core/dempster-shafer/bpa';
import { fuse } from '@/core/dempster-shafer/combination';
import { toCredalIntervalSet } from '@/core/credal-propagation/credal-interval-set';
import { PRECIPITATION_FRAME } from '@/lib/constants';

import { coreHull } from '../../lib/figures';
import { SOURCES, World } from './world';

/** Un intervalo sobre la precipitación, con su anchura. */
export interface MethodInterval {
  lower: number;
  upper: number;
  width: number;
}

const interval = (lower: number, upper: number): MethodInterval => ({
  lower,
  upper,
  width: upper - lower,
});

/** Identificadores estables de los métodos. Son claves de resultados y de CSV. */
export const METHOD_IDS = [
  'aura-existencial',
  'aura-banda-95',
  'media-ponderada',
  'kalman-estatico',
] as const;

export type MethodId = (typeof METHOD_IDS)[number];

export const METHOD_LABELS: Readonly<Record<MethodId, string>> = {
  'aura-existencial': 'AURA · nivel existencial (Ec. 10)',
  'aura-banda-95': 'AURA · banda de evidencia 95 %',
  'media-ponderada': 'Baseline 1 · media ponderada',
  'kalman-estatico': 'Baseline 2 · Kalman estático',
};

/**
 * Fracción de masa credal que define la banda de evidencia.
 *
 * 0,95 y no el 0,99 de `scripts/lib/figures.ts` (`CORE_MASS`): allí la banda
 * sirve para hacer VISIBLE que un 1 % de masa estira el hull tres órdenes de
 * magnitud; aquí sirve para comparar con intervalos al 95 % nominal, y el nivel
 * debe ser el mismo o la comparación no significa nada.
 */
export const EVIDENCE_BAND_MASS = 0.95;

/** z del 95 % bilateral. El de los dos baselines, literal. */
export const Z_95 = 1.96;

export interface AuraResult {
  existential: MethodInterval;
  band: MethodInterval;
  /** Estrategia de la Def. 3.6 extendida que se activó. */
  fusionMethod: 'dempster' | 'cautious' | 'envelope';
  /** K_decision = máx(K_máx, K_global). */
  decisionConflict: number;
}

/**
 * Pipeline credal completo de la Capa 1: BPAs → conflicto → fusión → conjunto
 * credal, con los parámetros del sistema TAL CUAL (σ_i, δ_i de
 * `characterization.ts`; κ₁, κ₂ de `DEFAULT_FUSION_CONFIG`).
 *
 * Se queda en la Capa 1 a propósito: la pregunta del experimento es sobre la
 * precipitación P, que es lo que los baselines estiman. Propagar por el DAG
 * respondería a otra pregunta (la acumulación h) y no habría con qué
 * compararla.
 */
export function auraEstimate(world: World): AuraResult {
  const bpas = SOURCES.map((c, i) =>
    createBPAFromGaussian(
      PRECIPITATION_FRAME,
      world.values[i],
      c.precipitationStddev,
      c.failureRate,
      c.sourceId,
      0
    )
  );

  const fusion = fuse(
    bpas,
    SOURCES.map((c) => c.failureRate)
  );

  const credal = buildCredalSet(fusion);
  const band = coreHull(toCredalIntervalSet(fusion), EVIDENCE_BAND_MASS);

  return {
    existential: interval(credal.continuousInterval.lower, credal.continuousInterval.upper),
    band: interval(band.lower, band.upper),
    fusionMethod: fusion.method,
    decisionConflict: fusion.decisionConflict,
  };
}

/**
 * Baseline 1 — media ponderada por fiabilidad. El método del sistema
 * predecesor y la formulación estándar de fusión multi-fuente sin modelo de
 * conflicto:
 *
 *     w_i = (1 − δ_i) / Σ_j (1 − δ_j)
 *     x̂   = Σ_i w_i x_i
 *     σ_pooled = ( Σ_i w_i² σ_i² )^½                 (varianza de la combinación
 *                                                     lineal, fuentes indep.)
 *     I   = x̂ ± 1,96 · σ_pooled
 *
 * Los pesos son los MISMOS que `FusionResult.sourceWeights` usa para la regla
 * cautelosa (Ec. 7 con la corrección de docs/ERRATA.md §1), de modo que la
 * diferencia con AURA no puede atribuirse a una ponderación distinta.
 *
 * Qué ignora: que una fuente puede haber fallado (δ_i entra en el peso, no en
 * la anchura) y que dos fuentes pueden estar midiendo cosas distintas. Con
 * conflicto, x̂ cae entre las dos y σ_pooled no crece: el intervalo se queda
 * estrecho justo cuando debería ensancharse.
 */
export function weightedMeanEstimate(world: World): MethodInterval {
  const raw = SOURCES.map((c) => 1 - c.failureRate);
  const sum = raw.reduce((s, w) => s + w, 0);
  const w = raw.map((x) => x / sum);

  const mean = w.reduce((s, wi, i) => s + wi * world.values[i], 0);
  const variance = w.reduce(
    (s, wi, i) => s + wi * wi * SOURCES[i].precipitationStddev ** 2,
    0
  );
  const half = Z_95 * Math.sqrt(variance);

  return interval(mean - half, mean + half);
}

/**
 * Baseline 2 — fusión gaussiana por precisión (filtro de Kalman estático,
 * equivalentemente el estimador de máxima verosimilitud de una media común con
 * varianzas conocidas):
 *
 *     w_i = σ_i^{−2} / Σ_j σ_j^{−2}
 *     x̂   = Σ_i w_i x_i
 *     σ_post = ( Σ_i σ_i^{−2} )^{−½}
 *     I   = x̂ ± 1,96 · σ_post
 *
 * Es el óptimo cuando el modelo es correcto: fuentes independientes, insesgadas
 * y todas midiendo la misma cantidad. Sus pesos NO dependen de δ_i, luego una
 * fuente que devuelve ruido entra con todo su peso de precisión.
 *
 * Su σ_post es la MÁS PEQUEÑA de los tres métodos por construcción —la
 * precisión de la combinación es la suma de precisiones—, lo que lo hace el
 * caso extremo de la tesis: máxima informatividad nominal, mínima robustez.
 */
export function kalmanEstimate(world: World): MethodInterval {
  const precisions = SOURCES.map((c) => 1 / c.precipitationStddev ** 2);
  const total = precisions.reduce((s, p) => s + p, 0);

  const mean = precisions.reduce((s, p, i) => s + (p / total) * world.values[i], 0);
  const half = Z_95 / Math.sqrt(total);

  return interval(mean - half, mean + half);
}

/** Los cuatro intervalos de un mundo, más los metadatos de fusión de AURA. */
export interface Evaluation {
  intervals: Record<MethodId, MethodInterval>;
  fusionMethod: 'dempster' | 'cautious' | 'envelope';
  decisionConflict: number;
}

export function evaluate(world: World): Evaluation {
  const aura = auraEstimate(world);
  return {
    intervals: {
      'aura-existencial': aura.existential,
      'aura-banda-95': aura.band,
      'media-ponderada': weightedMeanEstimate(world),
      'kalman-estatico': kalmanEstimate(world),
    },
    fusionMethod: aura.fusionMethod,
    decisionConflict: aura.decisionConflict,
  };
}

/** `true` si `x` cae en el intervalo cerrado. */
export const contains = (i: MethodInterval, x: number): boolean => x >= i.lower && x <= i.upper;
