/**
 * AURA v2 — Reglas de combinación
 *
 * Implementa (papers/AURA_v2.pdf):
 * - Regla de Dempster: Ecuaciones (5)-(6), §3.4.1
 * - Media ponderada cautelosa: Definición 3.6 Nivel 2, Ecuación (7), §3.4.2
 * - Envolvente conservativa: Definición 3.7, Ecuaciones (8)-(9), §3.4.2
 */

import { BPA, Envelope, FocalElement, FusionResult, FusionConfig, DEFAULT_FUSION_CONFIG } from './types';
import { allBeliefPlausibility } from './bpa';
import { assessConflict } from './conflict';

/**
 * Regla de combinación de Dempster para dos BPAs.
 *
 * Paper ref: Ecuación (5) (combinación) y Ecuación (6) (factor de conflicto K), §3.4.1.
 * (m1 ⊕ m2)(A) = [1/(1-K)] Σ_{B∩C=A} m1(B)·m2(C)
 *
 * ADVERTENCIA: No usar si K > 0.7 (§3.4.1, "Limitación fundamental de la
 * regla de Dempster": la normalización por 1/(1-K) amplifica artificialmente
 * la evidencia concordante residual — problema de Zadeh).
 */
export function dempsterCombine(bpa1: BPA, bpa2: BPA): { combined: BPA; conflict: number } {
  const massMap = new Map<string, number>();
  let conflict = 0;

  for (const fe1 of bpa1.focalElements) {
    for (const fe2 of bpa2.focalElements) {
      const intersection = fe1.indices.filter((i) => fe2.indices.includes(i));
      const product = fe1.mass * fe2.mass;

      if (intersection.length === 0) {
        conflict += product;
      } else {
        const key = intersection.sort((a, b) => a - b).join(',');
        massMap.set(key, (massMap.get(key) ?? 0) + product);
      }
    }
  }

  if (conflict >= 1 - 1e-10) {
    throw new Error('Total conflict (K≈1): sources are completely contradictory. Cannot apply Dempster rule.');
  }

  const normFactor = 1 / (1 - conflict);
  const focalElements: FocalElement[] = [];

  for (const [key, mass] of massMap) {
    const indices = key.split(',').map(Number);
    focalElements.push({ indices, mass: mass * normFactor });
  }

  return {
    combined: {
      frame: bpa1.frame,
      focalElements,
      sourceId: `dempster(${bpa1.sourceId},${bpa2.sourceId})`,
      timestamp: Math.max(bpa1.timestamp, bpa2.timestamp),
    },
    conflict,
  };
}

/**
 * Combinación de Dempster para n BPAs (aplicación secuencial).
 *
 * ⚠ EL CONFLICTO SECUENCIAL NO ESTÁ ACOTADO POR EL CONFLICTO POR PARES.
 *
 * La Definición 3.5 define K solo entre pares de fuentes, y la Definición 3.6
 * elige la estrategia de fusión a partir de K_máx = máx_{i≠j} K_ij. Pero esta
 * reducción es secuencial: (((m₁⊕m₂)⊕m₃)⊕…). La BPA acumulada se concentra a
 * cada paso, de modo que su conflicto contra la siguiente fuente puede exceder
 * el de cualquier par original — hasta llegar a 1 y hacer que esta función
 * lance.
 *
 * Contraejemplo mínimo (property-based testing, 20.000 casos), 3 hipótesis:
 *   m₁ = {h₀:0,5, h₁:0,5}   m₂ = {h₁:0,5, h₂:0,5}   m₃ = {h₂:0,5, h₀:0,5}
 * Todos los pares tienen K = 0,75. Pero m₁⊕m₂ concentra toda la masa en {h₁},
 * cuyo soporte es disjunto del de m₃ ⇒ K = 1 y "Total conflict".
 *
 * PRECONDICIÓN QUE SÍ ACOTA (extensión al paper): K_global < 1, con K_global el
 * conflicto n-ario de `globalConflict`. Si K_global < 1 existe una combinación
 * (A₁,…,Aₙ) de masa positiva con intersección total no vacía, y esa
 * intersección sobrevive en TODO prefijo, de modo que ningún paso puede
 * alcanzar K = 1 en NINGÚN orden. Más aún, por (P2′) cada paso cumple
 * K^(k) ≤ K_global. `fuse` solo entra aquí con una cota K_global ≤ B < 1
 * garantizada por la regla de decisión vigente (ver `./conflict-rules.ts`), así
 * que esta función ya no puede lanzar por esa vía cuando se la llama desde el
 * pipeline. Sigue pudiendo lanzar si se la llama directamente con fuentes en
 * conflicto total, que es el comportamiento correcto: la regla de Dempster no
 * está definida ahí.
 *
 * Los K de cada paso se devuelven para auditoría y `fuse` los propaga en
 * `FusionResult.sequentialConflicts`.
 *
 * @throws Si algún paso alcanza conflicto total (K ≈ 1).
 */
