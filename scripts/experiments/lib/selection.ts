/**
 * AURA v2 — El criterio de selección PRE-REGISTRADO de `docs/ERRATA.md` §9
 *
 * Vive aparte del experimento que produce los números (`conflict-rule.ts`) por
 * una razón que no es de estilo: el pre-registro solo significa algo si el paso
 * de «cifras» a «decisión» es una función auditable y probada por separado, no
 * un juicio emitido después de mirar la tabla. Aquí no se calcula nada del
 * mundo; entran cinco números por candidato y sale una elección con su traza.
 *
 * ⚠ Este fichero se escribió ANTES de ejecutar la Fase A. Cambiarlo a la vista
 * de un resultado es exactamente lo que el pre-registro prohíbe: si una campaña
 * futura descubre que el criterio estaba mal planteado, se declara, se escribe
 * uno nuevo y se vuelve a ejecutar TODO —no se ajusta este.
 */

import { ConflictRuleId } from '@/core/dempster-shafer/conflict-rules';

/**
 * Criterio de selección, en orden lexicográfico estricto.
 *
 * Se aplica sin excepciones y sin desempates ad hoc: {@link select} lo ejecuta
 * y deja constancia de en qué paso se decidió. Si dos candidatos llegan al
 * final empatados, el paso 5 es total y siempre resuelve.
 */
export const CRITERION = [
  '1. Pasa el requisito innegociable (contraejemplo del ciclo, rama Dempster acotada, campaña de soundness).',
  '2. Cobertura existencial 100 % y cobertura de banda-95 ≥ 99,5 % global.',
  '3. Entre los que cumplen 1-2: mayor fracción de mundos limpios concordantes que alcanza Dempster (Nivel 1).',
  '4. Empate a menos de 1 punto porcentual en 3: menor anchura media de la banda-95 global.',
  '5. Empate también en 4: el más simple (orden C1 > C2 > C3).',
] as const;

/** Umbral del paso 2 sobre la cobertura de la banda de evidencia al 95 %. */
export const BAND_COVERAGE_FLOOR = 0.995;

/** Ventana de empate del paso 3, en fracción (1 punto porcentual). */
export const TIE_WINDOW = 0.01;

/**
 * Tolerancia del empate del paso 4, en mm/h.
 *
 * DECISIÓN DE DISEÑO no especificada por el criterio: «empate» en una anchura
 * media necesita una tolerancia numérica, o el paso 5 sería inalcanzable salvo
 * por coincidencia exacta de bits. 1e-9 mm/h está diez órdenes de magnitud por
 * debajo de cualquier diferencia con significado físico y por encima del ruido
 * de sumar 10.000 anchuras en coma flotante.
 */
export const WIDTH_TIE_EPSILON = 1e-9;

/**
 * Orden de simplicidad del paso 5. C1 < C2 < C3 es el del criterio; C0 va al
 * final porque «el más simple» no puede significar «el que conserva el defecto
 * que este experimento existe para corregir»: si C0 llegara al desempate final
 * es que ningún candidato mejora nada, y eso debe verse como tal.
 */
export const SIMPLICITY_RANK: Readonly<Record<ConflictRuleId, number>> = {
  C1: 0,
  C2: 1,
  C3: 2,
  C0: 3,
};

/** Las cifras del criterio, por candidato. */
export interface CandidateScore {
  rule: ConflictRuleId;
  gatePassed: boolean;
  existentialCoverage: number;
  bandCoverage: number;
  cleanDempsterFraction: number;
  meanBandWidth: number;
}

export interface SelectionReport {
  criterion: readonly string[];
  scores: CandidateScore[];
  disqualified: { rule: ConflictRuleId; step: number; reason: string }[];
  decidedAtStep: number;
  selected: ConflictRuleId;
  rationale: string;
}

/**
 * Aplica {@link CRITERION} y devuelve la decisión con su traza.
 *
 * @throws si ningún candidato supera los pasos 1-2. Es deliberado que sea un
 *         error y no una elección del «menos malo»: un criterio que se relaja
 *         cuando nadie lo cumple no es un criterio.
 */
export function select(scores: readonly CandidateScore[]): SelectionReport {
  const disqualified: SelectionReport['disqualified'] = [];

  // Paso 1
  const step1 = scores.filter((s) => {
    if (s.gatePassed) return true;
    disqualified.push({ rule: s.rule, step: 1, reason: 'falla el requisito innegociable' });
    return false;
  });

  // Paso 2
  const step2 = step1.filter((s) => {
    const reasons: string[] = [];
    if (s.existentialCoverage < 1) {
      reasons.push(`cobertura existencial ${(s.existentialCoverage * 100).toFixed(4)} % < 100 %`);
    }
    if (s.bandCoverage < BAND_COVERAGE_FLOOR) {
      reasons.push(
        `cobertura de banda-95 ${(s.bandCoverage * 100).toFixed(4)} % < ` +
          `${(BAND_COVERAGE_FLOOR * 100).toFixed(1)} %`
      );
    }
    if (reasons.length === 0) return true;
    disqualified.push({ rule: s.rule, step: 2, reason: reasons.join('; ') });
    return false;
  });

  if (step2.length === 0) {
    throw new Error(
      'ningún candidato supera los pasos 1-2 del criterio pre-registrado. El criterio NO se ' +
        'relaja a posteriori: hay que volver a la mesa de diseño con candidatos nuevos.'
    );
  }

  // Paso 3
  const bestDempster = Math.max(...step2.map((s) => s.cleanDempsterFraction));
  const step3 = step2.filter((s) => s.cleanDempsterFraction >= bestDempster - TIE_WINDOW);
  const strictWinner = step3.length === 1;

  // Paso 4
  const bestWidth = Math.min(...step3.map((s) => s.meanBandWidth));
  const step4 = step3.filter((s) => s.meanBandWidth <= bestWidth + WIDTH_TIE_EPSILON);

  // Paso 5
  const ordered = [...step4].sort((a, b) => SIMPLICITY_RANK[a.rule] - SIMPLICITY_RANK[b.rule]);
  const selected = ordered[0];

  const decidedAtStep = strictWinner ? 3 : step4.length === 1 ? 4 : 5;
  const rationale = strictWinner
    ? `${selected.rule} gana en el paso 3 sin empate: ` +
      `${(selected.cleanDempsterFraction * 100).toFixed(2)} % de mundos limpios llega a Dempster, ` +
      `más de 1 punto por encima del siguiente.`
    : step4.length === 1
      ? `empate en el paso 3 dentro de 1 punto porcentual entre ` +
        `{${step3.map((s) => s.rule).join(', ')}}; ${selected.rule} decide en el paso 4 con la ` +
        `menor anchura media de banda-95 (${selected.meanBandWidth.toFixed(4)} mm/h).`
      : `empate en los pasos 3 y 4 entre {${step4.map((s) => s.rule).join(', ')}}; decide el ` +
        `paso 5 (simplicidad, orden C1 > C2 > C3) → ${selected.rule}.`;

  return {
    criterion: CRITERION,
    scores: [...scores],
    disqualified,
    decidedAtStep,
    selected: selected.rule,
    rationale,
  };
}
