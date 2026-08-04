/**
 * AURA v2 — Pipeline de la demo, extremo a extremo
 *
 * Implementa el caso de uso de §7 de `papers/AURA_v2.pdf` encadenando las tres
 * capas por la RUTA CREDAL COMPLETA (docs/ERRATA.md §8):
 *
 *   Capa 1   fusión DS de las fuentes            (Def. 3.4, 3.6)
 *     │      ├── Def. 3.9 / Ec. (10) ──────────► intervalo credal (nivel existencial)
 *     └──────┴── EXTENSIÓN §8 ─────────────────► conjunto credal intervalar
 *   Capa 2   propagación por el DAG de la demo   (Def. 4.3 / Ec. 24, Ec. 34)
 *     │      elemento focal a elemento focal, masas intactas
 *   Capa 3   certificado de dos niveles          (Def. 5.5 + Def. 5.5′ propuesta)
 *
 * Los DOS niveles se emiten siempre y son coherentes por construcción: el
 * reachable set del veredicto existencial es el HULL del conjunto credal
 * propagado, de modo que 'proven-safe' ⟺ plUpper = 0.
 *
 * POR QUÉ IMPORTA. Con la corrección de H0 (docs/ERRATA.md §5) el nivel
 * existencial de este escenario es 'unsafe-possible' prácticamente siempre,
 * porque la masa δ_i sobre Θ mantiene plausible la cola *torrencial* y el
 * intervalo credal es [0, 500] mm/h. Ese veredicto es correcto y es inútil por
 * sí solo. El nivel probabilístico separa los casos que el existencial no puede
 * separar: con lluvia ligera concordante, Pl(inundación) ~ 1e-4; con lluvia
 * intensa concordante, Bel(inundación) ~ 1. Mismo veredicto existencial, dos
 * mundos distintos.
 */

import { BPA, FrameOfDiscernment, FusionConfig, FusionResult, CredalSet, DEFAULT_FUSION_CONFIG } from '../dempster-shafer/types';
import { createBPAFromGaussian } from '../dempster-shafer/bpa';
import { fuse } from '../dempster-shafer/combination';
import { buildCredalSet } from '../dempster-shafer/credal-set';
import { CausalDAG } from '../causal-dag/types';
import { createDemoDAG, DemoDAGParams, DEMO_DAG_DEFAULTS } from '../causal-dag/demo-dag';
import {
  CredalIntervalSet,
  CredalPropagationConfig,
  DEFAULT_CREDAL_PROPAGATION_CONFIG,
  ProbabilityBounds,
} from '../credal-propagation/types';
import { hullOf, toCredalIntervalSet } from '../credal-propagation/credal-interval-set';
import {
  credalSetAtNode,
  propagateCredalThroughDAG,
} from '../credal-propagation/propagation';
import { unsafeProbabilityBounds } from '../credal-propagation/probability-bounds';
import { CertifiedDecision, SafetySpec } from '../decision/types';
import { domainBoundsOf, synthesizeDecision } from '../decision/synthesis';
import { Interval } from '../intervals/types';
import { PRECIPITATION_FRAME } from '@/lib/constants';

/** Una fuente de la demo: medición gaussiana con su tasa de fallo δ_i. */
export interface DemoSource {
  sourceId: string;
  /** Valor medido (media de la gaussiana) — Def. 3.4, Ec. (3). */
  value: number;
  /** Desviación estándar de la medición. */
  stddev: number;
  /** δ_i, tasa de fallo de la fuente — Def. 3.4, Ec. (4). */
  failureRate: number;
}

/**
 * h_crít de la demo: **25 mm** de acumulación.
 *
 * ⚠ PARÁMETRO DECLARADO DE LA DEMO, no una calibración ni un dato del paper.
 * §7.3 introduce el tercer nivel del DAG como "riesgo de inundación, binario,
 * h > h_crít" sin fijar el valor. 25 mm es el orden de magnitud de la capacidad
 * de encharcamiento antes de desbordar el drenaje urbano modelado por la
 * Ec. (34) con D = 5 mm/h sobre 2 h. Sustituible: es un parámetro de la
 * `SafetySpec`, no una constante del motor.
 */
export const DEMO_H_CRIT = 25;

/**
 * p_crít de la demo: **0,05**. Umbral del nivel probabilístico.
 *
 * Con `plUpper < 0,05` está DEMOSTRADO que la probabilidad de inundación es
 * menor que 5 % bajo H0-H3, y el caso baja a 'warning'. No es una heurística de
 * priorización: es la des-escalada con respaldo formal que esta iteración hace
 * posible (ver `SafetySpec.unsafeProbabilityThreshold`).
 */
