/**
 * AURA v2 — Figuras de las campañas de cobertura
 *
 * Tres figuras, todas funciones puras de los agregados del experimento y todas
 * SVG emitido desde código, sin dependencias (mismas reglas de determinismo que
 * `scripts/lib/svg.ts`: toda coordenada pasa por `n()`, tres decimales fijos).
 *
 *   f1 — cobertura por método y condición, con la línea del 95 % nominal.
 *   f2 — anchura media frente a cobertura, por método y condición.
 *   f3 — degradación de la cobertura al crecer la violación de H1.
 *
 * Se emiten como artefactos del runner (`ExperimentOutput.artifacts`), de modo
 * que entran en `out/experiments/<nombre>/figures/` y, en el perfil `verify`,
 * en `snapshots/`: una figura que cambia es un diff igual que un número que
 * cambia.
 */

import {
  Box,
  DEFAULT_BOX,
  PALETTE,
  legend,
  line,
  linearScale,
  n,
  plotHeight,
  plotWidth,
  polyline,
  rect,
  svgDocument,
  text,
} from '../../lib/svg';
import { MethodId, METHOD_IDS } from './methods';

/** Color por método. Contraste suficiente también impreso en gris. */
export const METHOD_COLORS: Readonly<Record<MethodId, string>> = {
  'aura-existencial': '#1d4ed8',
  'aura-banda-95': '#0ea5e9',
  'media-ponderada': '#f59e0b',
  'kalman-estatico': '#10b981',
};

/** Etiquetas cortas: las largas de `METHOD_LABELS` no caben en una leyenda. */
export const METHOD_SHORT: Readonly<Record<MethodId, string>> = {
  'aura-existencial': 'AURA existencial',
  'aura-banda-95': 'AURA banda 95 %',
  'media-ponderada': 'media ponderada',
  'kalman-estatico': 'Kalman estatico',
};

/** Nivel nominal de los baselines y de la banda de evidencia. */
export const NOMINAL = 0.95;

const methodLegend = (x: number, y: number): string =>
  legend(
    x,
    y,
    METHOD_IDS.map((m) => ({ label: METHOD_SHORT[m], fill: METHOD_COLORS[m] }))
  );

// ─────────────────────────────────────────────────────────────────────────────
// f1 — cobertura por método y condición
// ─────────────────────────────────────────────────────────────────────────────

export interface CoverageBar {
  coverage: number;
  wilsonLower: number;
  wilsonUpper: number;
  total: number;
}

export interface CoverageGroup {
  label: string;
  /** Un valor por método; los ausentes no se dibujan. */
  bars: Partial<Record<MethodId, CoverageBar>>;
}

/**
 * Barras de cobertura agrupadas por condición, con barra de error de Wilson.
 *
 * EJE Y RECORTADO POR ABAJO (`yMin`, por defecto 0,5). Con cobertura entre 0,9 y
 * 1 en casi todas las celdas, un eje de 0 a 1 aplasta todas las barras contra
 * el techo y la figura no dice nada. El recorte se rotula en el eje para que
 * nadie lo lea como una barra que arranca en cero.
 */
