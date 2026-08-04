/**
 * AURA v2 — Experimento pre-registrado: qué magnitud decide la Definición 3.6
 *
 *   npm run exp:conflict-rule        Fase A completa (N = 10.000 + 5.000 virga)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ SE DECIDE AQUÍ, Y POR QUÉ ESTÁ PRE-REGISTRADO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `docs/ERRATA.md` §9 documentó un defecto de DISEÑO, no de implementación: los
 * umbrales κ₁ = 0,3 y κ₂ = 0,7 fueron elegidos para el conflicto POR PARES de la
 * Definición 3.5, y la regla vigente (C0) los aplicaba a K_global, que vive en
 * otra escala —crece con n y con la dispersión de discretización aunque no haya
 * desacuerdo físico—. Consecuencia medida: en mundos limpios y concordantes solo
 * el 54,1 % llegaba a la regla de Dempster y el 15,6 % caía en envolvente.
 *
 * Elegir entre las alternativas MIRANDO sus resultados sería el mismo error que
 * la campaña de cobertura prohíbe (ajustar el sistema a la vista de la medición
 * que lo evalúa). Por eso:
 *
 *  · los CUATRO candidatos están fijados en `src/core/dempster-shafer/conflict-rules.ts`
 *    y no se tocan aquí;
 *  · el CRITERIO DE SELECCIÓN vive en `lib/selection.ts`, se aplica
 *    mecánicamente y está testeado aparte de las cifras que consume, para que
 *    no haya intervención humana entre el resultado y la decisión;
 *  · la SEMILLA de esta fase (20260311) es DISTINTA de la canónica 20260804 con
 *    la que se publican los números, para que la regla elegida no pueda quedar
 *    ajustada a la realización concreta del PRNG que luego se cita.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ESTRUCTURA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  0. **Requisito innegociable** ({@link gate}). Se evalúa ANTES de comparar
 *     nada. Un candidato que lo falle queda DESCALIFICADO por informativo que
 *     sea, y se reporta como tal.
 *  1. **Bloque de calibración**: los mismos mundos del `coverage.ts` (generador
 *     sin tocar), N = 10.000, evaluados por los cuatro candidatos.
 *  2. **Bloque virga**: N = 5.000 mundos solo-virga, misma semilla, con las
 *     métricas del experimento 3.
 *  3. **Selección**: criterio lexicográfico, aplicado y registrado paso a paso.
 *
 * No emite figuras a propósito: es un experimento de decisión interna, no una
 * medición que vaya a ilustrarse en el paper. Los números publicables salen de
 * la Fase B (`exp:coverage`, `exp:h1`, `exp:virga` con la semilla canónica).
 *
 * ⚠ κ₁ y κ₂ NO se mueven en ningún candidato. Lo único que cambia entre ellos es
 * QUÉ magnitud se compara con ellos.
 */

import { fuse } from '@/core/dempster-shafer/combination';
import { globalConflict, pairwiseConflict } from '@/core/dempster-shafer/conflict';
import {
  ConflictMeasureId,
} from '@/core/dempster-shafer/conflict-measures';
import {
  CONFLICT_RULES,
  CONFLICT_RULE_IDS,
  ConflictRuleId,
  FusionMethod,
} from '@/core/dempster-shafer/conflict-rules';
import { BPA, DEFAULT_FUSION_CONFIG, FusionConfig } from '@/core/dempster-shafer/types';
import { PRECIPITATION_FRAME } from '@/lib/constants';

import { contains, evaluate } from './lib/methods';
import { fusionConfigFor, measureOverrideOf, nameFor } from './lib/profile';
import {
  BAND_COVERAGE_FLOOR,
  CandidateScore,
  select,
  TIE_WINDOW,
  WIDTH_TIE_EPSILON,
} from './lib/selection';
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
 * dos a dos pero no las tres a la vez. K por pares = 0,75 y K_global = 1; la
 * reducción secuencial de Dempster degenera si se la deja llegar.
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

