/**
 * AURA v2 — Reglas de decisión de la estrategia de fusión (Definición 3.6)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ PROBLEMA RESUELVE ESTE FICHERO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * La Definición 3.6 del paper elige la estrategia comparando UN número con los
 * umbrales κ₁ = 0,3 y κ₂ = 0,7. La entrada 2 de `docs/ERRATA.md` demostró que
 * ese número no puede ser el K_máx por pares (no acota el conflicto de la
 * reducción secuencial) y lo sustituyó por K_decision = máx(K_máx, K_global).
 * La entrada 9 midió el precio: κ₁ y κ₂ fueron elegidos para la escala del
 * conflicto POR PARES, y K_global vive en otra escala —crece con n y con la
 * dispersión de discretización aunque no haya desacuerdo físico—, de modo que
 * la regla resultante sobre-conserva de forma estructural.
 *
 * Este módulo separa las dos funciones que aquella regla mezclaba:
 *
 *   1. **informatividad** — qué magnitud se compara con κ₁/κ₂ para elegir entre
 *      Dempster, media cautelosa y envolvente;
 *   2. **protección** — qué impide que la reducción secuencial de Dempster
 *      degenere (propiedad (P2), ver `globalConflict`).
 *
 * Cada candidato reparte esas dos funciones de otra forma. Todos pasan tras la
 * misma interfaz {@link ConflictDecisionRule} para que la elección entre ellos
 * sea un experimento y no una opinión: ver `scripts/experiments/conflict-rule.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DOS IDENTIDADES QUE SOSTIENEN TODO LO DE ABAJO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Sea U_k = 1 − K_global(m₁,…,m_k) la masa conjunta del producto de las k
 * primeras fuentes que cae en intersecciones NO vacías (U_1 = 1), y sea K^(k) el
 * conflicto del paso k-ésimo de la reducción secuencial (((m₁⊕m₂)⊕m₃)⊕…).
 *
 * (I1) **1 − K^(k) = U_{k+1} / U_k.**
 *      Demostración: la BPA acumulada tras k pasos es m^(k)(B) = ũ_k(B)/U_k, con
 *      ũ_k la masa SIN normalizar sobre la intersección B ≠ ∅. Entonces
 *      1 − K^(k) = Σ_{B∩A≠∅} m^(k)(B)·m_{k+1}(A) = (1/U_k)·Σ_{B∩A≠∅} ũ_k(B)·m_{k+1}(A),
 *      y esa suma es exactamente la masa conjunta de las k+1 primeras fuentes
 *      con intersección total no vacía, es decir U_{k+1}. ∎
 *
 * (I2) **Π_{k=1}^{n−1} (1 − K^(k)) = 1 − K_global.**
 *      Telescopio de (I1) con U_1 = 1 y U_n = 1 − K_global. ∎
 *
 * Tres consecuencias que se usan más abajo y están testeadas en
 * `__tests__/properties/global-conflict.property.test.ts`:
 *
 *   (C1) K^(k) ≤ K_global para TODO paso k. (De (I1): 1−K^(k) = U_{k+1}/U_k ≥
 *        U_{k+1} ≥ U_n, porque U_k ≤ 1 y U es decreciente en k.) Es la versión
 *        CUANTITATIVA de (P2): acotar K_global acota el factor de normalización
 *        1/(1−K) de cada paso intermedio por 1/(1−K_global).
 *   (C2) máx_k K^(k) ≥ 1 − (1−K_global)^{1/(n−1)}: el conflicto del peor paso
 *        no baja de la media geométrica de los pasos, que es exactamente el
 *        {@link equivalentPairConflict} del candidato C2. K_norm no es una
 *        analogía: es el conflicto por paso de una reducción homogénea con el
 *        mismo K_global.
 *   (C3) n = 2 ⟹ K_global = K^(1) = K por pares, y entonces K_norm = K_global
 *        de forma EXACTA (exponente 1). El candidato C2 no toca el caso binario
 *        del paper.
 */

import { FusionConfig } from './types';

/** Identificador estable de una regla. Es clave de configuración y de salida. */
export type ConflictRuleId = 'C0' | 'C1' | 'C2' | 'C3';

export const CONFLICT_RULE_IDS = ['C0', 'C1', 'C2', 'C3'] as const;

/** Nivel de conflicto de la Definición 3.6. */
export type ConflictLevel = 'low' | 'moderate' | 'high';

/** Estrategia de fusión de la Definición 3.6. */
export type FusionMethod = 'dempster' | 'cautious' | 'envelope';

