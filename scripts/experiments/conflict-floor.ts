/**
 * AURA v2 — Experimento pre-registrado: con qué se mide el conflicto por pares
 *
 *   npm run exp:conflict-floor       Fase A completa (10.000 + 5.000 + 5.000)
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ⚠ ADVERTENCIA DE HONESTIDAD — LÉASE ANTES QUE CUALQUIER NÚMERO
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * **Los resultados del hindcast sobre datos reales YA SON CONOCIDOS.**
 * `npm run exp:hindcast` está ejecutado, commiteado y descrito en
 * `docs/ERRATA.md` §9 desde la iteración anterior, y es de ahí de donde sale el
 * problema que este experimento corrige. Un experimento que eligiera la medida
 * mirando el hindcast sería retro-ajuste con pasos extra.
 *
 * Por eso, y sin excepción:
 *
 *  · la selección se hace **EXCLUSIVAMENTE sobre mundos sintéticos con ground
 *    truth**, donde «acertar» tiene respuesta objetiva;
 *  · el bloque «σ del hindcast» toma del hindcast **solo las σ y las δ
 *    declaradas a priori** —que son el parámetro que produce el suelo— y sortea
 *    mundos NUEVOS con la semilla de este experimento (ver `lib/floor-worlds.ts`);
 *  · el hindcast se re-ejecuta DESPUÉS (Fase C) y **solo como descripción**. NO
 *    es una validación ciega, y así consta literalmente en su salida, en
 *    `docs/ERRATA.md` §9 y en `scripts/experiments/README.md`.
 *
 * La semilla de esta fase (**20261007**) es nueva y distinta de la canónica
 * 20260804 con que se publican los números de la Fase B, para que la medida
 * elegida no pueda quedar ajustada a la realización concreta del PRNG que luego
 * se cita.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ SE DECIDE AQUÍ
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * El hindcast midió un **suelo estructural de conflicto**: tres BPAs gaussianas
 * construidas sobre la MISMA medición exacta, con σ de 5,0 / 1,8 / 10,0 mm/h,
 * dan K_máx = 0,3651 > κ₁ = 0,30. No hay desacuerdo que medir ahí; hay
 * discretización. Como el suelo supera κ₁, la rama de Dempster resultó
 * inalcanzable en todo el régimen de intensidades bajas y medias: en las 264
 * horas de los dos eventos no se aplicó ni una sola vez.
 *
 * Los tres candidatos están fijados en
 * `src/core/dempster-shafer/conflict-measures.ts` y no se tocan aquí:
 *
 *   · **D0** — el K crudo de la Ecuación (6). La medida vigente, y la referencia.
 *   · **D1** — exceso normalizado sobre el suelo, máx(0, (K−K_floor)/(1−K_floor)).
 *   · **D2** — distancia de Jousselme d_J(m_i, m_j) sobre la matriz de Jaccard.
 *
 * SEPARACIÓN ESTRUCTURAL, que rige a los tres: la medida gobierna SOLO la
 * comparación con κ₁/κ₂. La **guardia de degeneración** (κ_deg = 0,95) sigue
 * operando sobre el **K_global CRUDO**, porque la explosión 1/(1−K) que (P2) y
 * (P2′) previenen es propiedad del K crudo. El contraejemplo del ciclo va a
 * envolvente por la guardia bajo los tres candidatos — bajo D2 esa es la ÚNICA
 * vía, porque d_J le asigna 0,5 ≤ κ₂.
 *
 * El CRITERIO vive en `lib/floor-selection.ts`, se aplica mecánicamente y está
 * probado aparte de las cifras que consume, para que no haya intervención
 * humana entre el resultado y la decisión.
 *
 * ⚠ κ₁ y κ₂ NO se mueven. Lo único que cambia entre candidatos es CON QUÉ se
 * puntúa el desacuerdo de un par antes de compararlo con ellos.
 */

import { fuse } from '@/core/dempster-shafer/combination';
import { globalConflict, pairwiseConflict } from '@/core/dempster-shafer/conflict';
import {
  CONFLICT_MEASURES,
  CONFLICT_MEASURE_IDS,
  ConflictMeasureId,
} from '@/core/dempster-shafer/conflict-measures';
import { FusionMethod } from '@/core/dempster-shafer/conflict-rules';
import { BPA, DEFAULT_FUSION_CONFIG, FusionConfig } from '@/core/dempster-shafer/types';
import { PRECIPITATION_FRAME } from '@/lib/constants';

