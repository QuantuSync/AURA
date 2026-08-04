/**
 * AURA v2 — Conjuntos Credales
 *
 * Implementa (papers/AURA_v2.pdf):
 * - Definición 3.8 (conjunto credal), §3.5
 * - Proposición 3.1 (cobertura de la envolvente), §3.4.2
 * - Proposición 3.2 (equivalencia envolvente-credal), §3.5
 * - Definición 3.9 (intervalo credal continuo) y Ecuación (10), §3.6
 *
 * Esta es la representación UNIFICADA de la salida de la Capa 1.
 * Independientemente del método de fusión, la salida es siempre un CredalSet
 * (Proposición 3.2: las tres estrategias de fusión colapsan a la misma
 * representación matemática).
 */

import { BPA, CredalSet, FusionResult } from './types';
import { allBeliefPlausibility } from './bpa';

/**
 * Construye un CredalSet a partir del resultado de fusión.
 *
 * Paper ref: Definición 3.8 (conjunto credal) + Definición 3.9 (lifting continuo).
 *
 * El CredalSet contiene:
 * - bounds [Bel({θ_j}), Pl({θ_j})] para cada hipótesis
 * - intervalo credal continuo [x_min, x_max]
 * - metadatos de conflicto y método
 *
 * ENVOLVENTE EXACTA: cuando `fusionResult.envelope` existe (método
 * 'envelope'), los bounds y el lifting a intervalo continuo se toman de la
 * envolvente exacta de la Definición 3.7 en lugar de derivarlos de la BPA
 * sintética. La diferencia es material: la BPA sintética manda toda la masa
 * sobrante a Θ, que interseca todas las hipótesis, de modo que TODA hipótesis
 * acaba con Pl > 0 y el lifting de la Definición 3.9 devuelve el rango
 * completo del marco. Con la envolvente exacta, las hipótesis que ninguna
 * fuente considera plausibles quedan fuera y el intervalo es más estrecho —
 * sin perder soundness, porque sigue cubriendo el [Bel_i, Pl_i] de cada
 * fuente individual.
 */
