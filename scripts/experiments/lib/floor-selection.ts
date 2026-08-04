/**
 * AURA v2 — El criterio de selección PRE-REGISTRADO de la MEDIDA de conflicto
 *
 * Hermano de `./selection.ts`, que hizo lo propio con la REGLA (`docs/ERRATA.md`
 * §9, experimento `exp:conflict-rule`). Mismo principio y mismo motivo: el paso
 * de «cifras» a «decisión» tiene que ser una función auditable y probada por
 * separado, no un juicio emitido después de mirar la tabla. Aquí no se calcula
 * nada del mundo; entran seis números por candidato y sale una elección con su
 * traza.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ ADVERTENCIA DE HONESTIDAD QUE RIGE TODO EL DISEÑO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * **Los resultados del hindcast sobre datos reales YA SON CONOCIDOS** cuando se
 * escribe esto: `npm run exp:hindcast` está ejecutado, commiteado y descrito en
 * `docs/ERRATA.md` §9, y es precisamente de ahí de donde sale el problema que
 * esta iteración corrige. En consecuencia:
 *
 *  · la selección se hace **EXCLUSIVAMENTE sobre mundos sintéticos con ground
 *    truth**, donde «acertar» tiene una respuesta que no depende de nadie;
 *  · el bloque «σ del hindcast» de la Fase A usa las σ del hindcast (5,0 / 1,8 /
 *    10,0 mm/h) pero mundos sintéticos NUEVOS, no los datos reales;
 *  · el hindcast se re-ejecuta DESPUÉS y **solo como descripción**. No es una
 *    validación ciega y en ningún sitio se redacta como tal.
 *
 * ⚠ Este fichero se escribió ANTES de ejecutar la Fase A. Cambiarlo a la vista
 * de un resultado es exactamente lo que el pre-registro prohíbe: si una campaña
 * futura descubre que el criterio estaba mal planteado, se declara, se escribe
 * uno nuevo y se vuelve a ejecutar TODO —no se ajusta este.
 */

import { ConflictMeasureId } from '@/core/dempster-shafer/conflict-measures';

/**
 * Criterio de selección, en orden lexicográfico estricto y sin excepciones.
 *
 * {@link selectMeasure} lo ejecuta y deja constancia de en qué paso se decidió.
 * El paso 7 es total y siempre resuelve.
 */
export const FLOOR_CRITERION = [
  '1. Pasa el requisito innegociable (ciclo → envolvente por la guardia bajo los tres; rama ' +
    'Dempster nunca con la medida > κ₂ ni con K_global crudo ≥ κ_deg; campaña world-soundness ' +
    'completa; cobertura existencial 100 % en calibración).',
  '2. Cobertura de banda-95 ≥ 99,5 % global en el bloque de calibración.',
  '3. Métrica virga «ni P* ni γ·P*» de la banda ≤ 0,10 %.',
  '4. Bloque «σ del hindcast» (mundos sintéticos, dispersión ≤ 0,5 mm/h): mayor fracción que ' +
    'alcanza Dempster.',
  '5. Empate a menos de 1 punto porcentual en 4: mayor fracción de mundos limpios que alcanza ' +
    'Dempster en la configuración sintética estándar de coverage.ts.',
  '6. Empate también en 5: menor anchura media de la banda-95.',
  '7. Empate total: el más simple, orden D1 > D2.',
] as const;

/** Umbral del paso 2 sobre la cobertura de la banda de evidencia al 95 %. */
export const FLOOR_BAND_COVERAGE_FLOOR = 0.995;

/**
 * Techo del paso 3 sobre la métrica virga «ni P\* ni γ·P\*».
 *
 * 0,10 % = 1 punto por mil. La propiedad estrella del sistema medida en la
 * campaña anterior valía 0,04 % con la regla C1 y 0,02 % con C0; el techo deja
 * margen para la fluctuación de muestreo de 5.000 mundos (un solo mundo son
 * 0,02 %) sin admitir una degradación real de la propiedad.
 */
export const VIRGA_NEITHER_CEILING = 0.001;