import {
  DEFAULT_FLOOR_WORLD_CONFIG,
  FloorWorld,
  HINDCAST_SIGMA_SOURCES,
  MAX_DISPERSION_MM_H,
  sampleFloorWorld,
} from './lib/floor-worlds';
import {
  FLOOR_BAND_COVERAGE_FLOOR,
  FLOOR_TIE_WINDOW,
  FLOOR_WIDTH_TIE_EPSILON,
  MeasureScore,
  selectMeasure,
  VIRGA_NEITHER_CEILING,
} from './lib/floor-selection';
import { auraFromValues, contains, evaluate } from './lib/methods';
import { Stratum, StratumSummary, wilsonInterval } from './lib/stats';
import {
  DEFAULT_BAND_WEIGHTS,
  parseBandWeights,
  sampleWorld,
  SOURCES,
  World,
  WorldCondition,
} from './lib/world';
import { ExperimentContext, ExperimentOutput, main } from './runner';

// ─────────────────────────────────────────────────────────────────────────────
// Requisito innegociable
// ─────────────────────────────────────────────────────────────────────────────

/**
 * El contraejemplo del ciclo (`docs/ERRATA.md` §2): tres fuentes que se solapan
 * dos a dos pero no las tres a la vez. K por pares = 0,75 y K_global = 1.
 *
 * Sus BPAs NO vienen de la Definición 3.4 —son masas escritas a mano—, de modo
 * que D1 no tiene procedencia de la que reconstruir un suelo y degrada a D0. D2
 * sí lo puntúa distinto: d_J = 0,5, por debajo de κ₂. Es el caso que hace
 * visible por qué la guardia tenía que quedarse sobre el K crudo.
 */
function cycleCounterexample(): BPA[] {
  const mk = (indices: number[][], sourceId: string): BPA => ({
    frame: PRECIPITATION_FRAME,
    focalElements: indices.map((ix) => ({ indices: ix, mass: 0.5 })),
    sourceId,
    timestamp: 0,
  });
  return [mk([[0], [1]], 'm1'), mk([[1], [2]], 'm2'), mk([[2], [0]], 'm3')];
}

/** Valores de referencia de la tabla del suelo, en mm/h. */
const FLOOR_PROBE_VALUES = [0, 0.5, 1, 2, 5, 10, 20, 40] as const;

/**
 * La tabla del problema, recomputada por cada candidato: qué ve cada medida
 * cuando las tres fuentes del hindcast miden EXACTAMENTE lo mismo.
 *
 * Es la comprobación directa de que el experimento ataca lo que dice atacar, y
 * va en `results.json` para que nadie tenga que fiarse del texto.
 */
function floorProbe(config: FusionConfig) {
  return FLOOR_PROBE_VALUES.map((v) => {
    const r = auraFromValues(
      HINDCAST_SIGMA_SOURCES.map(() => v),
      HINDCAST_SIGMA_SOURCES,
      config
    );
    return {
      valueMmH: v,
      maxConflict: r.maxConflict,
      measureConflict: r.measureConflict,
      maxFloor: r.maxFloor,
      globalConflict: r.globalConflict,
      method: r.fusionMethod,
      reachesDempster: r.fusionMethod === 'dempster',
    };
  });
}