export function dempsterCombineMultiple(bpas: BPA[]): { combined: BPA; conflicts: number[] } {
  if (bpas.length === 0) throw new Error('No BPAs to combine');
  if (bpas.length === 1) return { combined: bpas[0], conflicts: [] };

  let result = bpas[0];
  const conflicts: number[] = [];

  for (let i = 1; i < bpas.length; i++) {
    const { combined, conflict } = dempsterCombine(result, bpas[i]);
    result = combined;
    conflicts.push(conflict);
  }

  return { combined: result, conflicts };
}

/**
 * Media ponderada cautelosa (Nivel 2 de la estrategia escalonada).
 *
 * Paper ref: Definición 3.6 Nivel 2, Ecuación (7), §3.4.2.
 * m_fused(A) = Σ_i w_i · m_i(A)
 *
 * ⚠ DISCREPANCIA CONOCIDA PAPER ↔ CÓDIGO (candidata a errata del paper).
 *
 * La Ecuación (7) está escrita como  w_i = (1 - δ_i)^{-1} / Σ_j (1 - δ_j)^{-1},
 * pero el texto que la acompaña dice "donde los pesos favorecen fuentes con
 * menor tasa de fallo". Ambas cosas no pueden ser ciertas a la vez: con el
 * exponente −1, una fuente con δ = 0,4 obtiene peso ∝ 1/0,6 = 1,67 y una con
 * δ = 0,1 obtiene ∝ 1/0,9 = 1,11 — es decir, la fuente MENOS fiable pesa MÁS,
 * justo lo contrario de lo enunciado y de la función de la "válvula de
 * seguridad" δ_i introducida en la Definición 3.4.
 *
 * Esta implementación sigue la INTENCIÓN enunciada, no el literal:
 *
 *   w_i = (1 - δ_i) / Σ_j (1 - δ_j)
 *
 * Nótese que la elección no afecta a la soundness (Proposición 3.2: cualquier
 * ponderación convexa de BPAs es una BPA válida y la salida sigue siendo un
 * conjunto credal), solo a la informatividad. Pendiente de confirmar con el
 * autor y corregir la Ecuación (7) del paper o esta implementación.
 *
 * @param failureRates - Tasa de fallo δ_i para cada fuente
 */
export function cautiousCombine(bpas: BPA[], failureRates: number[]): BPA {
  if (bpas.length === 0) throw new Error('No BPAs to combine');
  if (bpas.length !== failureRates.length) throw new Error('BPAs and failureRates must have same length');

  const n = bpas.length;

  // Calcular pesos: w_i = (1 - δ_i) / Σ_j (1 - δ_j)
  // Fuentes más fiables (δ bajo) reciben más peso.
  const rawWeights = failureRates.map((delta) => 1 - delta);
  const weightSum = rawWeights.reduce((s, w) => s + w, 0);
  const weights = rawWeights.map((w) => w / weightSum);

  // Acumular masas ponderadas
  const massMap = new Map<string, number>();

  for (let i = 0; i < n; i++) {
    for (const fe of bpas[i].focalElements) {
      const key = [...fe.indices].sort((a, b) => a - b).join(',');
      massMap.set(key, (massMap.get(key) ?? 0) + weights[i] * fe.mass);
    }
  }

  const focalElements: FocalElement[] = [];
  for (const [key, mass] of massMap) {
    if (mass > 1e-10) {
      focalElements.push({ indices: key.split(',').map(Number), mass });
    }
  }

  return {
    frame: bpas[0].frame,
    focalElements,
    sourceId: `cautious(${bpas.map((b) => b.sourceId).join(',')})`,
    timestamp: Math.max(...bpas.map((b) => b.timestamp)),
  };
}