export function buildCredalSet(fusionResult: FusionResult): CredalSet {
  const { fused, method, maxConflict, envelope } = fusionResult;
  const bp = allBeliefPlausibility(fused);
  const frame = fused.frame;

  const bounds = frame.hypotheses.map((_, j) => ({
    hypothesis: j,
    belief: envelope ? envelope.bounds[j].lower : bp[j].belief,
    plausibility: envelope ? envelope.bounds[j].upper : bp[j].plausibility,
  }));

  // Intervalo credal continuo — Definición 3.9, Ecuación (10):
  //   I(X) = ⋃ { I_j : Pl(I_j) > 0 }
  // Unión de todos los intervalos con plausibilidad ESTRICTAMENTE positiva.
  //
  // ┌──────────────────────────────────────────────────────────────────────┐
  // │ NO SUBIR EL UMBRAL 1e-10. Es tolerancia de coma flotante, NO un      │
  // │ filtro semántico.                                                    │
  // │                                                                      │
  // │ La Definición 3.9 exige plausibilidad estrictamente positiva, y el   │
  // │ Lema 6.1 (soundness del Puente 1→2, §6.1) demuestra x* ∈ [x, x]      │
  // │ precisamente porque el intervalo cubre TODA hipótesis con Pl > 0:    │
  // │ su argumento es que si Pl(θ_j) = 0 entonces P*(θ_j) = 0 y el valor   │
  // │ real no puede caer en I_j. El contrapositivo es lo que nos ata:      │
  // │ descartar una hipótesis con Pl > 0 puede excluir el valor real y     │
  // │ rompe H1 del Teorema 6.1, y con ella la soundness end-to-end.        │
  // │                                                                      │
  // │ Una cola gaussiana de Pl ≈ 3e-7 se ve "despreciable" y NO lo es:     │
  // │ formalmente es un escenario alcanzable. Subir el umbral a 1e-3 o     │
  // │ 1e-2 para estrechar el intervalo es cambiar una garantía por una     │
  // │ heurística, en silencio. Si en el futuro se quiere un intervalo más  │
  // │ estrecho, la vía correcta es un método aparte, explícitamente        │
  // │ documentado como NO sound, nunca tocar esta constante.               │
  // └──────────────────────────────────────────────────────────────────────┘
  let lower = Infinity;
  let upper = -Infinity;

  for (let j = 0; j < frame.hypotheses.length; j++) {
    if (bounds[j].plausibility > 1e-10) {
      lower = Math.min(lower, frame.hypotheses[j].lower);
      upper = Math.max(upper, frame.hypotheses[j].upper);
    }
  }

  // Degenerado: ninguna hipótesis plausible (marco mal construido o masas
  // numéricamente nulas). Lo conservativo es devolver el marco completo, no
  // un intervalo [Infinity, -Infinity] que se propagaría como NaN.
  if (lower > upper) {
    lower = frame.hypotheses[0].lower;
    upper = frame.hypotheses[frame.hypotheses.length - 1].upper;
  }

  // ┌──────────────────────────────────────────────────────────────────────┐
  // │ ⚠ TRUNCAMIENTO NO SOUND — ver docs/ERRATA.md, entrada 5.             │
  // │                                                                      │
  // │ El marco de la Definición 3.1 es exhaustivo gracias a su cola        │
  // │ abierta ([60, ∞) mm/h para precipitación). En cuanto esa hipótesis   │
  // │ tiene Pl > 0 —lo que ocurre siempre que alguna fuente tenga masa     │
  // │ sobre Θ, que interseca a todas— la Ecuación (10) devuelve +∞.        │
  // │ Un intervalo no acotado es correcto pero inutilizable aguas abajo:   │
  // │ la Capa 2 propaga +∞ y produce NaN en cuanto hay una resta o un      │
  // │ producto por 0 (Ec. 21-22).                                          │
  // │                                                                      │
  // │ Lo que sigue TRUNCA el bound superior a un valor finito derivado de  │
  // │ los datos. Eso ROMPE el Lema 6.1 y con él H1 del Teorema 6.1: si el  │
  // │ valor real supera el truncamiento, queda fuera del intervalo credal  │
  // │ y todo certificado emitido aguas abajo es inválido sin que nada lo   │
  // │ señale. Nótese además que el umbral 0.01 de abajo es exactamente el  │
  // │ "filtro semántico" que el bloque anterior prohíbe para el 1e-10.     │
  // │                                                                      │
  // │ Se conserva porque sin él el pipeline no arranca con el marco del    │
  // │ paper, y porque corregirlo bien exige un cambio de tipos: el bound   │
  // │ superior debe ser un PARÁMETRO DECLARADO del marco (un máximo físico │
  // │ justificado), no una heurística derivada de la evidencia, y debe     │
  // │ viajar en el certificado junto a H1-H3. Está registrado como entrada │
  // │ 5 de docs/ERRATA.md y como límite conocido en el README.             │
  // └──────────────────────────────────────────────────────────────────────┘
  if (!isFinite(upper)) {
    // Buscar el último intervalo con Pl > umbral
    const significantHypotheses = bounds.filter((b) => b.plausibility > 0.01);
    if (significantHypotheses.length > 0) {
      const lastSignificant = significantHypotheses[significantHypotheses.length - 1];
      const h = frame.hypotheses[lastSignificant.hypothesis];
      // Si el intervalo es abierto, usar el lower * 2 como upper práctico
      upper = isFinite(h.upper) ? h.upper : h.lower * 2;
    } else {
      upper = frame.hypotheses[frame.hypotheses.length - 1].lower * 2;
    }
  }

  return {
    frame,
    bounds,
    continuousInterval: { lower, upper },
    maxConflict,
    fusionMethod: method,
  };
}

/**
 * Verifica la propiedad de cobertura (Proposición 3.1, §3.4.2):
 * Para todo θ_j: Bel({θ_j}) ≤ Pl({θ_j})
 *
 * Esto debe ser siempre true por construcción. Si no lo es, hay un bug.
 */
export function verifyCoverage(credalSet: CredalSet): boolean {
  return credalSet.bounds.every((b) => b.belief <= b.plausibility + 1e-10);
}

/**
 * Calcula el "ancho" de la ignorancia para cada hipótesis.
 * Pl(θ_j) - Bel(θ_j): cuanto mayor, más ignorancia sobre esa hipótesis.
 */
export function ignoranceWidth(credalSet: CredalSet): number[] {
  return credalSet.bounds.map((b) => b.plausibility - b.belief);
}

/**
 * Calcula la ignorancia total del conjunto credal.
 * Suma de (Pl - Bel) sobre todas las hipótesis, normalizada.
 * 0 = conocimiento perfecto, 1 = ignorancia total.
 */
export function totalIgnorance(credalSet: CredalSet): number {
  const widths = ignoranceWidth(credalSet);
  const total = widths.reduce((s, w) => s + w, 0);
  // Normalizar: máxima ignorancia es cuando Bel=0, Pl=1 para todas → total = n
  return total / credalSet.bounds.length;
}