interface GateReport {
  /** (a) El ciclo va a envolvente, y POR LA GUARDIA. */
  cycleMethod: string;
  cycleGuard: boolean;
  cycleMeasureConflict: number;
  cyclePassed: boolean;
  /**
   * (b) Forma empírica: sobre TODOS los mundos de los tres bloques, la rama
   * Dempster nunca se ejecuta con la medida de decisión > κ₂ (ni, más fuerte,
   * > κ₁) ni con K_global CRUDO ≥ κ_deg.
   *
   * La forma AUTORITATIVA de (b) es el property test de
   * `__tests__/properties/conflict-measures.property.test.ts`, que la comprueba
   * sobre entradas generadas y en todas las permutaciones. Aquí se repite sobre
   * los mundos de este experimento para que `results.json` sea autocontenido.
   */
  dempsterViolations: number;
  guardBoundViolations: number;
  worstDempsterDecisionConflict: number;
  worstDempsterGlobalConflict: number;
  declaredGlobalBound: number;
  worstSequentialConflict: number;
  worstNormalizationFactor: number;
  sequentialBoundViolations: number;
  branchPassed: boolean;
  /** (d) Cobertura existencial sobre los tres bloques. */
  existentialMisses: number;
  soundnessPassed: boolean;
  /**
   * (c) La campaña world-soundness completa NO se ejecuta aquí: vive en
   * `__tests__/experiments/world-soundness.test.ts`, que barre las tres medidas
   * × tres configuraciones de mundo × 2.000 mundos dentro de `npm run verify`.
   * Se declara la referencia para que el requisito conste entero en la salida.
   */
  worldSoundnessCampaign: string;
  passed: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Acumuladores por candidato
// ─────────────────────────────────────────────────────────────────────────────

const CONDITION_ORDER: readonly WorldCondition[] = ['clean', 'delta-failure', 'virga'];

/** Reparto de estrategias, con la fracción ya calculada. */
class StrategyCounter {
  dempster = 0;
  cautious = 0;
  envelope = 0;
  guard = 0;

  add(method: FusionMethod, guard: boolean): void {
    this[method]++;
    if (guard) this.guard++;
  }

  get total(): number {
    return this.dempster + this.cautious + this.envelope;
  }

  summary() {
    const n = this.total === 0 ? 1 : this.total;
    return {
      total: this.total,
      dempster: this.dempster,
      cautious: this.cautious,
      envelope: this.envelope,
      dempsterFraction: this.dempster / n,
      cautiousFraction: this.cautious / n,
      envelopeFraction: this.envelope / n,
      guardActivations: this.guard,
      guardFraction: this.guard / n,
    };
  }
}

/** Cuantiles de una muestra, por el mismo criterio que `virga.ts`. */
function quantiles(values: readonly number[]) {
  const s = [...values].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { min: s[0], p25: q(0.25), median: q(0.5), p75: q(0.75), p95: q(0.95), max: s[s.length - 1] };
}

/** Estado completo de un candidato durante la campaña. */
class CandidateState {
  readonly config: FusionConfig;

  // Bloque (i) — calibración estándar de coverage.ts
  readonly existential = new Stratum();
  readonly band = new Stratum();
  readonly bandByCondition = new Map<string, Stratum>();
  readonly strategies = new StrategyCounter();
  readonly strategiesByCondition = new Map<string, StrategyCounter>();

  // Bloque (ii) — virga
  readonly virgaStrategies = new StrategyCounter();
  virgaTotal = 0;
  virgaNeitherBand = 0;
  virgaNeitherExistential = 0;
  virgaBandWidthSum = 0;

  // Bloque (iii) — σ del hindcast, mundos concordantes
  readonly hindcastStrategies = new StrategyCounter();
  readonly hindcastExistential = new Stratum();
  readonly hindcastBand = new Stratum();
  readonly hindcastDecisionConflicts: number[] = [];
  readonly hindcastRawConflicts: number[] = [];
  readonly hindcastFloors: number[] = [];

  // Requisito innegociable
  cycleMethod = '';
  cycleGuard = false;
  cycleMeasureConflict = 0;
  dempsterViolations = 0;
  guardBoundViolations = 0;
  worstDempsterDecisionConflict = 0;
  worstDempsterGlobalConflict = 0;
  worstSequentialConflict = 0;
  sequentialBoundViolations = 0;
  existentialMisses = 0;

  constructor(readonly measure: ConflictMeasureId) {
    // La REGLA no cambia entre candidatos: los tres son C1 con otra medida.
    // Es lo que hace que la comparación aísle el efecto de la medida.
    this.config = { ...DEFAULT_FUSION_CONFIG, rule: 'C1', measure };
  }

  /**
   * Cota B sobre el K_global CRUDO que la regla C1 garantiza en la rama
   * Dempster: κ_deg, por la guardia. Es la hipótesis de (P2′), y NO depende de
   * la medida — ese es justamente el punto de la separación estructural.
   */
  get declaredGlobalBound(): number {
    return this.config.kappaDegeneracy;
  }

  private strategyFor(map: Map<string, StrategyCounter>, key: string): StrategyCounter {
    let c = map.get(key);
    if (c === undefined) {
      c = new StrategyCounter();
      map.set(key, c);
    }
    return c;
  }