/** Ventana de empate de los pasos 4 y 5, en fracción (1 punto porcentual). */
export const FLOOR_TIE_WINDOW = 0.01;

/**
 * Tolerancia del empate del paso 6, en mm/h. Mismo valor y mismo motivo que
 * `WIDTH_TIE_EPSILON` de `./selection.ts`: «empate» en una anchura media
 * necesita una tolerancia numérica, o el paso 7 sería inalcanzable salvo por
 * coincidencia exacta de bits.
 */
export const FLOOR_WIDTH_TIE_EPSILON = 1e-9;

/**
 * Orden de simplicidad del paso 7. D1 < D2 es el del criterio; D0 va al final
 * porque «el más simple» no puede significar «el que conserva el defecto que
 * este experimento existe para corregir»: si D0 llegara al desempate final es
 * que ninguna medida mejora nada, y eso debe verse como tal.
 */
export const MEASURE_SIMPLICITY_RANK: Readonly<Record<ConflictMeasureId, number>> = {
  D1: 0,
  D2: 1,
  D0: 2,
};

/** Las cifras del criterio, por candidato. */
export interface MeasureScore {
  measure: ConflictMeasureId;
  gatePassed: boolean;
  /** Paso 1 — debe ser 1 exactamente. */
  existentialCoverage: number;
  /** Paso 2. */
  bandCoverage: number;
  /** Paso 3 — fracción, no porcentaje. */
  virgaNeitherFraction: number;
  /** Paso 4 — bloque «σ del hindcast». */
  hindcastSigmaDempsterFraction: number;
  /** Paso 5 — configuración estándar de `coverage.ts`, condición `clean`. */
  cleanDempsterFraction: number;
  /** Paso 6. */
  meanBandWidth: number;
}

export interface MeasureSelectionReport {
  criterion: readonly string[];
  scores: MeasureScore[];
  disqualified: { measure: ConflictMeasureId; step: number; reason: string }[];
  /** Supervivientes tras cada paso, para poder leer la traza sin recomputar. */
  survivors: { step: number; measures: ConflictMeasureId[] }[];
  decidedAtStep: number;
  selected: ConflictMeasureId;
  rationale: string;
}

/**
 * Aplica {@link FLOOR_CRITERION} y devuelve la decisión con su traza.
 *
 * @throws si ningún candidato supera los pasos 1-3. Es deliberado que sea un
 *         error y no una elección del «menos malo»: un criterio que se relaja
 *         cuando nadie lo cumple no es un criterio. Nótese que D0 —la medida
 *         vigente— compite en igualdad de condiciones, de modo que el caso
 *         «ninguna medida nueva mejora nada» se resuelve seleccionando D0 en el
 *         paso 7, no lanzando.
 */
