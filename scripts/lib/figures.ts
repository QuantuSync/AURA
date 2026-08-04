/**
 * AURA v2 — Las dos figuras del pipeline reproducible
 *
 *  1. {@link hEvolutionFigure} — evolución de h(t) con los bounds del hull.
 *  2. {@link credalMassFigure} — masa credal por hipótesis, antes y después de
 *     la fusión.
 *
 * Ambas son funciones puras de los resultados del pipeline: mismo resultado,
 * mismo SVG, byte a byte.
 */

import { CredalIntervalSet } from '@/core/credal-propagation/types';
import { FrameOfDiscernment, BPA } from '@/core/dempster-shafer/types';
import {
  Box,
  DEFAULT_BOX,
  PALETTE,
  linearScale,
  legend,
  line,
  n,
  plotHeight,
  plotWidth,
  polygon,
  polyline,
  rect,
  svgDocument,
  symlog,
  text,
} from './svg';

// ─────────────────────────────────────────────────────────────────────────────
// Figura 1 — evolución de h(t)
// ─────────────────────────────────────────────────────────────────────────────

export interface HorizonSample {
  /** t (h). */
  t: number;
  /** Hull COMPLETO del conjunto credal propagado en t. */
  hull: { lower: number; upper: number };
  /**
   * Hull de los elementos focales que acumulan {@link CORE_MASS} de la masa,
   * tomados de mayor a menor masa: la banda que la evidencia respalda.
   */
  core: { lower: number; upper: number };
}

/**
 * Fracción de masa que define la «banda de evidencia».
 *
 * 0,99 y no 1 porque el punto entero de docs/ERRATA.md §8 es que el último 1 %
 * —en la demo, 1,5e-4 de masa sobre Θ— es lo que estira el hull de 22 mm a
 * 992 mm. Separar las dos bandas es lo que hace VISIBLE que el nivel existencial
 * está dominado por una masa infinitesimal.
 */
export const CORE_MASS = 0.99;

/** Hull de los focales de mayor masa hasta acumular {@link CORE_MASS}. */
export function coreHull(set: CredalIntervalSet, fraction = CORE_MASS): { lower: number; upper: number } {
  const sorted = [...set.elements].sort(
    // Desempate por intervalo: dos focales de igual masa deben ordenarse
    // siempre igual, o la figura dejaría de ser reproducible.
    (a, b) =>
      b.mass - a.mass || a.interval.lower - b.interval.lower || a.interval.upper - b.interval.upper
  );

  let acc = 0;
  let lower = Infinity;
  let upper = -Infinity;
  for (const fe of sorted) {
    lower = Math.min(lower, fe.interval.lower);
    upper = Math.max(upper, fe.interval.upper);
    acc += fe.mass;
    if (acc >= fraction) break;
  }
  return { lower, upper };
}

/** Ticks de la escala symlog que caen dentro del rango dado. */
function symlogTicks(lo: number, hi: number): number[] {
  const candidates = [
    -1000, -500, -100, -50, -25, -10, -5, 0, 5, 10, 25, 50, 100, 250, 500, 1000, 2500,
  ];
  return candidates.filter((v) => v >= lo && v <= hi);
}