interface GateReport {
  /** (a) El ciclo no llega a Dempster. */
  cycleMethod: string;
  cyclePassed: boolean;
  /**
   * (b) Forma empírica de la propiedad: sobre TODOS los mundos de ambos
   * bloques, la rama Dempster nunca se ejecuta con K_decision > κ₂ (ni, más
   * fuerte, con K_decision > κ₁), y su K_global respeta la cota B < 1 que la
   * regla declara.
   *
   * La forma AUTORITATIVA de (b) es el property test de
   * `__tests__/properties/global-conflict.property.test.ts`, que la comprueba
   * sobre entradas generadas y en todas las permutaciones. Aquí se repite sobre
   * los mundos de este experimento para que `results.json` sea autocontenido.
   */
  dempsterViolations: number;
  globalBoundViolations: number;
  worstDempsterDecisionConflict: number;
  worstDempsterGlobalConflict: number;
  declaredGlobalBound: number;
  /**
   * Peor K^(k) observado en la rama Dempster y el factor 1/(1−K) que implica.
   * (P2′) obliga a `worstSequentialConflict ≤ worstDempsterGlobalConflict`;
   * `sequentialBoundViolations` cuenta las veces que eso no se cumplió, y debe
   * ser 0.
   */
  worstSequentialConflict: number;
  worstNormalizationFactor: number;
  sequentialBoundViolations: number;
  branchPassed: boolean;
  /** (c) Cobertura existencial sobre ambos bloques. */
  existentialMisses: number;
  soundnessPassed: boolean;
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

  add(method: 'dempster' | 'cautious' | 'envelope', guard: boolean): void {
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
      /** Veces que la guardia κ_deg forzó la envolvente (C1 y C3). */
      guardActivations: this.guard,
      guardFraction: this.guard / n,
    };
  }
}

/** Estado completo de un candidato durante la campaña. */
class CandidateState {
  readonly config: FusionConfig;

  // Bloque de calibración
  readonly existential = new Stratum();
  readonly band = new Stratum();
  readonly bandByCondition = new Map<string, Stratum>();
  readonly strategies = new StrategyCounter();
  readonly strategiesByCondition = new Map<string, StrategyCounter>();

  // Bloque virga
  readonly virgaStrategies = new StrategyCounter();
  virgaTotal = 0;
  virgaNeitherBand = 0;
  virgaNeitherExistential = 0;
  virgaBandWidthSum = 0;

  // Requisito innegociable
  cycleMethod = '';
  dempsterViolations = 0;
  globalBoundViolations = 0;
  worstDempsterDecisionConflict = 0;
  worstDempsterGlobalConflict = 0;
  /** máx sobre mundos y pasos de K^(k) en la rama Dempster — ver (P2′). */
  worstSequentialConflict = 0;
  sequentialBoundViolations = 0;
  existentialMisses = 0;

  /**
   * La configuración sale de {@link fusionConfigFor}, NO de un
   * `{ ...DEFAULT_FUSION_CONFIG, rule }` a mano.
   *
   * La diferencia importa y quedó registrada como defecto de reproducibilidad en
   * el CHANGELOG (iteración 10, «Nota de reproducibilidad»): construida a mano,
   * la configuración hereda la MEDIDA POR DEFECTO DEL SISTEMA, de modo que al
   * cambiar ese defecto de D0 a D2 la fila de C1 —la única regla que consulta la
   * medida— dejó de reproducir la tabla publicada, sin que ni el flag `--measure`
   * ni el `config.json` dijeran nada. Pasando por `fusionConfigFor`:
   *
   *  · C0, C2 y C3 quedan sobre D0, que es la medida sobre la que están
   *    congeladas (`conflict-rules.ts`), en vez de anunciar una medida que no
   *    consultan;
   *  · C1 usa la del sistema, o la que se pida con `--measure`;
   *  · con `--measure D0` las cuatro corren sobre el K crudo y la tabla histórica
   *    de `docs/ERRATA.md` §9 (Fase A) vuelve a ser reproducible desde la CLI.
   */
  constructor(
    readonly rule: ConflictRuleId,
    measure: ConflictMeasureId | undefined
  ) {
    this.config = fusionConfigFor(rule, measure);
  }

  /**
   * Cota B sobre K_global que la regla garantiza en la rama Dempster, con
   * n = |SOURCES|. Es la hipótesis de (P2′): B < 1 ⟹ ningún paso de la
   * reducción secuencial supera B. Ver `conflict-rules.ts`.
   */
  get declaredGlobalBound(): number {
    const { kappa1, kappaDegeneracy } = this.config;
    if (this.rule === 'C0') return kappa1;
    if (this.rule === 'C1') return kappaDegeneracy;
    return 1 - Math.pow(1 - kappa1, SOURCES.length - 1);
  }

  strategyFor(map: Map<string, StrategyCounter>, key: string): StrategyCounter {
    let c = map.get(key);
    if (c === undefined) {
      c = new StrategyCounter();
      map.set(key, c);
    }
    return c;
  }

  stratumFor(map: Map<string, Stratum>, key: string): Stratum {
    let s = map.get(key);
    if (s === undefined) {
      s = new Stratum();
      map.set(key, s);
    }
    return s;
  }