export const DEMO_UNSAFE_PROBABILITY_THRESHOLD = 0.05;

export const DEMO_SAFETY_SPEC: SafetySpec = {
  variable: 'h',
  // Región segura CERRADA y sin cota inferior: acumulación negativa (más
  // drenaje que lluvia) es trivialmente segura en este modelo.
  safeRegion: { lower: -Infinity, upper: DEMO_H_CRIT },
  riskThreshold: 0.5,
  unsafeProbabilityThreshold: DEMO_UNSAFE_PROBABILITY_THRESHOLD,
};

/**
 * Parámetros del DAG de la demo para el pipeline.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ EL HORIZONTE SE EVALÚA EN t = 2 h, NO SOBRE LA VENTANA [0, 2].           │
 * │                                                                          │
 * │ `DEMO_DAG_DEFAULTS.horizon` es [0, 2] h: el conjunto alcanzable sobre     │
 * │ TODA la ventana temporal. Es lo correcto para la Def. 5.3 (reachability   │
 * │ sobre un horizonte), pero degenera el nivel probabilístico: t = 0 da      │
 * │ h = h₀ = 0, trivialmente seguro, luego NINGÚN elemento focal puede quedar │
 * │ contenido en la región insegura y `belLower` es **estructuralmente 0**    │
 * │ para cualquier evidencia, incluido un diluvio.                           │
 * │                                                                          │
 * │ No es un fallo del nivel probabilístico: Bel(E) = 0 es CIERTO —existen    │
 * │ instantes seguros dentro de la ventana— y `plUpper` sigue siendo          │
 * │ informativo. Pero el evento que interesa operativamente es "¿se inunda    │
 * │ al cabo de 2 h?", no "¿hay algún instante seguro en las próximas 2 h?".   │
 * │ El pipeline evalúa por tanto h(t) en el instante final, con t = [2, 2].   │
 * │                                                                          │
 * │ Quien quiera el reachable set sobre la ventana completa puede pasar       │
 * │ `horizon: { lower: 0, upper: 2 }` y obtendrá bounds igualmente sound,     │
 * │ con belLower = 0 por la razón de arriba.                                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const DEMO_PIPELINE_DAG_PARAMS: DemoDAGParams = {
  ...DEMO_DAG_DEFAULTS,
  horizon: { lower: 2, upper: 2 },
};

export interface DemoPipelineParams {
  sources: DemoSource[];
  /** Marco de discernimiento de la entrada. Por defecto `PRECIPITATION_FRAME`. */
  frame?: FrameOfDiscernment;
  /** Parámetros del DAG de la Ec. (34). Por defecto {@link DEMO_PIPELINE_DAG_PARAMS}. */
  dagParams?: Partial<DemoDAGParams>;
  /** Especificación de seguridad. Por defecto {@link DEMO_SAFETY_SPEC}. */
  spec?: SafetySpec;
  fusionConfig?: FusionConfig;
  credalConfig?: CredalPropagationConfig;
}

export interface DemoPipelineResult {
  /** Entradas: las BPAs de cada fuente (Def. 3.4). */
  bpas: BPA[];
  /** Capa 1: fusión escalonada (Def. 3.6 extendida con K_global). */
  fusion: FusionResult;
  /**
   * Capa 1, ruta clásica: el conjunto credal de la Def. 3.8 con su intervalo
   * continuo de la Def. 3.9 / Ec. (10). Se conserva para poder CONTRASTARLO con
   * la ruta credal: es el intervalo que, por el argumento de docs/ERRATA.md §8,
   * degenera al rango completo del marco.
   */
  credalSet: CredalSet;
  /** Capa 1, ruta credal: la BPA fusionada elevada a intervalos. */
  inputCredalSet: CredalIntervalSet;
  /** DAG usado (Ec. 34). */
  dag: CausalDAG;
  /** Capa 2: el conjunto credal propagado sobre la variable objetivo. */
  propagatedCredalSet: CredalIntervalSet;
  /**
   * Reachable set del certificado: el HULL del conjunto credal propagado.
   * Coincide con propagar el intervalo de la Ec. (10) cuando la BPA fusionada
   * tiene masa sobre Θ (que es el caso normal), y nunca es más ancho.
   */
  reachableInterval: Interval;
  /** Nivel probabilístico: [Bel(E), Pl(E)] del evento inseguro. */
  probabilityBounds: ProbabilityBounds;
  /** Capa 3: decisión certificada de dos niveles. */
  decision: CertifiedDecision;
}