  private stratumFor(map: Map<string, Stratum>, key: string): Stratum {
    let s = map.get(key);
    if (s === undefined) {
      s = new Stratum();
      map.set(key, s);
    }
    return s;
  }

  /** Bloque (i). Devuelve la estrategia elegida. */
  observeCalibration(world: World): FusionMethod {
    const ev = evaluate(world, this.config);
    const aura = ev.aura;

    this.strategies.add(aura.fusionMethod, aura.degeneracyGuard);
    this.strategyFor(this.strategiesByCondition, world.condition).add(
      aura.fusionMethod,
      aura.degeneracyGuard
    );

    const ex = ev.intervals['aura-existencial'];
    const hitEx = contains(ex, world.truth);
    this.existential.add(hitEx, ex.width);
    if (!hitEx) this.existentialMisses++;

    const bd = ev.intervals['aura-banda-95'];
    const hitBand = contains(bd, world.truth);
    this.band.add(hitBand, bd.width);
    this.stratumFor(this.bandByCondition, world.condition).add(hitBand, bd.width);

    this.checkBranch(aura);
    return aura.fusionMethod;
  }

  /** Bloque (ii). Devuelve la estrategia elegida. */
  observeVirga(world: World): FusionMethod {
    const ev = evaluate(world, this.config);
    const aura = ev.aura;
    const attenuated = world.gamma * world.truth;

    this.virgaTotal++;
    this.virgaStrategies.add(aura.fusionMethod, aura.degeneracyGuard);

    const bd = ev.intervals['aura-banda-95'];
    this.virgaBandWidthSum += bd.width;
    if (!contains(bd, world.truth) && !contains(bd, attenuated)) this.virgaNeitherBand++;

    const ex = ev.intervals['aura-existencial'];
    const hitEx = contains(ex, world.truth);
    if (!hitEx) this.existentialMisses++;
    if (!hitEx && !contains(ex, attenuated)) this.virgaNeitherExistential++;

    this.checkBranch(aura);
    return aura.fusionMethod;
  }

  /**
   * Bloque (iii). Mundos concordantes con las σ del hindcast.
   *
   * Usa {@link auraFromValues} con {@link HINDCAST_SIGMA_SOURCES} en lugar de
   * `evaluate`, que está atado a las σ de la demo: la σ es EL parámetro del
   * bloque y no puede venir de otra caracterización.
   */
  observeHindcastSigma(world: FloorWorld): FusionMethod {
    const aura = auraFromValues(world.values, HINDCAST_SIGMA_SOURCES, this.config);

    this.hindcastStrategies.add(aura.fusionMethod, aura.degeneracyGuard);
    this.hindcastDecisionConflicts.push(aura.decisionConflict);
    this.hindcastRawConflicts.push(aura.maxConflict);
    if (aura.maxFloor !== null) this.hindcastFloors.push(aura.maxFloor);

    const hitEx = contains(aura.existential, world.truth);
    this.hindcastExistential.add(hitEx, aura.existential.width);
    if (!hitEx) this.existentialMisses++;

    this.hindcastBand.add(contains(aura.band, world.truth), aura.band.width);

    this.checkBranch(aura);
    return aura.fusionMethod;
  }

  private checkBranch(aura: {
    fusionMethod: FusionMethod;
    decisionConflict: number;
    globalConflict: number;
    maxSequentialConflict: number | null;
  }): void {
    if (aura.fusionMethod !== 'dempster') return;
    if (aura.decisionConflict > this.config.kappa1) this.dempsterViolations++;
    // La cota de la separación estructural: la rama Dempster exige que el
    // K_global CRUDO esté por debajo de κ_deg, decida lo que decida la medida.
    if (aura.globalConflict >= this.declaredGlobalBound) this.guardBoundViolations++;
    this.worstDempsterDecisionConflict = Math.max(
      this.worstDempsterDecisionConflict,
      aura.decisionConflict
    );
    this.worstDempsterGlobalConflict = Math.max(
      this.worstDempsterGlobalConflict,
      aura.globalConflict
    );
    if (aura.maxSequentialConflict !== null) {
      // (P2′) empírica: ningún paso de la reducción puede superar a K_global.
      if (aura.maxSequentialConflict > aura.globalConflict + 1e-12) {
        this.sequentialBoundViolations++;
      }
      this.worstSequentialConflict = Math.max(
        this.worstSequentialConflict,
        aura.maxSequentialConflict
      );
    }
  }