/**
 * Envolvente conservativa EXACTA.
 *
 * Paper ref: Definición 3.7, Ecuaciones (8)-(9), §3.4.2.
 *
 * Cuando el conflicto es alto no fusionamos: tomamos, hipótesis a hipótesis,
 * el mínimo de Bel y el máximo de Pl sobre todas las fuentes.
 *
 *   Eq (8):  P̲(θ_j) = min_i Bel_i({θ_j})
 *   Eq (9):  P̄(θ_j) = max_i Pl_i({θ_j})
 *
 * Es "la representación más conservadora posible: no descarta ninguna fuente"
 * (§3.4.2). Su cobertura es la Proposición 3.1: si la distribución real P* es
 * compatible con AL MENOS UNA fuente, entonces P̲(θ_j) ≤ P*(θ_j) ≤ P̄(θ_j)
 * para toda θ_j — que es exactamente la hipótesis H1 del Teorema 6.1.
 *
 * Esta es la envolvente tal cual la define el paper. Es la representación
 * canónica del resultado con conflicto alto; `envelopeCombine` devuelve además
 * una BPA sintética compatible con el resto del pipeline, pero esa BPA
 * SOBRE-APROXIMA el upper (ver su JSDoc).
 */
export function computeEnvelope(bpas: BPA[]): Envelope {
  if (bpas.length === 0) throw new Error('No BPAs to combine');

  const frame = bpas[0].frame;
  const allBP = bpas.map((bpa) => allBeliefPlausibility(bpa));

  const bounds = frame.hypotheses.map((_, j) => ({
    lower: Math.min(...allBP.map((bp) => bp[j].belief)),
    upper: Math.max(...allBP.map((bp) => bp[j].plausibility)),
  }));

  return { frame, bounds };
}

/**
 * Envolvente conservativa en forma de BPA sintética.
 *
 * Paper ref: Definición 3.7, Ecuaciones (8)-(9), §3.4.2.
 *
 * Asigna a cada singleton {θ_j} masa min_i Bel_i({θ_j}) y manda el resto a Θ.
 *
 * SOBRE-APROXIMACIÓN CONOCIDA: la BPA resultante reproduce exactamente el
 * lower de la envolvente (Bel({θ_j}) = min_i Bel_i({θ_j})), pero su
 * plausibilidad es
 *
 *   Pl({θ_j}) = min_i Bel_i({θ_j}) + m(Θ)
 *
 * que domina a max_i Pl_i({θ_j}), en general de forma estricta. El motivo es
 * estructural: toda la masa no asignada a singletons va a Θ, y Θ interseca a
 * todas las hipótesis, luego contribuye al Pl de todas ellas — incluidas
 * aquellas que ninguna fuente considera plausibles. Es sound (contiene la
 * envolvente), pero pierde informatividad.
 *
 * Se conserva por compatibilidad: el pipeline aguas abajo espera una BPA
 * uniforme para los tres métodos de fusión. Para la envolvente exacta usa
 * {@link computeEnvelope}, o `FusionResult.envelope`.
 */
export function envelopeCombine(bpas: BPA[]): BPA {
  if (bpas.length === 0) throw new Error('No BPAs to combine');

  const frame = bpas[0].frame;
  const n = frame.hypotheses.length;

  // Calcular Bel y Pl para cada fuente y cada hipótesis
  const allBP = bpas.map((bpa) => allBeliefPlausibility(bpa));

  // Envolvente: [min Bel_i, max Pl_i] para cada θ_j
  const focalElements: FocalElement[] = [];
  const allIndices = Array.from({ length: n }, (_, i) => i);

  // Construir BPA que refleje la envolvente:
  // Para cada singleton, asignar masa = min Bel (evidencia mínima directa)
  let assignedMass = 0;

  for (let j = 0; j < n; j++) {
    const minBel = Math.min(...allBP.map((bp) => bp[j].belief));
    if (minBel > 1e-10) {
      focalElements.push({ indices: [j], mass: minBel });
      assignedMass += minBel;
    }
  }

  // Masa restante va a Θ (ignorancia máxima compatible con la envolvente)
  const remainingMass = 1 - assignedMass;
  if (remainingMass > 1e-10) {
    focalElements.push({ indices: allIndices, mass: remainingMass });
  }

  return {
    frame,
    focalElements,
    sourceId: `envelope(${bpas.map((b) => b.sourceId).join(',')})`,
    timestamp: Math.max(...bpas.map((b) => b.timestamp)),
  };
}