/**
 * Ejecuta el pipeline completo de la demo sobre un escenario de fuentes.
 *
 * @throws si el DAG, el marco o el conjunto credal no son válidos, o si los dos
 *         niveles del certificado resultaran incoherentes (no puede ocurrir por
 *         construcción; la comprobación está en `certifySafety`).
 */
export function runDemoPipeline(params: DemoPipelineParams): DemoPipelineResult {
  const {
    sources,
    frame = PRECIPITATION_FRAME,
    dagParams,
    spec = DEMO_SAFETY_SPEC,
    fusionConfig = DEFAULT_FUSION_CONFIG,
    credalConfig = DEFAULT_CREDAL_PROPAGATION_CONFIG,
  } = params;

  if (sources.length === 0) {
    throw new Error('runDemoPipeline: hacen falta al menos una fuente para fusionar.');
  }

  // ── Capa 1 ────────────────────────────────────────────────────────────────
  const bpas = sources.map((s) =>
    createBPAFromGaussian(frame, s.value, s.stddev, s.failureRate, s.sourceId, 0)
  );
  const failureRates = sources.map((s) => s.failureRate);
  const fusion = fuse(bpas, failureRates, fusionConfig);

  // Ruta clásica (Def. 3.9 / Ec. 10), conservada para contraste.
  const credalSet = buildCredalSet(fusion);

  // Ruta credal (EXTENSIÓN §8): la estructura de masa sobrevive al puente 1→2.
  const inputCredalSet = toCredalIntervalSet(fusion, credalConfig);

  // ── Capa 2 ────────────────────────────────────────────────────────────────
  const dag = createDemoDAG({ ...DEMO_PIPELINE_DAG_PARAMS, ...dagParams });
  const propagated = propagateCredalThroughDAG(inputCredalSet, dag, 'P', credalConfig);
  const propagatedCredalSet = credalSetAtNode(propagated, 'h');

  // ── Capa 3 ────────────────────────────────────────────────────────────────
  const reachableInterval = hullOf(propagatedCredalSet);
  const probabilityBounds = unsafeProbabilityBounds(propagatedCredalSet, spec.safeRegion);
  const decision = synthesizeDecision(
    reachableInterval,
    spec,
    domainBoundsOf([frame]),
    probabilityBounds
  );

  return {
    bpas,
    fusion,
    credalSet,
    inputCredalSet,
    dag,
    propagatedCredalSet,
    reachableInterval,
    probabilityBounds,
    decision,
  };
}

/**
 * Escenario de referencia: **lluvia ligera concordante**.
 *
 * Tres fuentes del orden de 8 mm/h (hipótesis *ligera*, [5, 15)) con δ del
 * orden de 0,05. Es el escenario en el que el nivel existencial es vacuo y el
 * probabilístico informativo. Fijado como regresión en
 * `__tests__/core/pipeline/demo-pipeline.test.ts`.
 */
export const DEMO_SOURCES_LIGHT_RAIN: DemoSource[] = [
  { sourceId: 'aemet', value: 8.0, stddev: 1.5, failureRate: 0.05 },
  { sourceId: 'open-meteo', value: 9.0, stddev: 2.0, failureRate: 0.03 },
  { sourceId: 'nasa-power', value: 7.5, stddev: 2.5, failureRate: 0.08 },
];

/**
 * Escenario de contraste: **lluvia intensa concordante**.
 *
 * Mismas fuentes y mismas δ, pero midiendo del orden de 45 mm/h (hipótesis
 * *intensa*, [30, 60)). El nivel existencial dice exactamente lo mismo que con
 * lluvia ligera —'unsafe-possible', reachable [−12, 992]—; el probabilístico
 * pasa de Pl ~ 1e-4 a Bel ~ 1.
 */
export const DEMO_SOURCES_HEAVY_RAIN: DemoSource[] = [
  { sourceId: 'aemet', value: 45.0, stddev: 1.5, failureRate: 0.05 },
  { sourceId: 'open-meteo', value: 46.0, stddev: 2.0, failureRate: 0.03 },
  { sourceId: 'nasa-power', value: 44.5, stddev: 2.5, failureRate: 0.08 },
];
