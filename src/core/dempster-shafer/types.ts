/**
 * AURA v2 — Dempster-Shafer Types
 *
 * Implements: Definiciones 3.1, 3.2, 3.3, 3.7, 3.8 de papers/AURA_v2.pdf (§3.2–3.5).
 *
 * El marco de discernimiento Θ se representa como un array de intervalos.
 * Cada intervalo es una hipótesis sobre el valor de una variable.
 */

// Import SOLO de tipos: `conflict-rules.ts` importa a su vez `FusionConfig` de
// aquí, y `import type` se borra en la emisión, de modo que el ciclo existe en
// el grafo de tipos y no en el de módulos.
import type { ConflictRuleId, FusionMethod } from './conflict-rules';
import type { ConflictMeasureId } from './conflict-measures';

/** Un intervalo [lower, upper) representando una hipótesis — Definición 3.1 */
export interface Hypothesis {
  label: string;        // e.g., "nula", "ligera", "moderada"
  lower: number;        // Límite inferior (inclusivo)
  upper: number;        // Límite superior (exclusivo, excepto el último)
}

/**
 * Marco de discernimiento Θ: conjunto finito, exhaustivo y mutuamente
 * excluyente de hipótesis — Definición 3.1, §3.2.
 *
 * SOPORTE ACOTADO DECLARADO (H0) — EXTENSIÓN al paper, ver docs/ERRATA.md §5.
 *
 * El marco de la Definición 3.1 cierra su exhaustividad con una cola ABIERTA
 * ([60, ∞) mm/h para precipitación). Esa cola hace que el lifting continuo de
 * la Definición 3.9 / Ecuación (10) devuelva `+∞` en cuanto la hipótesis de
 * cola tiene plausibilidad no nula — lo que ocurre casi siempre, porque basta
 * con que una fuente tenga masa sobre Θ, que interseca a todas.
 *
 * Un bound `+∞` es formalmente correcto pero inutilizable aguas abajo (la
 * Capa 2 propaga `+∞` y produce `NaN` en cuanto hay una resta o un producto
 * por 0, Ec. 21-22). La iteración anterior lo resolvía TRUNCANDO dentro de
 * `buildCredalSet` a `a_j·2` tras filtrar hipótesis con Pl > 0,01: un
 * truncamiento arbitrario, derivado de los datos y silencioso, que rompía el
 * Lema 6.1 y con él H1 del Teorema 6.1.
 *
 * La corrección invierte la responsabilidad: el soporte acotado deja de ser un
 * artefacto implícito del cálculo y pasa a ser una **hipótesis declarada del
 * sistema** ({@link FrameOfDiscernment.domainBound}) que viaja en el
 * certificado como H0. El código ya no adivina dónde termina la cola: exige
 * que quien define el marco lo declare, y arrastra esa declaración hasta el
 * auditor.
 */
export interface FrameOfDiscernment {
  variable: string;     // e.g., "precipitation", "wind_speed"
  unit: string;         // e.g., "mm/h", "km/h"
  hypotheses: Hypothesis[];
  /**
   * P_máx — límite superior FÍSICO declarado de la variable, en las unidades
   * del marco. Cierra la última hipótesis: [60, ∞) pasa a [60, domainBound].
   *
   * OBLIGATORIO y sin valor por defecto: es una afirmación sobre el mundo, no
   * un parámetro de cómputo, y nadie salvo quien define el marco puede
   * emitirla. Debe ser finito y estrictamente mayor que el inicio de la última
   * hipótesis; {@link createFrame} lo valida en construcción.
   *
   * SIGNIFICADO FORMAL (H0, hipótesis de soporte acotado): se afirma que el
   * valor real de la variable NUNCA excede `domainBound`. Si esa afirmación
   * falla, el conjunto credal no puede contener la realidad **por construcción
   * del marco** — no es un fallo del motor, es H0 violándose. H0 es por tanto
   * lógicamente PREVIA a H1 del Teorema 6.1: H1 (cobertura sensorial) solo
   * puede cumplirse dentro del dominio que H0 declara.
   *
   * @see docs/ERRATA.md §5
   * @see THEOREM_6_1_HYPOTHESES y HYPOTHESIS_H0_BOUNDED_SUPPORT en
   *      src/core/decision/types.ts
   */
  domainBound: number;
}