export function selectMeasure(scores: readonly MeasureScore[]): MeasureSelectionReport {
  const disqualified: MeasureSelectionReport['disqualified'] = [];
  const survivors: MeasureSelectionReport['survivors'] = [];
  const record = (step: number, list: readonly MeasureScore[]): void => {
    survivors.push({ step, measures: list.map((s) => s.measure) });
  };

  // ── Paso 1 · requisito innegociable ────────────────────────────────────────
  const step1 = scores.filter((s) => {
    const reasons: string[] = [];
    if (!s.gatePassed) reasons.push('falla el requisito innegociable');
    if (s.existentialCoverage < 1) {
      reasons.push(`cobertura existencial ${(s.existentialCoverage * 100).toFixed(4)} % < 100 %`);
    }
    if (reasons.length === 0) return true;
    disqualified.push({ measure: s.measure, step: 1, reason: reasons.join('; ') });
    return false;
  });
  record(1, step1);

  // ── Paso 2 · cobertura de la banda-95 ──────────────────────────────────────
  const step2 = step1.filter((s) => {
    if (s.bandCoverage >= FLOOR_BAND_COVERAGE_FLOOR) return true;
    disqualified.push({
      measure: s.measure,
      step: 2,
      reason:
        `cobertura de banda-95 ${(s.bandCoverage * 100).toFixed(4)} % < ` +
        `${(FLOOR_BAND_COVERAGE_FLOOR * 100).toFixed(1)} %`,
    });
    return false;
  });
  record(2, step2);

  // ── Paso 3 · la propiedad estrella no puede empeorar ───────────────────────
  const step3 = step2.filter((s) => {
    if (s.virgaNeitherFraction <= VIRGA_NEITHER_CEILING) return true;
    disqualified.push({
      measure: s.measure,
      step: 3,
      reason:
        `métrica virga «ni P* ni γ·P*» ${(s.virgaNeitherFraction * 100).toFixed(4)} % > ` +
        `${(VIRGA_NEITHER_CEILING * 100).toFixed(2)} %`,
    });
    return false;
  });
  record(3, step3);

  if (step3.length === 0) {
    throw new Error(
      'ninguna medida supera los pasos 1-3 del criterio pre-registrado. El criterio NO se ' +
        'relaja a posteriori: hay que volver a la mesa de diseño con candidatos nuevos.'
    );
  }

  // ── Paso 4 · el suelo sintético, que es el objeto del experimento ──────────
  const bestHindcast = Math.max(...step3.map((s) => s.hindcastSigmaDempsterFraction));
  const step4 = step3.filter(
    (s) => s.hindcastSigmaDempsterFraction >= bestHindcast - FLOOR_TIE_WINDOW
  );
  record(4, step4);
  const decidedAt4 = step4.length === 1;

  // ── Paso 5 · informatividad en la configuración estándar ───────────────────
  const bestClean = Math.max(...step4.map((s) => s.cleanDempsterFraction));
  const step5 = step4.filter((s) => s.cleanDempsterFraction >= bestClean - FLOOR_TIE_WINDOW);
  record(5, step5);
  const decidedAt5 = !decidedAt4 && step5.length === 1;

  // ── Paso 6 · anchura ───────────────────────────────────────────────────────
  const bestWidth = Math.min(...step5.map((s) => s.meanBandWidth));
  const step6 = step5.filter((s) => s.meanBandWidth <= bestWidth + FLOOR_WIDTH_TIE_EPSILON);
  record(6, step6);
  const decidedAt6 = !decidedAt4 && !decidedAt5 && step6.length === 1;

  // ── Paso 7 · simplicidad ───────────────────────────────────────────────────
  const ordered = [...step6].sort(
    (a, b) => MEASURE_SIMPLICITY_RANK[a.measure] - MEASURE_SIMPLICITY_RANK[b.measure]
  );
  const selected = ordered[0];
  record(7, [selected]);

  const decidedAtStep = decidedAt4 ? 4 : decidedAt5 ? 5 : decidedAt6 ? 6 : 7;
  const pct = (x: number) => `${(x * 100).toFixed(2)} %`;

  const rationale = decidedAt4
    ? `${selected.measure} gana en el paso 4 sin empate: ${pct(selected.hindcastSigmaDempsterFraction)} ` +
      `de los mundos con las σ del hindcast y dispersión ≤ 0,5 mm/h alcanza Dempster, más de 1 ` +
      `punto por encima del siguiente.`
    : decidedAt5
      ? `empate en el paso 4 dentro de 1 punto entre {${step4.map((s) => s.measure).join(', ')}}; ` +
        `${selected.measure} decide en el paso 5 con ${pct(selected.cleanDempsterFraction)} de ` +
        `mundos limpios en Dempster.`
      : decidedAt6
        ? `empate en los pasos 4 y 5 entre {${step5.map((s) => s.measure).join(', ')}}; ` +
          `${selected.measure} decide en el paso 6 con la menor anchura media de banda-95 ` +
          `(${selected.meanBandWidth.toFixed(4)} mm/h).`
        : `empate en los pasos 4, 5 y 6 entre {${step6.map((s) => s.measure).join(', ')}}; decide ` +
          `el paso 7 (simplicidad, orden D1 > D2) → ${selected.measure}.`;

  return {
    criterion: FLOOR_CRITERION,
    scores: [...scores],
    disqualified,
    survivors,
    decidedAtStep,
    selected: selected.measure,
    rationale,
  };
}