/**
 * Lo que una regla necesita para decidir. Deliberadamente NO recibe las BPAs:
 * una regla es una función de (K_máx, K_global, n, umbrales) y nada más, de
 * modo que no puede introducir dependencias del orden de las fuentes ni del
 * detalle de los elementos focales.
 */
export interface ConflictDecisionInput {
  /** K_máx = máx_{i≠j} K_ij — Definición 3.5, literal del paper. */
  maxConflict: number;
  /** K_global — extensión n-aria; ver `globalConflict` en ./conflict.ts. */
  globalConflict: number;
  /** n — número de fuentes. */
  sourceCount: number;
  kappa1: number;
  kappa2: number;
  /** κ_deg — umbral de la guardia de degeneración (C1 y C3). */
  kappaDegeneracy: number;
}

/** Decisión de una regla, con toda su traza. */
export interface ConflictDecision {
  rule: ConflictRuleId;
  /**
   * La magnitud que la regla compara con κ₁ y κ₂. Es lo que el paper llama
   * «el conflicto» en la Definición 3.6, y cada regla lo define distinto.
   *
   * ⚠ `level` y `method` NO se derivan solo de este número: la guardia de
   * degeneración puede forzar la envolvente con `decisionConflict ≤ κ₂`. La
   * implicación que SÍ se conserva en las cuatro reglas es la que importa:
   * `method === 'dempster'` ⟹ `decisionConflict ≤ κ₁`.
   */
  decisionConflict: number;
  /** K_norm — conflicto por par equivalente. `null` en las reglas que no lo usan. */
  normalizedConflict: number | null;
  /** `true` si la guardia κ_deg forzó la envolvente. */
  degeneracyGuard: boolean;
  level: ConflictLevel;
  method: FusionMethod;
}

export interface ConflictDecisionRule {
  id: ConflictRuleId;
  /** Una línea para tablas y salidas de experimento. */
  label: string;
  decide(input: ConflictDecisionInput): ConflictDecision;
}

/**
 * K_norm — conflicto del PAR EQUIVALENTE de un K_global n-ario.
 *
 *     K_norm = 1 − (1 − K_global)^{1/(n−1)}       (n ≥ 2)
 *
 * Por (I2), (1 − K_global) es el producto de los (n−1) factores (1 − K^(k)) de
 * la reducción secuencial. K_norm es el K^(k) común que reproduciría ese mismo
 * producto si todos los pasos conflictuaran por igual: la MEDIA GEOMÉTRICA del
 * conflicto por paso, expresada en la escala en que κ₁ y κ₂ fueron elegidos.
 *
 * Es monótona creciente en K_global (a n fijo) y decreciente en n (a K_global
 * fijo), que es justo la corrección que la entrada 9 de `docs/ERRATA.md` pide:
 * el mismo escenario físico observado por más fuentes no debe parecer más
 * conflictivo por el mero hecho de haber más productos que vaciar.
 *
 * CONDICIONAMIENTO NUMÉRICO — limitación conocida, medida y sin consecuencias
 * sobre la decisión. La derivada
 *
 *     dK_norm/dK_global = (1/(n−1))·(1 − K_global)^{1/(n−1) − 1}
 *
 * DIVERGE cuando K_global → 1. Con n = 4, un solo ulp de diferencia en K_global
 * (2,2e-16) se convierte en 6e-6 en K_norm, porque ∛(2,2e-16) = 6,06e-6. Es
 * decir: cerca del conflicto total, K_norm NO es una magnitud numéricamente
 * estable, y dos órdenes de reducción que difieren en el último bit de K_global
 * producen K_norm distintos en la quinta cifra.
 *
 * No afecta a la ESTRATEGIA elegida, que es lo único que sale de aquí: la
 * divergencia solo ocurre con K_global ≈ 1, donde K_norm ≈ 1 está a 0,3 de κ₂ y
 * ninguna perturbación de ese tamaño puede cruzar un umbral. En el entorno de
 * los umbrales el condicionamiento es del orden de 1 (en κ₂ = 0,7 con n = 3
 * vale 0,91), y allí K_norm es tan estable como K_global. Queda anotado porque
 * un consumidor que PUBLIQUE `normalizedConflict` como cifra debe saber cuántos
 * dígitos suyos significan algo.
 *
 * CASOS LÍMITE, y por qué se tratan a mano:
 *  · n ≤ 1 → 0. Una fuente sola no se contradice consigo misma.
 *  · n = 2 → K_global TAL CUAL, sin pasar por `Math.pow`. El exponente vale 1 y
 *    la potencia sería la identidad en ℝ, pero aquí se quiere igualdad BIT A
 *    BIT con el K por pares de la Ecuación (6): el caso binario del paper no
 *    puede cambiar ni en el último dígito por haber introducido esta regla.
 *  · K_global ≥ 1 → 1. `(0)^{1/(n−1)}` es 0 y la fórmula ya da 1; se corta
 *    igualmente para que un K_global de 1 + ε por redondeo no produzca NaN.
 */