/**
 * Basic Probability Assignment (BPA) — Definición 3.2
 *
 * Mapea subconjuntos de Θ a masas en [0, 1].
 * Los subconjuntos se representan como arrays de índices de hipótesis.
 * La masa total debe sumar 1. m(∅) = 0 por construcción.
 *
 * Ejemplo: m({θ1}) = 0.6, m({θ2, θ3}) = 0.3, m(Θ) = 0.1
 * Se representa como:
 *   focalElements: [
 *     { indices: [0], mass: 0.6 },
 *     { indices: [1, 2], mass: 0.3 },
 *     { indices: [0, 1, 2, 3, 4], mass: 0.1 }  // Θ completo
 *   ]
 */
export interface FocalElement {
  indices: number[];    // Índices de las hipótesis en el marco
  mass: number;         // Masa asignada, en [0, 1]
}

/**
 * De qué medición salió una BPA construida por la Definición 3.4.
 *
 * NO es parte de la Definición 3.2: una BPA es una asignación de masa y nada
 * más, y todo el pipeline sigue funcionando sin este campo. Existe porque la
 * medida D1 de `./conflict-measures.ts` necesita poder RECONSTRUIR las dos BPAs
 * de un par sobre un valor común para separar la componente de discretización
 * del conflicto, y ese valor común no es recuperable de las masas.
 *
 * Lo pone `createBPAFromGaussian` y nadie más: una BPA fusionada, una envolvente
 * sintética o una BPA escrita a mano NO lo tienen, y las medidas que dependen de
 * él degradan explícitamente a la medida cruda (ver `structuralFloor`).
 */
export interface GaussianProvenance {
  /** Valor medido (media de la gaussiana), en las unidades del marco. */
  value: number;
  /** σ de la medición. */
  stddev: number;
  /** δ_i — Def. 3.4 / Ec. (4). */
  failureRate: number;
}

export interface BPA {
  frame: FrameOfDiscernment;
  focalElements: FocalElement[];
  sourceId: string;     // Identificador de la fuente
  timestamp: number;    // Unix timestamp de la medición
  /**
   * Procedencia gaussiana, si la BPA salió de la Definición 3.4. Opcional por
   * diseño: ver {@link GaussianProvenance}.
   */
  provenance?: GaussianProvenance;
}

/**
 * Funciones de creencia y plausibilidad — Definición 3.3
 *
 * Bel(A) = Σ_{B⊆A} m(B)   (cota inferior de probabilidad)
 * Pl(A) = Σ_{B∩A≠∅} m(B)  (cota superior de probabilidad)
 */
export interface BeliefPlausibility {
  hypothesis: number;   // Índice de la hipótesis
  belief: number;       // Bel({θ_j})
  plausibility: number; // Pl({θ_j})
}

/**
 * Envolvente conservativa EXACTA — Definición 3.7, Ecuaciones (8)-(9), §3.4.2
 *
 * Para cada hipótesis θ_j sobre un conjunto de fuentes {m_i}:
 *
 *   Eq (8):  lower[j] = P̲(θ_j) = min_i Bel_i({θ_j})
 *   Eq (9):  upper[j] = P̄(θ_j) = max_i Pl_i({θ_j})
 *
 * Es el menor "box" de intervalos [Bel, Pl] que contiene el de cada fuente
 * individual. A diferencia de la BPA sintética que devuelve `envelopeCombine`,
 * este objeto no está mediado por ninguna asignación de masa: es directamente
 * la envolvente del paper, sin sobre-aproximación.
 */
export interface Envelope {
  frame: FrameOfDiscernment;
  /** Un par [lower, upper] por hipótesis, en el orden de `frame.hypotheses`. */
  bounds: Array<{ lower: number; upper: number }>;
}