  gate(): GateReport {
    // (a) en su forma exacta: envolvente Y por la guardia. Exigir la guardia y
    // no solo el resultado es lo que hace que el requisito siga significando
    // algo bajo D2, que por κ₂ habría elegido la media cautelosa.
    const cyclePassed = this.cycleMethod === 'envelope' && this.cycleGuard;
    const branchPassed =
      this.dempsterViolations === 0 &&
      this.guardBoundViolations === 0 &&
      this.sequentialBoundViolations === 0;
    const soundnessPassed = this.existentialMisses === 0;

    return {
      cycleMethod: this.cycleMethod,
      cycleGuard: this.cycleGuard,
      cycleMeasureConflict: this.cycleMeasureConflict,
      cyclePassed,
      dempsterViolations: this.dempsterViolations,
      guardBoundViolations: this.guardBoundViolations,
      worstDempsterDecisionConflict: this.worstDempsterDecisionConflict,
      worstDempsterGlobalConflict: this.worstDempsterGlobalConflict,
      declaredGlobalBound: this.declaredGlobalBound,
      worstSequentialConflict: this.worstSequentialConflict,
      worstNormalizationFactor: 1 / (1 - this.worstSequentialConflict),
      sequentialBoundViolations: this.sequentialBoundViolations,
      branchPassed,
      existentialMisses: this.existentialMisses,
      soundnessPassed,
      worldSoundnessCampaign:
        '__tests__/experiments/world-soundness.test.ts — 3 medidas × 3 configuraciones de mundo ' +
        '× 2.000 mundos, dentro de `npm run verify`. No se reejecuta aquí para no duplicar la ' +
        'campaña más cara de la suite.',
      passed: cyclePassed && branchPassed && soundnessPassed,
    };
  }

  virgaSummary() {
    const n = this.virgaTotal === 0 ? 1 : this.virgaTotal;
    const ci = wilsonInterval(this.virgaNeitherBand, this.virgaTotal);
    return {
      worlds: this.virgaTotal,
      neitherBand: this.virgaNeitherBand,
      neitherBandFraction: this.virgaNeitherBand / n,
      neitherBandWilsonLower: ci.lower,
      neitherBandWilsonUpper: ci.upper,
      neitherExistential: this.virgaNeitherExistential,
      neitherExistentialFraction: this.virgaNeitherExistential / n,
      meanBandWidth: this.virgaBandWidthSum / n,
      strategies: this.virgaStrategies.summary(),
    };
  }