  /** Contabiliza un mundo del bloque de calibración. Devuelve la estrategia elegida. */
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

    this.checkBranch(
      aura.fusionMethod,
      aura.decisionConflict,
      aura.globalConflict,
      aura.maxSequentialConflict
    );
    return aura.fusionMethod;
  }

  /** Contabiliza un mundo del bloque virga. Devuelve la estrategia elegida. */
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

    this.checkBranch(
      aura.fusionMethod,
      aura.decisionConflict,
      aura.globalConflict,
      aura.maxSequentialConflict
    );
    return aura.fusionMethod;
  }

  private checkBranch(
    method: string,
    decision: number,
    kGlobal: number,
    maxSequential: number | null
  ): void {
    if (method !== 'dempster') return;
    if (decision > this.config.kappa1) this.dempsterViolations++;
    if (kGlobal > this.declaredGlobalBound + 1e-12) this.globalBoundViolations++;
    this.worstDempsterDecisionConflict = Math.max(this.worstDempsterDecisionConflict, decision);
    this.worstDempsterGlobalConflict = Math.max(this.worstDempsterGlobalConflict, kGlobal);
    if (maxSequential !== null) {
      // (P2′) empírica: ningún paso de la reducción puede superar a K_global.
      if (maxSequential > kGlobal + 1e-12) this.sequentialBoundViolations++;
      this.worstSequentialConflict = Math.max(this.worstSequentialConflict, maxSequential);
    }
  }

  gate(): GateReport {
    const cyclePassed = this.cycleMethod === 'envelope' || this.cycleMethod === 'cautious';
    const branchPassed =
      this.dempsterViolations === 0 &&
      this.globalBoundViolations === 0 &&
      this.sequentialBoundViolations === 0;
    const soundnessPassed = this.existentialMisses === 0;
    return {
      cycleMethod: this.cycleMethod,
      cyclePassed,
      dempsterViolations: this.dempsterViolations,
      globalBoundViolations: this.globalBoundViolations,
      worstDempsterDecisionConflict: this.worstDempsterDecisionConflict,
      worstDempsterGlobalConflict: this.worstDempsterGlobalConflict,
      declaredGlobalBound: this.declaredGlobalBound,
      worstSequentialConflict: this.worstSequentialConflict,
      worstNormalizationFactor: 1 / (1 - this.worstSequentialConflict),
      sequentialBoundViolations: this.sequentialBoundViolations,
      branchPassed,
      existentialMisses: this.existentialMisses,
      soundnessPassed,
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
}

// ─────────────────────────────────────────────────────────────────────────────
// Experimento
// ─────────────────────────────────────────────────────────────────────────────

function run(ctx: ExperimentContext): ExperimentOutput {
  const worlds = ctx.flags.number('worlds', 10000);
  const virgaWorlds = ctx.flags.number('virga-worlds', 5000);
  for (const [name, n] of [
    ['--worlds', worlds],
    ['--virga-worlds', virgaWorlds],
  ] as const) {
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`${name} debe ser un entero positivo; recibido ${n}.`);
    }
  }
  const virgaProbability = ctx.flags.number('virga-prob', 0.15);
  const biasScale = ctx.flags.number('bias-scale', 1);
  const bandWeights = parseBandWeights(ctx.flags.string('band-weights', ''));

  const states = new Map<ConflictRuleId, CandidateState>(
    CONFLICT_RULE_IDS.map((id) => [id, new CandidateState(id, measureOverride)])
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
  };
  for (const state of states.values()) {
    state.cycleMethod = fuse(cycle, [0.05, 0.05, 0.05], state.config).method;
  }

  // ── 1. Bloque de calibración ───────────────────────────────────────────────
  const calibrationConfig = {
    bandWeights,
    biasScale,
    jointFailureProbability: 0,
    virgaOnly: false,
    virgaProbability,
  };

  /**
   * Acuerdo PAR A PAR entre reglas: en cuántos mundos eligieron la misma
   * estrategia. Es lo que convierte «C3 colapsa en C2» de una afirmación
   * analítica en una comprobación directa sobre los 15.000 mundos, y lo que
   * hace visible cualquier otra coincidencia empírica entre candidatos que las
   * medias agregadas esconderían.
   */
  const agreement = new Map<string, number>();
  const agreementKeys: string[] = [];
  for (let a = 0; a < CONFLICT_RULE_IDS.length; a++) {
    for (let b = a + 1; b < CONFLICT_RULE_IDS.length; b++) {
      const key = `${CONFLICT_RULE_IDS[a]}~${CONFLICT_RULE_IDS[b]}`;
      agreement.set(key, 0);
      agreementKeys.push(key);
    }
  }
  const tallyAgreement = (methods: Map<ConflictRuleId, FusionMethod>): void => {
    for (let a = 0; a < CONFLICT_RULE_IDS.length; a++) {
      for (let b = a + 1; b < CONFLICT_RULE_IDS.length; b++) {
        const key = `${CONFLICT_RULE_IDS[a]}~${CONFLICT_RULE_IDS[b]}`;
        if (methods.get(CONFLICT_RULE_IDS[a]) === methods.get(CONFLICT_RULE_IDS[b])) {
          agreement.set(key, agreement.get(key)! + 1);
        }
      }
    }
  };

  const conditionCounts: Record<string, number> = {};
  for (let i = 0; i < worlds; i++) {
    // UN solo sorteo por mundo: los cuatro candidatos ven EXACTAMENTE las
    // mismas mediciones, de modo que cualquier diferencia entre ellos es de la
    // regla y no del muestreo.
    const world = sampleWorld(ctx.rng, calibrationConfig);
    conditionCounts[world.condition] = (conditionCounts[world.condition] ?? 0) + 1;
    const methods = new Map<ConflictRuleId, FusionMethod>();
    for (const state of states.values()) methods.set(state.rule, state.observeCalibration(world));
    tallyAgreement(methods);
  }

  // ── 2. Bloque virga ────────────────────────────────────────────────────────
  // Continúa el MISMO flujo del PRNG: la semilla es la del experimento y el
  // bloque virga es su segunda mitad, no una ejecución aparte.
  const virgaConfig = {
    bandWeights,
    biasScale,
    jointFailureProbability: 0,
    virgaOnly: true,
    virgaProbability: 1,
  };
  for (let i = 0; i < virgaWorlds; i++) {
    const world = sampleWorld(ctx.rng, virgaConfig);
    const methods = new Map<ConflictRuleId, FusionMethod>();
    for (const state of states.values()) methods.set(state.rule, state.observeVirga(world));
    tallyAgreement(methods);
  }

  // ── 3. Tabulación y selección ──────────────────────────────────────────────
  const byRule: Record<string, unknown> = {};
  const scores: CandidateScore[] = [];
  const csvRows: (string | number)[][] = [];

  for (const id of CONFLICT_RULE_IDS) {
    const state = states.get(id)!;
    const gate = state.gate();
    const existential = state.existential.summary();
    const band = state.band.summary();
    const clean = state.strategyFor(state.strategiesByCondition, 'clean').summary();
    const virga = state.virgaSummary();

    const bandByCondition: Record<string, StratumSummary> = {};
    const strategiesByCondition: Record<string, ReturnType<StrategyCounter['summary']>> = {};
    for (const c of CONDITION_ORDER) {
      const s = state.bandByCondition.get(c);
      if (s !== undefined) bandByCondition[c] = s.summary();
      const st = state.strategiesByCondition.get(c);
      if (st !== undefined) strategiesByCondition[c] = st.summary();
    }

    scores.push({
      rule: id,
      gatePassed: gate.passed,
      existentialCoverage: existential.coverage,
      bandCoverage: band.coverage,
      cleanDempsterFraction: clean.dempsterFraction,
      meanBandWidth: band.meanWidth,
    });

    byRule[id] = {
      label: CONFLICT_RULES[id].label,
      /**
       * Medida CONFIGURADA para este candidato. Va aquí y no solo en
       * `config.json` porque sin `--measure` no es la misma para todos: C1 recibe
       * la del sistema y C0/C2/C3 caen a D0 (`fusionConfigFor`).
       *
       * ⚠ Configurada, no consultada: C0, C2 y C3 están **congeladas sobre el K
       * crudo** y no leen este campo (`conflict-rules.ts`), de modo que un
       * `--measure` explícito aparece aquí para las cuatro pero solo cambia el
       * comportamiento de C1. Es la única regla cuya fila se mueve con la medida.
       */
      measure: state.config.measure,
      gate,
      calibration: {
        existential,
        band95: { global: band, byCondition: bandByCondition },
        strategies: { global: state.strategies.summary(), byCondition: strategiesByCondition },
      },
      virga,
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
      gate.worstDempsterGlobalConflict,
      gate.worstSequentialConflict,
      gate.worstNormalizationFactor,
      clean.dempsterFraction,
      clean.cautiousFraction,
      clean.envelopeFraction,
      state.strategies.summary().dempsterFraction,
      state.strategies.summary().envelopeFraction,
      state.strategies.summary().guardActivations,
      virga.neitherBandFraction,
      virga.strategies.dempsterFraction,
      virga.strategies.envelopeFraction,
    ]);
  }

  const totalWorlds = worlds + virgaWorlds;
  const agreementReport = Object.fromEntries(
    agreementKeys.map((k) => [
      k,
      { worlds: totalWorlds, same: agreement.get(k)!, fraction: agreement.get(k)! / totalWorlds },
    ])
  );

  const selection = select(scores);

  // ── Traza ──────────────────────────────────────────────────────────────────
  for (const s of scores) {
    ctx.log(
      `${s.rule}  gate ${s.gatePassed ? 'OK ' : 'FALLA'}  ` +
        `existencial ${(s.existentialCoverage * 100).toFixed(2)} %  ` +
        `banda-95 ${(s.bandCoverage * 100).toFixed(3)} %  ` +
        `limpios→dempster ${(s.cleanDempsterFraction * 100).toFixed(2)} %  ` +
        `anchura banda ${s.meanBandWidth.toFixed(2)} mm/h`
    );
  }
  for (const d of selection.disqualified) {
    ctx.log(`DESCALIFICADO ${d.rule} en el paso ${d.step}: ${d.reason}`);
  }
  ctx.log(`SELECCIONADO ${selection.selected} (paso ${selection.decidedAtStep}) — ${selection.rationale}`);

  return {
    config: {
      worlds,
      virgaWorlds,
      virgaProbability,
      biasScale,
      bandWeights,
      defaultBandWeights: DEFAULT_BAND_WEIGHTS,
      /**
       * Medida PEDIDA: la de `--measure`, o la del sistema si no se pasó. La
       * CONFIGURADA para cada candidato está en `candidates[].measure` y sin
       * `--measure` no coincide con ésta: C0, C2 y C3 caen a D0 (ver
       * `fusionConfigFor`). Consultarla, solo la consulta C1.
       *
       * Sin este campo, un `results.json` recién generado no declaraba bajo qué
       * medida se produjo su columna C1 — la traza incompleta que registra el
       * CHANGELOG (iteración 10, «Nota de reproducibilidad»).
       */
      measure: measureOverride ?? DEFAULT_FUSION_CONFIG.measure,
      measureOverride: measureOverride ?? null,
      candidates: CONFLICT_RULE_IDS.map((id) => ({
        id,
        label: CONFLICT_RULES[id].label,
        measure: states.get(id)!.config.measure,
      })),
      kappa1: DEFAULT_FUSION_CONFIG.kappa1,
      kappa2: DEFAULT_FUSION_CONFIG.kappa2,
      kappaDegeneracy: DEFAULT_FUSION_CONFIG.kappaDegeneracy,
      bandCoverageFloor: BAND_COVERAGE_FLOOR,
      tieWindow: TIE_WINDOW,
      widthTieEpsilon: WIDTH_TIE_EPSILON,
      preRegistration:
        'Candidatos, criterio y semilla fijados antes de ejecutar. κ₁ y κ₂ no se mueven en ' +
        'ningún candidato: lo único que cambia es qué magnitud se compara con ellos.',
    },
    results: {
      worlds,
      virgaWorlds,
      conditionCounts,
      cycleCounterexample: cycleFacts,
      agreement: agreementReport,
      byRule,
      selection,
    },
    csvHeader: [
      'rule',
      'gate_passed',
      'existential_coverage',
      'band95_coverage',
      'band95_wilson_lower',
      'band95_wilson_upper',
      'band95_mean_width',
      'band95_median_width',
      'worst_dempster_k_global',
      'worst_sequential_k',
      'worst_normalization_factor',
      'clean_dempster_fraction',
      'clean_cautious_fraction',
      'clean_envelope_fraction',
      'all_dempster_fraction',
      'all_envelope_fraction',
      'guard_activations',
      'virga_neither_band_fraction',
      'virga_dempster_fraction',
      'virga_envelope_fraction',
    ],
    csvRows,
  };
}

/**
 * `--measure` se lee ANTES de `main()`, con la misma lógica pre-`parseFlags` que
 * los demás experimentos y por el mismo motivo: entra en el nombre —y con él en
 * el directorio de salida—, de modo que la regeneración de la tabla histórica
 * bajo D0 no pisa el directorio de la ejecución a los defaults de hoy.
 */
const measureOverride = measureOverrideOf();

main({
  name: nameFor('conflict-rule', 'full', undefined, measureOverride),
  description:
    'Experimento pre-registrado (ERRATA §9): cuatro reglas de decisión de la Def. 3.6 sobre los ' +
    'mismos mundos, requisito innegociable y criterio de selección lexicográfico aplicado ' +
    'mecánicamente.',
  run,
});