export function equivalentPairConflict(globalConflict: number, sourceCount: number): number {
  if (sourceCount <= 1) return 0;
  if (sourceCount === 2) return globalConflict;
  if (globalConflict >= 1) return 1;
  if (globalConflict <= 0) return 0;
  return 1 - Math.pow(1 - globalConflict, 1 / (sourceCount - 1));
}

/** Nivel y método de la Definición 3.6 para una magnitud dada. */
function levelOf(k: number, kappa1: number, kappa2: number): { level: ConflictLevel; method: FusionMethod } {
  if (k <= kappa1) return { level: 'low', method: 'dempster' };
  if (k <= kappa2) return { level: 'moderate', method: 'cautious' };
  return { level: 'high', method: 'envelope' };
}

/**
 * Constructor común: aplica la Definición 3.6 a `decisionConflict` y deja que
 * la guardia, si está activa, sobrescriba el resultado hacia la envolvente.
 *
 * La guardia solo puede hacer la decisión MÁS conservadora, nunca menos: se
 * aplica después y solo en la dirección `→ envelope`.
 */
function decisionOf(
  rule: ConflictRuleId,
  decisionConflict: number,
  normalizedConflict: number | null,
  guardTriggered: boolean,
  input: ConflictDecisionInput
): ConflictDecision {
  const base = levelOf(decisionConflict, input.kappa1, input.kappa2);
  return {
    rule,
    decisionConflict,
    normalizedConflict,
    degeneracyGuard: guardTriggered,
    level: guardTriggered ? 'high' : base.level,
    method: guardTriggered ? 'envelope' : base.method,
  };
}

/**
 * C0 — la regla vigente hasta esta iteración. Referencia, no candidata a
 * mejorar nada: se conserva para que cualquier número publicado con ella siga
 * siendo reproducible con un flag.
 *
 *     K_decision = máx(K_máx, K_global)     contra κ₁ y κ₂
 *
 * Por (P1) el máximo es K_global salvo redondeo. Protege por construcción —la
 * rama Dempster exige K_global ≤ κ₁— pero paga la sobre-conservación
 * estructural que mide `docs/ERRATA.md` §9: κ₁/κ₂ aplicados a una magnitud que
 * crece con n y con la granularidad del marco.
 */
export const RULE_C0: ConflictDecisionRule = {
  id: 'C0',
  label: 'C0 · K_decision = máx(K_máx, K_global) contra κ₁/κ₂',
  decide(input) {
    const k = Math.max(input.maxConflict, input.globalConflict);
    return decisionOf('C0', k, null, false, input);
  },
};

/**
 * C1 — guardia de degeneración.
 *
 *     K_decision = K_máx por pares            contra κ₁ y κ₂
 *     si K_global ≥ κ_deg → envolvente        (guardia, independiente)
 *
 * Devuelve cada magnitud a su función: κ₁/κ₂ vuelven a comparar el conflicto
 * por pares para el que fueron elegidos (Definición 3.5), y K_global deja de
 * gobernar la informatividad para hacer SOLO lo que motivó su introducción —
 * impedir que la reducción secuencial degenere.
 *
 * SOUNDNESS. La rama Dempster exige K_global < κ_deg < 1, que es la hipótesis
 * exacta de (P2): ningún paso intermedio alcanza conflicto total, en ningún
 * orden. Cuantitativamente, por (C1) del encabezado, cada paso cumple
 * K^(k) ≤ K_global < κ_deg, luego el factor 1/(1−K^(k)) está acotado por
 * 1/(1−κ_deg) = 20 con κ_deg = 0,95.
 *
 * PRECIO. Ese 20 es un factor de normalización mucho mayor que el 1/(1−κ₁) ≈
 * 1,43 que garantizaba C0: la protección se conserva, pero el margen frente a
 * la singularidad de la Ecuación (5) se estrecha en un orden de magnitud.
 */
export const RULE_C1: ConflictDecisionRule = {
  id: 'C1',
  label: 'C1 · K_máx contra κ₁/κ₂ + guardia K_global ≥ κ_deg',
  decide(input) {
    const guard = input.globalConflict >= input.kappaDegeneracy;
    return decisionOf('C1', input.maxConflict, null, guard, input);
  },
};