  hindcastSigmaSummary() {
    return {
      worlds: this.hindcastStrategies.total,
      strategies: this.hindcastStrategies.summary(),
      existential: this.hindcastExistential.summary(),
      band95: this.hindcastBand.summary(),
      decisionConflict: quantiles(this.hindcastDecisionConflicts),
      rawMaxConflict: quantiles(this.hindcastRawConflicts),
      // El suelo REALMENTE descontado en estos mundos; `null` en las medidas que
      // no lo definen. Es la cifra que separa «D1 funciona» de «D1 no tenía nada
      // que descontar en este régimen».
      floor: this.hindcastFloors.length === 0 ? null : quantiles(this.hindcastFloors),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Experimento
// ─────────────────────────────────────────────────────────────────────────────

function run(ctx: ExperimentContext): ExperimentOutput {
  const worlds = ctx.flags.number('worlds', 10000);
  const virgaWorlds = ctx.flags.number('virga-worlds', 5000);
  const sigmaWorlds = ctx.flags.number('sigma-worlds', 5000);
  for (const [name, n] of [
    ['--worlds', worlds],
    ['--virga-worlds', virgaWorlds],
    ['--sigma-worlds', sigmaWorlds],
  ] as const) {
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`${name} debe ser un entero positivo; recibido ${n}.`);
    }
  }
  const virgaProbability = ctx.flags.number('virga-prob', 0.15);
  const biasScale = ctx.flags.number('bias-scale', 1);
  const maxDispersion = ctx.flags.number('max-dispersion', MAX_DISPERSION_MM_H);
  if (!(maxDispersion > 0)) {
    throw new Error(`--max-dispersion debe ser positivo; recibido ${maxDispersion}.`);
  }
  const bandWeights = parseBandWeights(ctx.flags.string('band-weights', ''));

  const states = new Map<ConflictMeasureId, CandidateState>(
    CONFLICT_MEASURE_IDS.map((id) => [id, new CandidateState(id)])
  );

  // ── 0. Requisito innegociable (a): el contraejemplo del ciclo ──────────────
  const cycle = cycleCounterexample();
  const cycleFacts = {
    pairwise: [
      pairwiseConflict(cycle[0], cycle[1]),
      pairwiseConflict(cycle[1], cycle[2]),
      pairwiseConflict(cycle[0], cycle[2]),
    ],
    globalConflict: globalConflict(cycle),
    byMeasure: Object.fromEntries(
      CONFLICT_MEASURE_IDS.map((id) => [
        id,
        {
          pairwise: [
            CONFLICT_MEASURES[id].pair(cycle[0], cycle[1]),
            CONFLICT_MEASURES[id].pair(cycle[1], cycle[2]),
            CONFLICT_MEASURES[id].pair(cycle[0], cycle[2]),
          ],
        },
      ])
    ),
  };
  for (const state of states.values()) {
    const r = fuse(cycle, [0.05, 0.05, 0.05], state.config);
    state.cycleMethod = r.method;
    state.cycleGuard = r.degeneracyGuard;
    state.cycleMeasureConflict = r.measureConflict;
  }

  // ── 1. Bloque (i): configuración estándar de coverage.ts ───────────────────
  const calibrationConfig = {
    bandWeights,
    biasScale,
    jointFailureProbability: 0,
    virgaOnly: false,
    virgaProbability,
  };

  /**
   * Acuerdo par a par entre medidas: en cuántos mundos eligieron la misma
   * estrategia. Convierte «D1 y D2 coinciden» de una impresión sobre medias
   * agregadas en una comprobación directa mundo a mundo.
   */
  const agreement = new Map<string, number>();
  const agreementKeys: string[] = [];
  for (let a = 0; a < CONFLICT_MEASURE_IDS.length; a++) {
    for (let b = a + 1; b < CONFLICT_MEASURE_IDS.length; b++) {
      const key = `${CONFLICT_MEASURE_IDS[a]}~${CONFLICT_MEASURE_IDS[b]}`;
      agreement.set(key, 0);
      agreementKeys.push(key);
    }
  }
  const tallyAgreement = (methods: Map<ConflictMeasureId, FusionMethod>): void => {
    for (let a = 0; a < CONFLICT_MEASURE_IDS.length; a++) {
      for (let b = a + 1; b < CONFLICT_MEASURE_IDS.length; b++) {
        const key = `${CONFLICT_MEASURE_IDS[a]}~${CONFLICT_MEASURE_IDS[b]}`;
        if (methods.get(CONFLICT_MEASURE_IDS[a]) === methods.get(CONFLICT_MEASURE_IDS[b])) {
          agreement.set(key, agreement.get(key)! + 1);
        }
      }
    }
  };

  const conditionCounts: Record<string, number> = {};
  for (let i = 0; i < worlds; i++) {
    // UN solo sorteo por mundo: los tres candidatos ven EXACTAMENTE las mismas
    // mediciones, de modo que cualquier diferencia entre ellos es de la medida
    // y no del muestreo.
    const world = sampleWorld(ctx.rng, calibrationConfig);
    conditionCounts[world.condition] = (conditionCounts[world.condition] ?? 0) + 1;
    const methods = new Map<ConflictMeasureId, FusionMethod>();
    for (const state of states.values()) methods.set(state.measure, state.observeCalibration(world));
    tallyAgreement(methods);
  }

  // ── 2. Bloque (ii): virga ──────────────────────────────────────────────────
  // Continúa el MISMO flujo del PRNG: la semilla es la del experimento y los
  // bloques son sus tramos sucesivos, no ejecuciones aparte.
  const virgaConfig = {
    bandWeights,
    biasScale,
    jointFailureProbability: 0,
    virgaOnly: true,
    virgaProbability: 1,
  };
  for (let i = 0; i < virgaWorlds; i++) {
    const world = sampleWorld(ctx.rng, virgaConfig);
    const methods = new Map<ConflictMeasureId, FusionMethod>();
    for (const state of states.values()) methods.set(state.measure, state.observeVirga(world));
    tallyAgreement(methods);
  }

  // ── 3. Bloque (iii): σ del hindcast, mundos concordantes ───────────────────
  const floorWorldConfig = { ...DEFAULT_FLOOR_WORLD_CONFIG, bandWeights, maxDispersion };
  let worstDispersion = 0;
  const sigmaBandCounts: Record<string, number> = {};
  for (let i = 0; i < sigmaWorlds; i++) {
    const world = sampleFloorWorld(ctx.rng, floorWorldConfig);
    worstDispersion = Math.max(worstDispersion, world.dispersion);
    sigmaBandCounts[world.band] = (sigmaBandCounts[world.band] ?? 0) + 1;
    const methods = new Map<ConflictMeasureId, FusionMethod>();
    for (const state of states.values()) {
      methods.set(state.measure, state.observeHindcastSigma(world));
    }
    tallyAgreement(methods);
  }
  // La cota declarada del bloque, verificada y no supuesta.
  if (worstDispersion > maxDispersion + 1e-9) {
    throw new Error(
      `el bloque «σ del hindcast» declara dispersión ≤ ${maxDispersion} mm/h y se observó ` +
        `${worstDispersion}. El generador no cumple su propia declaración.`
    );
  }

  // ── 4. Tabulación y selección ──────────────────────────────────────────────
  const byMeasure: Record<string, unknown> = {};
  const scores: MeasureScore[] = [];
  const csvRows: (string | number)[][] = [];

  for (const id of CONFLICT_MEASURE_IDS) {
    const state = states.get(id)!;
    const gate = state.gate();
    const existential = state.existential.summary();
    const band = state.band.summary();
    const clean = state.strategiesByCondition.get('clean')?.summary() ??
      new StrategyCounter().summary();
    const virga = state.virgaSummary();
    const sigma = state.hindcastSigmaSummary();

    const bandByCondition: Record<string, StratumSummary> = {};
    const strategiesByCondition: Record<string, ReturnType<StrategyCounter['summary']>> = {};
    for (const c of CONDITION_ORDER) {
      const s = state.bandByCondition.get(c);
      if (s !== undefined) bandByCondition[c] = s.summary();
      const st = state.strategiesByCondition.get(c);
      if (st !== undefined) strategiesByCondition[c] = st.summary();
    }

    scores.push({
      measure: id,
      gatePassed: gate.passed,
      existentialCoverage: existential.coverage,
      bandCoverage: band.coverage,
      virgaNeitherFraction: virga.neitherBandFraction,
      hindcastSigmaDempsterFraction: sigma.strategies.dempsterFraction,
      cleanDempsterFraction: clean.dempsterFraction,
      meanBandWidth: band.meanWidth,
    });

    byMeasure[id] = {
      label: CONFLICT_MEASURES[id].label,
      gate,
      floorProbe: floorProbe(state.config),
      calibration: {
        existential,
        band95: { global: band, byCondition: bandByCondition },
        strategies: { global: state.strategies.summary(), byCondition: strategiesByCondition },
      },
      virga,
      hindcastSigma: sigma,
    };

    csvRows.push([
      id,
      gate.passed ? 1 : 0,
      existential.coverage,
      band.coverage,
      band.wilsonLower,
      band.wilsonUpper,
      band.meanWidth,
      band.medianWidth,
      virga.neitherBandFraction,
      sigma.strategies.dempsterFraction,
      sigma.strategies.cautiousFraction,
      sigma.strategies.envelopeFraction,
      clean.dempsterFraction,
      clean.cautiousFraction,
      clean.envelopeFraction,
      state.strategies.summary().dempsterFraction,
      state.strategies.summary().envelopeFraction,
      state.strategies.summary().guardActivations,
      gate.worstDempsterGlobalConflict,
      gate.worstSequentialConflict,
      gate.worstNormalizationFactor,
    ]);
  }

  const totalWorlds = worlds + virgaWorlds + sigmaWorlds;
  const agreementReport = Object.fromEntries(
    agreementKeys.map((k) => [
      k,
      { worlds: totalWorlds, same: agreement.get(k)!, fraction: agreement.get(k)! / totalWorlds },
    ])
  );

  const selection = selectMeasure(scores);

  // ── Traza ──────────────────────────────────────────────────────────────────
  for (const s of scores) {
    ctx.log(
      `${s.measure}  gate ${s.gatePassed ? 'OK ' : 'FALLA'}  ` +
        `existencial ${(s.existentialCoverage * 100).toFixed(2)} %  ` +
        `banda-95 ${(s.bandCoverage * 100).toFixed(3)} %  ` +
        `virga-ni-ni ${(s.virgaNeitherFraction * 100).toFixed(3)} %  ` +
        `σ-hindcast→dempster ${(s.hindcastSigmaDempsterFraction * 100).toFixed(2)} %  ` +
        `limpios→dempster ${(s.cleanDempsterFraction * 100).toFixed(2)} %  ` +
        `anchura ${s.meanBandWidth.toFixed(2)} mm/h`
    );
  }
  for (const d of selection.disqualified) {
    ctx.log(`DESCALIFICADA ${d.measure} en el paso ${d.step}: ${d.reason}`);
  }
  ctx.log(
    `SELECCIONADA ${selection.selected} (paso ${selection.decidedAtStep}) — ${selection.rationale}`
  );

  return {
    config: {
      worlds,
      virgaWorlds,
      sigmaWorlds,
      virgaProbability,
      biasScale,
      maxDispersion,
      bandWeights,
      defaultBandWeights: DEFAULT_BAND_WEIGHTS,
      candidates: CONFLICT_MEASURE_IDS.map((id) => ({ id, label: CONFLICT_MEASURES[id].label })),
      rule: 'C1',
      kappa1: DEFAULT_FUSION_CONFIG.kappa1,
      kappa2: DEFAULT_FUSION_CONFIG.kappa2,
      kappaDegeneracy: DEFAULT_FUSION_CONFIG.kappaDegeneracy,
      bandCoverageFloor: FLOOR_BAND_COVERAGE_FLOOR,
      virgaNeitherCeiling: VIRGA_NEITHER_CEILING,
      tieWindow: FLOOR_TIE_WINDOW,
      widthTieEpsilon: FLOOR_WIDTH_TIE_EPSILON,
      demoSources: SOURCES.map((c) => ({
        sourceId: c.sourceId,
        precipitationStddev: c.precipitationStddev,
        failureRate: c.failureRate,
      })),
      hindcastSigmaSources: HINDCAST_SIGMA_SOURCES.map((c) => ({ ...c })),
      preRegistration:
        'Candidatos, requisito, criterio y semilla fijados ANTES de ejecutar. La regla es C1 en ' +
        'los tres candidatos y κ₁/κ₂ no se mueven: lo único que cambia es CON QUÉ se puntúa el ' +
        'desacuerdo de un par.',
      hindcastDisclosure:
        'LOS RESULTADOS DEL HINDCAST YA ERAN CONOCIDOS al diseñar este experimento. La selección ' +
        'se hace EXCLUSIVAMENTE sobre mundos sintéticos con ground truth; el bloque «σ del ' +
        'hindcast» usa las σ y δ declaradas a priori (5,0 / 1,8 / 10,0 mm/h, δ = 0,02) sobre ' +
        'mundos sintéticos NUEVOS, no sobre los datos reales. El hindcast se re-ejecuta después ' +
        'SOLO como descripción y NO constituye una validación ciega.',
    },
    results: {
      worlds,
      virgaWorlds,
      sigmaWorlds,
      conditionCounts,
      sigmaBandCounts,
      worstObservedDispersion: worstDispersion,
      cycleCounterexample: cycleFacts,
      agreement: agreementReport,
      byMeasure,
      selection,
    },
    csvHeader: [
      'measure',
      'gate_passed',
      'existential_coverage',
      'band95_coverage',
      'band95_wilson_lower',
      'band95_wilson_upper',
      'band95_mean_width',
      'band95_median_width',
      'virga_neither_band_fraction',
      'sigma_dempster_fraction',
      'sigma_cautious_fraction',
      'sigma_envelope_fraction',
      'clean_dempster_fraction',
      'clean_cautious_fraction',
      'clean_envelope_fraction',
      'all_dempster_fraction',
      'all_envelope_fraction',
      'guard_activations',
      'worst_dempster_k_global',
      'worst_sequential_k',
      'worst_normalization_factor',
    ],
    csvRows,
  };
}

main({
  name: 'conflict-floor',
  description:
    'Experimento pre-registrado (ERRATA §9): tres medidas por pares de la Def. 3.6 sobre los ' +
    'mismos mundos sintéticos, requisito innegociable y criterio lexicográfico aplicado ' +
    'mecánicamente. La selección NO usa los datos del hindcast, cuyos resultados ya eran ' +
    'conocidos.',
  run,
});