export function coverageBarsFigure(params: {
  title: string;
  subtitle: string;
  groups: readonly CoverageGroup[];
  yMin?: number;
  box?: Box;
}): string {
  const { title, subtitle, groups, yMin = 0.5, box = DEFAULT_BOX } = params;

  const w = plotWidth(box);
  const h = plotHeight(box);
  const base = box.top + h;
  const y = linearScale(yMin, 1, base, box.top);

  let body = '';

  // Rejilla horizontal cada 5 puntos de cobertura.
  for (let v = Math.ceil(yMin * 20) / 20; v <= 1.0001; v += 0.05) {
    const py = y(v);
    body += line(box.left, py, box.left + w, py, PALETTE.grid, 1);
    body += text(box.left - 9, py + 4, `${(v * 100).toFixed(0)} %`, {
      size: 11,
      anchor: 'end',
      fill: PALETTE.muted,
    });
  }

  const groupW = w / groups.length;
  const barW = (groupW * 0.72) / METHOD_IDS.length;

  for (let g = 0; g < groups.length; g++) {
    const gx = box.left + g * groupW + groupW * 0.14;
    if (g % 2 === 1) {
      body += rect(box.left + g * groupW, box.top, groupW, h, PALETTE.grid, { opacity: 0.35 });
    }

    for (let m = 0; m < METHOD_IDS.length; m++) {
      const id = METHOD_IDS[m];
      const bar = groups[g].bars[id];
      if (bar === undefined) continue;

      const bx = gx + m * barW;
      const top = y(Math.max(bar.coverage, yMin));
      body += rect(bx, top, barW * 0.86, base - top, METHOD_COLORS[id]);

      // Barra de error de Wilson, recortada al marco visible.
      const eLo = y(Math.max(bar.wilsonLower, yMin));
      const eHi = y(Math.min(bar.wilsonUpper, 1));
      const cx = bx + barW * 0.43;
      body += line(cx, eHi, cx, eLo, PALETTE.text, 1.1);
      body += line(cx - 3, eHi, cx + 3, eHi, PALETTE.text, 1.1);
      body += line(cx - 3, eLo, cx + 3, eLo, PALETTE.text, 1.1);

      // Cobertura por debajo del recorte: se marca con una punta de flecha
      // hacia abajo, para no confundirla con «llega justo al borde».
      if (bar.coverage < yMin) {
        body += text(cx, base - 4, '▼', { size: 10, anchor: 'middle', fill: PALETTE.critical });
      }
    }

    const g0 = box.left + g * groupW + groupW / 2;
    body += text(g0, base + 19, groups[g].label, { size: 11.5, anchor: 'middle' });
    const anyBar = METHOD_IDS.map((id) => groups[g].bars[id]).find((b) => b !== undefined);
    if (anyBar !== undefined) {
      body += text(g0, base + 33, `n = ${anyBar.total}`, {
        size: 9.5,
        anchor: 'middle',
        fill: PALETTE.muted,
      });
    }
  }

  // Nivel nominal del 95 %.
  const py95 = y(NOMINAL);
  body += line(box.left, py95, box.left + w, py95, PALETTE.critical, 1.6, '7 4');
  body += text(box.left + w - 4, py95 - 6, '95 % nominal', {
    size: 11,
    anchor: 'end',
    fill: PALETTE.critical,
    weight: 'bold',
  });

  body += line(box.left, box.top, box.left, base, PALETTE.axis, 1.2);
  body += line(box.left, base, box.left + w, base, PALETTE.axis, 1.2);

  body += text(box.left, 28, title, { size: 15, weight: 'bold' });
  body += text(box.left, 46, subtitle, { size: 11.5, fill: PALETTE.muted });
  body +=
    `  <text transform="translate(20 ${n(box.top + h / 2)}) rotate(-90)" ` +
    `font-family="Helvetica, Arial, sans-serif" font-size="12" text-anchor="middle" ` +
    `fill="${PALETTE.muted}">cobertura empírica (eje desde ${(yMin * 100).toFixed(0)} %)</text>\n`;

  body += methodLegend(box.left, box.height - 16);

  return svgDocument(
    box,
    title,
    `${subtitle}. Barras: cobertura empírica por método y condición, con intervalo de ` +
      `Wilson al 95 %. Línea discontinua: nivel nominal del 95 %. El eje vertical arranca ` +
      `en ${(yMin * 100).toFixed(0)} % para que las diferencias sean visibles.`,
    body
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// f2 — anchura frente a cobertura
// ─────────────────────────────────────────────────────────────────────────────

export interface WidthCoveragePoint {
  method: MethodId;
  /** Etiqueta corta del estrato (se dibuja junto al punto). */
  stratum: string;
  meanWidth: number;
  coverage: number;
}

/**
 * Dispersión anchura-cobertura: un punto por (método, condición).
 *
 * Es la figura que resume el compromiso completo. El eje X es LOGARÍTMICO
 * porque las anchuras van de ~4 mm/h (Kalman) a 500 mm/h (nivel existencial):
 * en escala lineal los tres métodos informativos se apilarían en la primera
 * columna de píxeles.
 *
 * Leerla: arriba-a-la-izquierda es mejor (cobertura alta con intervalo
 * estrecho); abajo-a-la-izquierda es el fallo caro (intervalo estrecho que no
 * contiene la verdad); arriba-a-la-derecha es la garantía pagada en anchura.
 */
export function widthCoverageFigure(params: {
  title: string;
  subtitle: string;
  points: readonly WidthCoveragePoint[];
  box?: Box;
}): string {
  const { title, subtitle, points, box = DEFAULT_BOX } = params;

  const w = plotWidth(box);
  const h = plotHeight(box);
  const base = box.top + h;

  const widths = points.map((p) => Math.max(p.meanWidth, 1e-3));
  const lo = Math.floor(Math.log10(Math.min(...widths)));
  const hi = Math.ceil(Math.log10(Math.max(...widths)));
  const x = linearScale(lo, hi, box.left, box.left + w);
  const px = (v: number) => x(Math.log10(Math.max(v, 1e-3)));

  const yLo = Math.min(0.5, Math.floor(Math.min(...points.map((p) => p.coverage)) * 10) / 10);
  const y = linearScale(yLo, 1, base, box.top);

  let body = '';

  for (let d = lo; d <= hi; d++) {
    const gx = px(Math.pow(10, d));
    body += line(gx, box.top, gx, base, PALETTE.grid, 1);
    body += text(gx, base + 19, `1e${d}`, { size: 11, anchor: 'middle', fill: PALETTE.muted });
  }
  for (let v = Math.ceil(yLo * 10) / 10; v <= 1.0001; v += 0.1) {
    const gy = y(v);
    body += line(box.left, gy, box.left + w, gy, PALETTE.grid, 1);
    body += text(box.left - 9, gy + 4, `${(v * 100).toFixed(0)} %`, {
      size: 11,
      anchor: 'end',
      fill: PALETTE.muted,
    });
  }

  const py95 = y(NOMINAL);
  body += line(box.left, py95, box.left + w, py95, PALETTE.critical, 1.4, '7 4');
  body += text(box.left + w - 4, py95 - 6, '95 % nominal', {
    size: 11,
    anchor: 'end',
    fill: PALETTE.critical,
    weight: 'bold',
  });

  for (const p of points) {
    const cx = px(p.meanWidth);
    const cy = y(p.coverage);
    body +=
      `  <circle cx="${n(cx)}" cy="${n(cy)}" r="5" fill="${METHOD_COLORS[p.method]}" ` +
      `fill-opacity="0.85" stroke="#ffffff" stroke-width="1"/>\n`;
    body += text(cx + 8, cy + 4, p.stratum, { size: 9.5, fill: PALETTE.muted });
  }

  body += line(box.left, box.top, box.left, base, PALETTE.axis, 1.2);
  body += line(box.left, base, box.left + w, base, PALETTE.axis, 1.2);

  body += text(box.left, 28, title, { size: 15, weight: 'bold' });
  body += text(box.left, 46, subtitle, { size: 11.5, fill: PALETTE.muted });
  body += text(box.left + w / 2, box.height - 46, 'anchura media del intervalo (mm/h, escala log)', {
    size: 12,
    anchor: 'middle',
    fill: PALETTE.muted,
  });
  body +=
    `  <text transform="translate(20 ${n(box.top + h / 2)}) rotate(-90)" ` +
    `font-family="Helvetica, Arial, sans-serif" font-size="12" text-anchor="middle" ` +
    `fill="${PALETTE.muted}">cobertura empírica</text>\n`;

  body += methodLegend(box.left, box.height - 16);

  return svgDocument(
    box,
    title,
    `${subtitle}. Un punto por método y condición: anchura media del intervalo en escala ` +
      `logarítmica frente a cobertura empírica. La etiqueta junto a cada punto es la condición.`,
    body
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// f3 — degradación bajo violación de H1
// ─────────────────────────────────────────────────────────────────────────────

export interface DegradationSeries {
  method: MethodId;
  /** Un punto por fracción de violación, en orden creciente. */
  points: readonly { fraction: number; coverage: number }[];
}

export function degradationFigure(params: {
  title: string;
  subtitle: string;
  series: readonly DegradationSeries[];
  box?: Box;
}): string {
  const { title, subtitle, series, box = DEFAULT_BOX } = params;

  const w = plotWidth(box);
  const h = plotHeight(box);
  const base = box.top + h;

  const fractions = series[0].points.map((p) => p.fraction);
  const fMax = Math.max(...fractions);
  const x = linearScale(0, fMax, box.left, box.left + w);
  const y = linearScale(0, 1, base, box.top);

  let body = '';

  for (let v = 0; v <= 1.0001; v += 0.1) {
    const gy = y(v);
    body += line(box.left, gy, box.left + w, gy, PALETTE.grid, 1);
    body += text(box.left - 9, gy + 4, `${(v * 100).toFixed(0)} %`, {
      size: 11,
      anchor: 'end',
      fill: PALETTE.muted,
    });
  }
  for (const f of fractions) {
    const gx = x(f);
    body += line(gx, box.top, gx, base, PALETTE.grid, 1);
    body += text(gx, base + 19, `${(f * 100).toFixed(0)}`, {
      size: 10.5,
      anchor: 'middle',
      fill: PALETTE.muted,
    });
  }

  // Predicción teórica: cobertura = 1 − fracción, el techo de cualquier método
  // que solo pueda acertar por casualidad dentro de los mundos violados.
  body += polyline(
    fractions.map((f) => [x(f), y(1 - f)] as const),
    PALETTE.muted,
    1.4,
    '5 4'
  );
  body += text(x(fMax) - 4, y(1 - fMax) - 8, 'predicción 1 − fracción', {
    size: 10.5,
    anchor: 'end',
    fill: PALETTE.muted,
  });

  const py95 = y(NOMINAL);
  body += line(box.left, py95, box.left + w, py95, PALETTE.critical, 1.4, '7 4');

  for (const s of series) {
    body += polyline(
      s.points.map((p) => [x(p.fraction), y(p.coverage)] as const),
      METHOD_COLORS[s.method],
      2
    );
    for (const p of s.points) {
      body +=
        `  <circle cx="${n(x(p.fraction))}" cy="${n(y(p.coverage))}" r="3.2" ` +
        `fill="${METHOD_COLORS[s.method]}"/>\n`;
    }
  }

  body += line(box.left, box.top, box.left, base, PALETTE.axis, 1.2);
  body += line(box.left, base, box.left + w, base, PALETTE.axis, 1.2);

  body += text(box.left, 28, title, { size: 15, weight: 'bold' });
  body += text(box.left, 46, subtitle, { size: 11.5, fill: PALETTE.muted });
  body += text(
    box.left + w / 2,
    box.height - 46,
    'fracción de mundos con violación de H1 (todas las fuentes fallan), %',
    { size: 12, anchor: 'middle', fill: PALETTE.muted }
  );
  body +=
    `  <text transform="translate(20 ${n(box.top + h / 2)}) rotate(-90)" ` +
    `font-family="Helvetica, Arial, sans-serif" font-size="12" text-anchor="middle" ` +
    `fill="${PALETTE.muted}">cobertura empírica</text>\n`;

  body += methodLegend(box.left, box.height - 16);

  return svgDocument(
    box,
    title,
    `${subtitle}. Cobertura empírica de cada método frente a la fracción de mundos en que ` +
      `TODAS las fuentes fallan simultáneamente. La diagonal discontinua es la predicción ` +
      `teórica 1 − fracción; la horizontal, el 95 % nominal.`,
    body
  );
}