export function hEvolutionFigure(params: {
  scenario: string;
  samples: readonly HorizonSample[];
  hCrit: number;
  unit: string;
  box?: Box;
}): string {
  const { scenario, samples, hCrit, unit, box = DEFAULT_BOX } = params;

  const w = plotWidth(box);
  const h = plotHeight(box);

  const tMin = samples[0].t;
  const tMax = samples[samples.length - 1].t;

  const yLo = Math.min(...samples.map((s) => s.hull.lower), 0);
  const yHi = Math.max(...samples.map((s) => s.hull.upper), hCrit);
  // Margen del 6 % del rango YA transformado: en symlog, ampliar el dominio
  // antes de transformar deformaría el margen según la magnitud.
  const sLo = symlog(yLo);
  const sHi = symlog(yHi);
  const pad = (sHi - sLo) * 0.06 || 1;

  const x = linearScale(tMin, tMax, box.left, box.left + w);
  const ys = linearScale(sLo - pad, sHi + pad, box.top + h, box.top);
  const y = (v: number) => ys(symlog(v));

  let body = '';

  // Rejilla y eje Y
  for (const tick of symlogTicks(yLo, yHi)) {
    const py = y(tick);
    body += line(box.left, py, box.left + w, py, PALETTE.grid, 1);
    body += text(box.left - 9, py + 4, String(tick), {
      size: 11,
      anchor: 'end',
      fill: PALETTE.muted,
    });
  }

  // Rejilla y eje X
  const xTicks = [0, 0.5, 1, 1.5, 2].filter((t) => t >= tMin && t <= tMax);
  for (const t of xTicks) {
    const px = x(t);
    body += line(px, box.top, px, box.top + h, PALETTE.grid, 1);
    body += text(px, box.top + h + 19, `${t} h`, { size: 11, anchor: 'middle', fill: PALETTE.muted });
  }

  // Banda del hull completo (nivel existencial)
  const hullBand = [
    ...samples.map((s) => [x(s.t), y(s.hull.upper)] as const),
    ...[...samples].reverse().map((s) => [x(s.t), y(s.hull.lower)] as const),
  ];
  body += polygon(hullBand, PALETTE.hull, 0.75);
  body += polyline(
    samples.map((s) => [x(s.t), y(s.hull.upper)] as const),
    PALETTE.hullStroke,
    1.4
  );
  body += polyline(
    samples.map((s) => [x(s.t), y(s.hull.lower)] as const),
    PALETTE.hullStroke,
    1.4
  );

  // Banda de evidencia (≥ 99 % de la masa credal)
  const coreBand = [
    ...samples.map((s) => [x(s.t), y(s.core.upper)] as const),
    ...[...samples].reverse().map((s) => [x(s.t), y(s.core.lower)] as const),
  ];
  body += polygon(coreBand, PALETTE.core, 0.32);
  body += polyline(
    samples.map((s) => [x(s.t), y(s.core.upper)] as const),
    PALETTE.core,
    1.8
  );
  body += polyline(
    samples.map((s) => [x(s.t), y(s.core.lower)] as const),
    PALETTE.core,
    1.8
  );

  // h_crít
  body += line(box.left, y(hCrit), box.left + w, y(hCrit), PALETTE.critical, 1.6, '7 4');
  body += text(box.left + w - 4, y(hCrit) - 7, `h_crít = ${hCrit} ${unit}`, {
    size: 11,
    anchor: 'end',
    fill: PALETTE.critical,
    weight: 'bold',
  });

  // Ejes
  body += line(box.left, box.top, box.left, box.top + h, PALETTE.axis, 1.2);
  body += line(box.left, box.top + h, box.left + w, box.top + h, PALETTE.axis, 1.2);

  // Rótulos
  body += text(box.left, 28, `Evolución de h(t) — escenario ${scenario}`, {
    size: 15,
    weight: 'bold',
  });
  body += text(box.left, 46, 'Bounds del hull del conjunto credal propagado (Ec. 34, ε_h incluido)', {
    size: 11.5,
    fill: PALETTE.muted,
  });
  body += text(box.left + w / 2, box.height - 44, 'horizonte t (h)', {
    size: 12,
    anchor: 'middle',
    fill: PALETTE.muted,
  });
  body +=
    `  <text transform="translate(20 ${n(box.top + h / 2)}) rotate(-90)" ` +
    `font-family="Helvetica, Arial, sans-serif" font-size="12" text-anchor="middle" ` +
    `fill="${PALETTE.muted}">h (${unit}) — symlog, lineal en |h| ≤ 10</text>\n`;

  body += legend(box.left, box.height - 18, [
    { label: 'hull completo (nivel existencial)', fill: PALETTE.hull, opacity: 0.75, stroke: PALETTE.hullStroke },
    { label: `banda de evidencia (≥ ${(CORE_MASS * 100).toFixed(0)} % de la masa)`, fill: PALETTE.core, opacity: 0.32 },
    { label: 'h_crít', fill: PALETTE.critical },
  ]);

  return svgDocument(
    box,
    `Evolución de h(t) — ${scenario}`,
    `Bounds inferior y superior del hull del conjunto credal propagado sobre el nodo h del DAG ` +
      `de la demo, para t entre ${tMin} y ${tMax} h, contrastados con la banda que concentra al ` +
      `menos el ${(CORE_MASS * 100).toFixed(0)} % de la masa credal y con el umbral h_crít = ${hCrit} ${unit}.`,
    body
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Figura 2 — masa credal por hipótesis, antes y después de la fusión
// ─────────────────────────────────────────────────────────────────────────────

/** Suelo de la escala logarítmica de masa. Por debajo, la barra no se dibuja. */
export const MASS_FLOOR = 1e-6;

/** m({θ_j}) por hipótesis, más m(Θ) al final. */
export function singletonMasses(bpa: BPA): number[] {
  const k = bpa.frame.hypotheses.length;
  const out = new Array(k + 1).fill(0);
  for (const fe of bpa.focalElements) {
    if (fe.indices.length === 1) out[fe.indices[0]] += fe.mass;
    else if (fe.indices.length === k) out[k] += fe.mass;
  }
  return out;
}

export function credalMassFigure(params: {
  scenario: string;
  frame: FrameOfDiscernment;
  sourceBpas: readonly BPA[];
  fused: BPA;
  method: string;
  box?: Box;
}): string {
  const { scenario, frame, sourceBpas, fused, method, box = DEFAULT_BOX } = params;

  const w = plotWidth(box);
  const h = plotHeight(box);

  const labels = [...frame.hypotheses.map((hy) => hy.label), 'Θ'];
  const series = [
    ...sourceBpas.map((b, i) => ({
      label: b.sourceId,
      color: PALETTE.sources[i % PALETTE.sources.length],
      values: singletonMasses(b),
    })),
    { label: `fusionada (${method})`, color: PALETTE.fused, values: singletonMasses(fused) },
  ];

  // Eje log10 de masa: de MASS_FLOOR a 1.
  const decades = Math.round(Math.log10(1 / MASS_FLOOR));
  const yv = linearScale(Math.log10(MASS_FLOOR), 0, box.top + h, box.top);
  const y = (m: number) => yv(Math.log10(Math.max(m, MASS_FLOOR)));

  let body = '';

  for (let d = 0; d <= decades; d++) {
    const value = Math.pow(10, -d);
    const py = y(value);
    body += line(box.left, py, box.left + w, py, PALETTE.grid, 1);
    body += text(box.left - 9, py + 4, d === 0 ? '1' : `1e-${d}`, {
      size: 11,
      anchor: 'end',
      fill: PALETTE.muted,
    });
  }

  const groupW = w / labels.length;
  const barW = (groupW * 0.74) / series.length;
  const base = box.top + h;

  for (let g = 0; g < labels.length; g++) {
    const gx = box.left + g * groupW + groupW * 0.13;

    // Franja de fondo alterna: separa los grupos sin añadir más líneas.
    if (g % 2 === 1) {
      body += rect(box.left + g * groupW, box.top, groupW, h, PALETTE.grid, { opacity: 0.35 });
    }

    for (let s = 0; s < series.length; s++) {
      const m = series[s].values[g];
      const bx = gx + s * barW;
      if (m > MASS_FLOOR) {
        body += rect(bx, y(m), barW * 0.9, base - y(m), series[s].color);
      } else {
        // Masa por debajo del suelo: marca en la línea base, para distinguir
        // «cero» de «no representado».
        body += rect(bx, base - 1.5, barW * 0.9, 1.5, PALETTE.muted, { opacity: 0.5 });
      }
    }

    const hy = frame.hypotheses[g];
    body += text(box.left + g * groupW + groupW / 2, base + 19, labels[g], {
      size: 11.5,
      anchor: 'middle',
    });
    body += text(
      box.left + g * groupW + groupW / 2,
      base + 33,
      hy ? `[${hy.lower}, ${hy.upper})` : `[${frame.hypotheses[0].lower}, ${frame.domainBound}]`,
      { size: 9.5, anchor: 'middle', fill: PALETTE.muted }
    );
  }

  body += line(box.left, box.top, box.left, base, PALETTE.axis, 1.2);
  body += line(box.left, base, box.left + w, base, PALETTE.axis, 1.2);

  body += text(box.left, 28, `Masa credal por hipótesis — escenario ${scenario}`, {
    size: 15,
    weight: 'bold',
  });
  body += text(
    box.left,
    46,
    `Antes (una BPA por fuente, Def. 3.4) y después de la fusión (Def. 3.6, método ${method})`,
    { size: 11.5, fill: PALETTE.muted }
  );
  body +=
    `  <text transform="translate(20 ${n(box.top + h / 2)}) rotate(-90)" ` +
    `font-family="Helvetica, Arial, sans-serif" font-size="12" text-anchor="middle" ` +
    `fill="${PALETTE.muted}">m(A) — escala log</text>\n`;

  body += legend(
    box.left,
    box.height - 14,
    series.map((s) => ({ label: s.label, fill: s.color }))
  );

  return svgDocument(
    box,
    `Masa credal por hipótesis — ${scenario}`,
    `Masa m({θ_j}) que cada fuente asigna a cada hipótesis del marco de ` +
      `${frame.variable}, y masa de la BPA fusionada, incluida la masa sobre Θ que la ` +
      `Def. 3.4 reserva como válvula de seguridad δ_i. Escala logarítmica desde ${MASS_FLOOR}.`,
    body
  );
}