/** Resultado de fusión con metadatos */
export interface FusionResult {
  fused: BPA;
  method: FusionMethod;
  conflictMatrix: number[][];
  /**
   * K_máx = máx_{i≠j} K_ij — el conflicto por pares de la Definición 3.5,
   * literal del paper. NO es necesariamente la magnitud con que se decide la
   * estrategia: ver {@link FusionResult.decisionConflict}.
   */
  maxConflict: number;
  /**
   * K_global — masa total en intersecciones vacías del producto conjunto de
   * las n BPAs. EXTENSIÓN al paper (ver `globalConflict` en ./conflict.ts).
   * Independiente del orden de las fuentes; siempre ≥ `maxConflict`.
   */
  globalConflict: number;
  /**
   * Identificador de la regla de decisión aplicada (`FusionConfig.rule`). Va en
   * el resultado y no solo en la configuración para que un artefacto publicado
   * diga por sí mismo bajo qué regla se produjo.
   */
  rule: ConflictRuleId;
  /**
   * Identificador de la MEDIDA por pares con que se puntuó el desacuerdo
   * (`FusionConfig.measure`). Junto con `rule` determina por completo cómo se
   * llegó a `method`, y por eso viaja en el resultado: ver
   * `./conflict-measures.ts` y `docs/ERRATA.md` §9.
   */
  measure: ConflictMeasureId;
  /**
   * máx_{i≠j} de la medida — la magnitud POR PARES que la regla C1 compara con
   * κ₁ y κ₂. Con la medida D0 coincide bit a bit con {@link maxConflict}.
   */
  measureConflict: number;
  /** Matriz simétrica n×n de la medida, con diagonal 0. */
  measureMatrix: number[][];
  /**
   * Matriz de suelos K_floor por par (diagonal = auto-conflicto), o `null` si la
   * medida no define suelo (D0, D2) o si las BPAs no llevan procedencia
   * gaussiana de la que reconstruirlo.
   */
  floorMatrix: number[][] | null;
  /**
   * La magnitud que la regla comparó con κ₁ y κ₂ — el «conflicto» de la
   * Definición 3.6. Cada regla lo define distinto; ver `./conflict-rules.ts`.
   *
   * ⚠ `method` no se deduce solo de aquí: la guardia de degeneración puede
   * forzar la envolvente con `decisionConflict ≤ κ₂`. Lo que sí se cumple en
   * las cuatro reglas es `method === 'dempster'` ⟹ `decisionConflict ≤ κ₁`.
   */
  decisionConflict: number;
  /**
   * K_norm = 1 − (1 − K_global)^{1/(n−1)} — conflicto del par equivalente.
   * `null` en las reglas que no lo usan (C0, C1).
   */
  normalizedConflict: number | null;
  /**
   * `true` si la guardia de degeneración (K_global ≥ κ_deg) forzó la
   * envolvente. Siempre `false` en las reglas sin guardia (C0, C2).
   */
  degeneracyGuard: boolean;
  sourceWeights: number[];
  /**
   * Envolvente exacta según Definición 3.7. Presente únicamente cuando
   * `method === 'envelope'`, que es el único caso en que la salida pretende
   * representar una envolvente. Los consumidores deben preferir este campo a
   * los Bel/Pl derivados de `fused`, que sobre-aproximan el upper.
   */
  envelope?: Envelope;
  /**
   * Conflictos K de cada paso de la reducción secuencial de Dempster.
   * Presente únicamente cuando `method === 'dempster'`.
   *
   * ⚠ NO coinciden con `maxConflict`, que es el K_máx POR PARES de la
   * Definición 3.5. `dempsterCombineMultiple` acumula secuencialmente y el
   * conflicto de un paso intermedio puede superar con mucho al de cualquier
   * par original: la BPA acumulada se concentra y deja de solapar con las
   * fuentes restantes.
   *
   * Contraejemplo hallado por property-based testing (3 hipótesis, K_máx por
   * pares = 0,75): m₁ = {h₀:.5, h₁:.5}, m₂ = {h₁:.5, h₂:.5}, m₃ = {h₂:.5,
   * h₀:.5}. Al fusionar m₁⊕m₂ toda la masa cae en {h₁}, y entonces el
   * conflicto contra m₃ es exactamente 1.
   *
   * Desde que la estrategia decide con {@link FusionResult.decisionConflict},
   * ese régimen es inalcanzable por construcción: K_global < 1 implica que
   * ningún paso intermedio degenera, en ningún orden (propiedad (P2) del
   * JSDoc de `globalConflict`). Estos valores se siguen exponiendo para
   * auditar cuánto se aparta la reducción secuencial del conflicto por pares.
   */
  sequentialConflicts?: number[];
}

/**
 * Conjunto credal — Definición 3.8, §3.5
 *
 * P(m) = { P ∈ Δ(Θ) : P(A) ≥ Bel(A), ∀A ⊆ Θ }
 *
 * Se representa por sus bounds por hipótesis:
 * Para cada θ_j: [Bel({θ_j}), Pl({θ_j})]
 */
export interface CredalSet {
  frame: FrameOfDiscernment;
  bounds: BeliefPlausibility[];
  /** Intervalo credal continuo [x̲, x̄] — Definición 3.9, Ecuación (10), §3.6 */
  continuousInterval: { lower: number; upper: number };
  /** Indicador de conflicto */
  maxConflict: number;
  /** Método de fusión usado */
  fusionMethod: 'dempster' | 'cautious' | 'envelope';
}