/**
 * C2 — normalización a par equivalente.
 *
 *     K_decision = máx(K_máx, K_norm)         contra κ₁ y κ₂
 *     K_norm = 1 − (1 − K_global)^{1/(n−1)}
 *
 * Mantiene a K_global gobernando la decisión, pero traducido a la escala del
 * par: por (C2) del encabezado, K_norm es la media geométrica del conflicto de
 * los pasos de la reducción, que es exactamente la magnitud que κ₁ y κ₂
 * pretenden acotar. El máximo con K_máx se conserva porque K_norm NO domina al
 * conflicto por pares en general (una fuente ignorante diluye K_global sin
 * borrar el desacuerdo entre las otras dos), y la decisión nunca debe ser menos
 * conservadora que la del paper.
 *
 * SOUNDNESS SIN GUARDIA. La rama Dempster exige K_norm ≤ κ₁, es decir
 *
 *     K_global ≤ 1 − (1 − κ₁)^{n−1}
 *
 * que para n ≤ `maxSourcesForGlobalConflict` = 6 vale como mucho 1 − 0,7⁵ =
 * 0,832 < 1. La hipótesis de (P2) se cumple por construcción, sin necesidad de
 * guardia, y el factor de normalización de cada paso está acotado por
 * (1−κ₁)^{−(n−1)} — 2,04 con las tres fuentes de la demo (§7.2).
 */
export const RULE_C2: ConflictDecisionRule = {
  id: 'C2',
  label: 'C2 · K_decision = máx(K_máx, K_norm) con K_norm = 1−(1−K_global)^{1/(n−1)}',
  decide(input) {
    const norm = equivalentPairConflict(input.globalConflict, input.sourceCount);
    return decisionOf('C2', Math.max(input.maxConflict, norm), norm, false, input);
  },
};

/**
 * C3 — C2 más la guardia de C1.
 *
 * ¿COLAPSA EN C2? Depende de n, y la respuesta es exacta. La guardia añade algo
 * a C2 solo si existe un caso con K_global ≥ κ_deg y máx(K_máx, K_norm) ≤ κ₂;
 * como K_norm crece con K_global, basta mirar el peor caso K_global = κ_deg:
 *
 *     K_norm(κ_deg, n) > κ₂  ⟺  (1 − κ_deg)^{1/(n−1)} < 1 − κ₂
 *                          ⟺  n − 1 < ln(1 − κ_deg) / ln(1 − κ₂)
 *
 * Con κ_deg = 0,95 y κ₂ = 0,7: ln(0,05)/ln(0,3) = 2,4882, luego la guardia es
 * REDUNDANTE para n ≤ 3 y OPERATIVA para n ≥ 4. En el dominio de la demo
 * (n = 3 fuentes, §7.2) **C3 ≡ C2 exactamente**; en el régimen que
 * `maxSourcesForGlobalConflict` admite (hasta n = 6) no: con n = 4 y
 * K_global = 0,95, K_norm = 1 − 0,05^{1/3} = 0,6316 ≤ κ₂ y C2 iría a la media
 * cautelosa mientras C3 fuerza la envolvente.
 *
 * Está testeado en `__tests__/core/dempster-shafer/conflict-rules.test.ts`.
 */
export const RULE_C3: ConflictDecisionRule = {
  id: 'C3',
  label: 'C3 · C2 + guardia K_global ≥ κ_deg',
  decide(input) {
    const norm = equivalentPairConflict(input.globalConflict, input.sourceCount);
    const guard = input.globalConflict >= input.kappaDegeneracy;
    return decisionOf('C3', Math.max(input.maxConflict, norm), norm, guard, input);
  },
};

/** Registro de reglas disponibles, por identificador. */
export const CONFLICT_RULES: Readonly<Record<ConflictRuleId, ConflictDecisionRule>> = {
  C0: RULE_C0,
  C1: RULE_C1,
  C2: RULE_C2,
  C3: RULE_C3,
};

/**
 * Resuelve la regla de una configuración.
 *
 * @throws si el identificador no existe. Un typo en `FusionConfig.rule` no debe
 *         caer en silencio a la regla por defecto: cambiaría la estrategia de
 *         fusión de todo el pipeline sin que nadie se entere.
 */
export function ruleOf(config: Pick<FusionConfig, 'rule'>): ConflictDecisionRule {
  const rule = CONFLICT_RULES[config.rule];
  if (rule === undefined) {
    throw new Error(
      `regla de conflicto desconocida: '${String(config.rule)}'. ` +
        `Disponibles: ${CONFLICT_RULE_IDS.join(', ')}.`
    );
  }
  return rule;
}