/**
 * Función principal de fusión: aplica la estrategia escalonada.
 *
 * Paper ref: Definición 3.6 (estrategia de fusión por nivel de conflicto), §3.4.2.
 * Niveles: K ≤ κ₁ → Dempster; κ₁ < K ≤ κ₂ → cautelosa; K > κ₂ → envolvente.
 *
 * Los umbrales κ₁ = 0,3 y κ₂ = 0,7 son los del paper. La magnitud comparada
 * —K_decision— la construye la regla de `config.rule` a partir de K_máx,
 * K_global y n: ver {@link assessConflict} y `./conflict-rules.ts`. Bajo
 * cualquiera de las cuatro reglas, la rama Dempster exige K_global ≤ B < 1 con B
 * explícito, y entonces (P2′) acota el conflicto de TODO paso de la reducción
 * secuencial por ese mismo B, en cualquier orden.
 *
 * 1. Calcula conflicto entre fuentes (por pares y global).
 * 2. Según el nivel de conflicto, aplica Dempster / cautelosa / envolvente.
 * 3. Retorna resultado fusionado con metadatos completos, incluida la traza de
 *    la regla (`rule`, `normalizedConflict`, `degeneracyGuard`).
 */
export function fuse(
  bpas: BPA[],
  failureRates: number[],
  config: FusionConfig = DEFAULT_FUSION_CONFIG
): FusionResult {
  if (bpas.length === 0) throw new Error('No BPAs to fuse');
  if (bpas.length !== failureRates.length) throw new Error('BPAs and failureRates must have same length');

  const assessment = assessConflict(bpas, config);

  let fused: BPA;
  let envelope: Envelope | undefined;
  let sequentialConflicts: number[] | undefined;

  switch (assessment.method) {
    case 'dempster': {
      // `conflicts` NO se descarta: los K de la reducción secuencial siguen
      // pudiendo superar al K_máx por pares que se reporta (ver JSDoc de
      // dempsterCombineMultiple). Ya no pueden llegar a 1 —lo impide la cota
      // K_global ≤ B < 1 que la regla garantiza en esta rama— pero el
      // consumidor debe poder verlos.
      const { combined, conflicts } = dempsterCombineMultiple(bpas);
      fused = combined;
      sequentialConflicts = conflicts;
      break;
    }
    case 'cautious': {
      fused = cautiousCombine(bpas, failureRates);
      break;
    }
    case 'envelope': {
      // `fused` conserva la BPA sintética por compatibilidad; `envelope`
      // lleva la envolvente exacta (Def 3.7), que es la que deben usar los
      // consumidores aguas abajo.
      fused = envelopeCombine(bpas);
      envelope = computeEnvelope(bpas);
      break;
    }
  }

  // Calcular pesos de fuente (para trazabilidad)
  const rawWeights = failureRates.map((delta) => 1 - delta);
  const weightSum = rawWeights.reduce((s, w) => s + w, 0);
  const sourceWeights = rawWeights.map((w) => w / weightSum);

  return {
    fused,
    method: assessment.method,
    conflictMatrix: assessment.matrix,
    maxConflict: assessment.maxConflict,
    globalConflict: assessment.globalConflict,
    rule: assessment.decision.rule,
    decisionConflict: assessment.decision.decisionConflict,
    normalizedConflict: assessment.decision.normalizedConflict,
    degeneracyGuard: assessment.decision.degeneracyGuard,
    sourceWeights,
    envelope,
    sequentialConflicts,
  };
}