/** Configuración de la estrategia de fusión — Definición 3.6, §3.4.2 */
export interface FusionConfig {
  kappa1: number;       // Umbral bajo conflicto (default 0.3)
  kappa2: number;       // Umbral alto conflicto (default 0.7)
  /**
   * Regla que decide QUÉ magnitud se compara con κ₁ y κ₂ (y si además hay
   * guardia de degeneración). EXTENSIÓN al paper: la Definición 3.6 no
   * parametriza esto porque solo contempla el conflicto por pares.
   *
   * Las cuatro reglas conviven tras `./conflict-rules.ts`; el default es la
   * seleccionada por el experimento pre-registrado `exp:conflict-rule` (ver
   * `docs/ERRATA.md` §9). C0 sigue disponible para reproducir cualquier número
   * publicado antes de esa selección.
   */
  rule: ConflictRuleId;
  /**
   * Medida por pares con que se puntúa el desacuerdo de cada par ANTES de
   * compararlo con κ₁ y κ₂. EXTENSIÓN al paper: la Definición 3.5 fija una sola
   * medida (el K de la Ec. 6) y no contempla que su escala dependa de la
   * heterogeneidad de las σ declaradas.
   *
   * Es un eje ORTOGONAL a {@link rule}: la regla decide qué se hace con la
   * magnitud, la medida decide cuál es la magnitud. Solo C1 —la regla del
   * sistema— consulta la medida; C0, C2 y C3 están congeladas sobre el K crudo
   * porque existen para reproducir números publicados antes de esta corrección
   * (ver `./conflict-rules.ts` y `docs/ERRATA.md` §9).
   *
   * La guardia de degeneración NO se ve afectada por este campo: opera siempre
   * sobre el K_global CRUDO.
   */
  measure: ConflictMeasureId;
  /**
   * κ_deg — umbral de la guardia de degeneración de las reglas C1 y C3: si
   * K_global ≥ κ_deg se fuerza la envolvente, decida lo que decida la
   * comparación con κ₁/κ₂.
   *
   * NO es un umbral de informatividad y no debe leerse como un tercer κ. Es la
   * distancia mínima que se exige frente a K_global = 1, el régimen que (P2)
   * previene: con κ_deg = 0,95, el factor 1/(1−K) de cada paso de la reducción
   * secuencial queda acotado por 20 (consecuencia (C1) de `conflict-rules.ts`).
   * Las reglas sin guardia (C0, C2) lo ignoran.
   */
  kappaDegeneracy: number;
  /**
   * Número máximo de fuentes para las que se computa el conflicto global
   * n-ario (default 6). EXTENSIÓN al paper, no un parámetro de la Def. 3.6.
   *
   * `globalConflict` recorre el producto conjunto de las n BPAs: su coste es
   * exponencial en n. El límite hace explícito el régimen de validez —la demo
   * usa 3 fuentes (§7.2)— y por encima de él la función LANZA, en lugar de
   * caer en silencio a la decisión por pares, que es justo la que no acota el
   * conflicto de la reducción secuencial.
   */
  maxSourcesForGlobalConflict: number;
}

/**
 * Configuración del sistema. Los dos ejes de la Definición 3.6 extendida son
 * resultado de sendos experimentos PRE-REGISTRADOS, no de una preferencia.
 *
 * `rule: 'C1'` — `npm run exp:conflict-rule` (semilla 20260311,
 * `docs/ERRATA.md` §9): los cuatro candidatos pasaron el requisito innegociable
 * y los pasos 1-2 del criterio, C1/C2/C3 empataron exactamente en los pasos 3 y
 * 4 —eligen la misma estrategia en los 15.000 mundos— y decidió el paso 5,
 * simplicidad.
 *
 * `measure: 'D2'` — `npm run exp:conflict-floor` (semilla 20261007,
 * `docs/ERRATA.md` §9): las tres medidas pasaron el requisito innegociable;
 * **D1 quedó DESCALIFICADA en el paso 2** (cobertura de banda-95 del 99,48 %,
 * por debajo del piso pre-registrado del 99,5 %) pese a ser la que más suelo
 * descuenta, y D2 —la distancia de Jousselme— ganó el paso 4 en solitario. La
 * selección se hizo SOLO sobre mundos sintéticos: los resultados del hindcast
 * ya eran conocidos y no participan en ella.
 *
 * κ₁ y κ₂ siguen siendo los del paper y no se han movido.
 */
export const DEFAULT_FUSION_CONFIG: FusionConfig = {
  kappa1: 0.3,
  kappa2: 0.7,
  rule: 'C1',
  measure: 'D2',
  kappaDegeneracy: 0.95,
  maxSourcesForGlobalConflict: 6,
};
