/**
 * AURA v2 — Las cuatro figuras del hindcast
 *
 *   f1 — precipitación de las tres fuentes, con la banda credal 95 % y el hull.
 *   f2 — K_máx y K_global en el tiempo, con κ₁, κ₂ y κ_deg.
 *   f3 — plUpper en el tiempo (escala log), con los niveles de decisión.
 *   f4 — anchura de la banda AURA frente a la de los dos baselines.
 *
 * Mismas reglas de determinismo que el resto de figuras del repositorio: SVG
 * emitido desde código puro, sin dependencias, y TODA coordenada por `n()`
 * (tres decimales fijos). Ver `scripts/lib/svg.ts`.
 *
 * EL CAVEAT DEL EVENTO VIAJA EN LA FIGURA. Cuando el evento tiene advertencia
 * —E2, cuya precipitación fue nieve— se dibuja como una franja de aviso bajo el
 * subtítulo Y se repite íntegra en el `<desc>` del SVG. Una figura se separa de
 * su README en cuanto alguien la copia en una presentación; si la advertencia
 * solo estuviera en el texto que la rodea, la figura viajaría sin ella.
 */

import {
  Box,
  DEFAULT_BOX,
  PALETTE,
  esc,
  legend,
  line,
  linearScale,
  n,
  plotHeight,
  plotWidth,
  polygon,
  polyline,
  rect,
  svgDocument,
  symlog,
  text,
} from '../../lib/svg';

/** Caja más ancha que la del resto: estas figuras son series de 96-168 puntos. */
export const HINDCAST_BOX: Box = {
  width: 1000,
  height: 560,
  left: 78,
  right: 26,
  // 122 y no 62: encima del área de dibujo caben el título, el subtítulo y la
  // franja del caveat a tres líneas. Es holgura fija para las dos variantes —con
  // y sin advertencia— porque un `top` que dependiera del evento haría que las
  // figuras de E1 y E2 no fueran comparables a simple vista.
  top: 122,
  bottom: 104,
};

/** Color por fuente, en el orden de `HINDCAST_SOURCES`. */
export const SOURCE_COLORS = ['#0ea5e9', '#f59e0b', '#10b981'] as const;

/** Color de los tres métodos comparados en f4. */
export const WIDTH_COLORS = {
  band: '#1d4ed8',
  weightedMean: '#f59e0b',
  kalman: '#10b981',
} as const;

/** Punto de la serie que consumen las cuatro figuras. */
export interface HindcastPoint {
  /** `YYYY-MM-DDTHH:00Z`. */
  iso: string;
  precipitation: readonly number[];
  band: { lower: number; upper: number };
  hull: { lower: number; upper: number };
  maxConflict: number;
  globalConflict: number;
  plUpper: number;
  widths: { band: number; weightedMean: number; kalman: number };
}

export interface FigureContext {
  title: string;
  subtitle: string;
  /**
   * Titular de la advertencia del evento, o `null`. Es lo que se dibuja VISIBLE
   * en la franja roja. Ver la nota del encabezado del módulo.
   */
  caveatHeadline: string | null;
  /**
   * Advertencia ÍNTEGRA del evento, o `null`. Va al `<desc>` del SVG, que es lo
   * que sobrevive a que la figura se copie fuera de su README.
   */
  caveat: string | null;
  sourceLabels: readonly string[];
  points: readonly HindcastPoint[];
}

/** `2024-10-29T14:00Z` → `29/10 14h`. Etiqueta compacta de eje. */
const tickLabel = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 13)}h`;

/** Caracteres por línea y máximo de líneas de la franja del caveat. */
const CAVEAT_CHARS_PER_LINE = 118;
const CAVEAT_MAX_LINES = 3;

/**
 * Corta un texto en líneas de a lo sumo `perLine` caracteres, sin partir
 * palabras. SVG no reajusta texto: un `<text>` es una sola línea por larga que
 * sea, de modo que sin esto la franja se saldría del lienzo.
 *
 * @throws si el texto no cabe en `maxLines`. Truncar en silencio una advertencia
 *         obligatoria es exactamente el fallo que la advertencia previene: es el
 *         `caveatHeadline` del evento el que debe acortarse, no la figura la que
 *         debe recortarlo. Por eso lanza en vez de poner una elipsis.
 */
export function wrapCaveat(
  s: string,
  perLine = CAVEAT_CHARS_PER_LINE,
  maxLines = CAVEAT_MAX_LINES
): string[] {
  const lines: string[] = [];
  let current = '';

  for (const word of s.split(/\s+/).filter((x) => x.length > 0)) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (candidate.length <= perLine) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current !== '') lines.push(current);

  if (lines.length > maxLines) {
    throw new Error(
      `el titular del caveat no cabe en ${maxLines} líneas de ${perLine} caracteres ` +
        `(hacen falta ${lines.length}). Acorta \`caveatHeadline\` del evento en ` +
        `scripts/lib/hindcast-events.ts; el texto completo sigue viajando en el <desc> ` +
        `del SVG. Truncarlo aquí dejaría una advertencia obligatoria a medias.`
    );
  }
  return lines;
}

/** Cabecera común: título, subtítulo y —si lo hay— la franja del caveat. */
function header(box: Box, ctx: FigureContext): string {
  let body = text(box.left, 28, ctx.title, { size: 15, weight: 'bold' });
  body += text(box.left, 46, ctx.subtitle, { size: 11.5, fill: PALETTE.muted });

  if (ctx.caveatHeadline !== null) {
    const lines = wrapCaveat(ctx.caveatHeadline);
    body += rect(box.left, 58, plotWidth(box), 10 + lines.length * 12, '#fef2f2', {
      stroke: PALETTE.critical,
    });
    for (let i = 0; i < lines.length; i++) {
      body += text(box.left + 7, 72 + i * 12, lines[i], {
        size: 9.5,
        fill: PALETTE.critical,
        weight: i === 0 ? 'bold' : 'normal',
      });
    }
  }
  return body;
}

/** Eje X temporal: rejilla y etiquetas cada `step` horas. */
function timeAxis(box: Box, ctx: FigureContext, x: (i: number) => number): string {
  const nPts = ctx.points.length;
  const step = Math.max(1, Math.round(nPts / 12));
  const base = box.top + plotHeight(box);
  let body = '';
  for (let i = 0; i < nPts; i += step) {
    const px = x(i);
    body += line(px, box.top, px, base, PALETTE.grid, 1);
    body += text(px, base + 19, tickLabel(ctx.points[i].iso), {
      size: 9.5,
      anchor: 'middle',
      fill: PALETTE.muted,
    });
  }
  return body;
}

/** Etiqueta rotada del eje Y. */
const yLabel = (box: Box, label: string): string =>
  `  <text transform="translate(20 ${n(box.top + plotHeight(box) / 2)}) rotate(-90)" ` +
  `font-family="Helvetica, Arial, sans-serif" font-size="12" text-anchor="middle" ` +
  `fill="${PALETTE.muted}">${esc(label)}</text>\n`;

/** Descripción accesible: el caveat va SIEMPRE dentro, no solo en la figura. */
const describe = (ctx: FigureContext, what: string): string =>
  `${ctx.subtitle}. ${what}` +
  (ctx.caveat === null ? '' : ` ${ctx.caveat}`) +
  ' Ejercicio ILUSTRATIVO del comportamiento del pipeline sobre datos reales, no una ' +
  'validación operativa: no hay ground truth y el DAG es el de juguete de la demo.';

// ─────────────────────────────────────────────────────────────────────────────
// f1 — precipitación por fuente, banda credal 95 % y hull
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Escala symlog en Y (lineal hasta 10 mm/h, log por encima).
 *
 * Es obligatoria aquí: el hull del conjunto credal llega a los 500 mm/h del
 * `domainBound` mientras las tres series viven por debajo de 20 mm/h. En escala
 * lineal las series colapsarían contra el suelo del gráfico y la figura no
 * mostraría más que un rectángulo azul.
 */
export function precipitationFigure(ctx: FigureContext, box: Box = HINDCAST_BOX): string {
  const w = plotWidth(box);
  const h = plotHeight(box);
  const base = box.top + h;
  const nPts = ctx.points.length;

  const x = linearScale(0, Math.max(1, nPts - 1), box.left, box.left + w);
  const yHi = Math.max(...ctx.points.map((p) => p.hull.upper));
  const ys = linearScale(symlog(0), symlog(yHi) * 1.04, base, box.top);
  const y = (v: number) => ys(symlog(v));

  let body = '';
  for (const tick of [0, 5, 10, 25, 50, 100, 250, 500].filter((t) => t <= yHi)) {
    const py = y(tick);
    body += line(box.left, py, box.left + w, py, PALETTE.grid, 1);
    body += text(box.left - 9, py + 4, String(tick), { size: 11, anchor: 'end', fill: PALETTE.muted });
  }
  body += timeAxis(box, ctx, x);

  // Hull (nivel existencial) y banda 95 %, como polígonos cerrados.
  const areaOf = (pick: (p: HindcastPoint) => { lower: number; upper: number }) => {
    const top = ctx.points.map((p, i) => [x(i), y(pick(p).upper)] as const);
    const bottom = ctx.points.map((p, i) => [x(nPts - 1 - i), y(pick(ctx.points[nPts - 1 - i]).lower)] as const);
    return [...top, ...bottom];
  };
  body += polygon(areaOf((p) => p.hull), PALETTE.hull, 0.45);
  body += polygon(areaOf((p) => p.band), PALETTE.core, 0.22);

  for (let s = 0; s < ctx.sourceLabels.length; s++) {
    body += polyline(
      ctx.points.map((p, i) => [x(i), y(p.precipitation[s])] as const),
      SOURCE_COLORS[s % SOURCE_COLORS.length],
      1.7
    );
  }

  body += line(box.left, box.top, box.left, base, PALETTE.axis, 1.2);
  body += line(box.left, base, box.left + w, base, PALETTE.axis, 1.2);
  body += header(box, ctx);
  body += yLabel(box, 'precipitación (mm/h, escala symlog)');
  body += legend(box.left, box.height - 16, [
    ...ctx.sourceLabels.map((label, i) => ({ label, fill: SOURCE_COLORS[i % SOURCE_COLORS.length] })),
    { label: 'banda credal 95 %', fill: PALETTE.core, opacity: 0.22 },
    { label: 'hull credal', fill: PALETTE.hull, opacity: 0.45 },
  ]);

  return svgDocument(
    box,
    ctx.title,
    describe(
      ctx,
      'Series horarias de precipitación de las tres fuentes, con el hull del conjunto credal ' +
        'fusionado y la banda que acumula el 95 % de la masa. Eje vertical symlog (lineal ' +
        'hasta 10 mm/h) porque el hull alcanza el domainBound de 500 mm/h.'
    ),
    body
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// f2 — conflicto en el tiempo
// ─────────────────────────────────────────────────────────────────────────────

export function conflictFigure(
  ctx: FigureContext,
  thresholds: { kappa1: number; kappa2: number; kappaDegeneracy: number },
  box: Box = HINDCAST_BOX
): string {
  const w = plotWidth(box);
  const h = plotHeight(box);
  const base = box.top + h;
  const nPts = ctx.points.length;

  const x = linearScale(0, Math.max(1, nPts - 1), box.left, box.left + w);
  const y = linearScale(0, 1, base, box.top);

  let body = '';
  for (let v = 0; v <= 1.0001; v += 0.1) {
    const py = y(v);
    body += line(box.left, py, box.left + w, py, PALETTE.grid, 1);
    body += text(box.left - 9, py + 4, v.toFixed(1), { size: 11, anchor: 'end', fill: PALETTE.muted });
  }
  body += timeAxis(box, ctx, x);

  for (const [value, label, color] of [
    [thresholds.kappa1, 'κ₁ = ' + thresholds.kappa1, PALETTE.critical],
    [thresholds.kappa2, 'κ₂ = ' + thresholds.kappa2, PALETTE.critical],
    [thresholds.kappaDegeneracy, 'κ_deg = ' + thresholds.kappaDegeneracy, '#7c3aed'],
  ] as const) {
    const py = y(value as number);
    body += line(box.left, py, box.left + w, py, color as string, 1.4, '7 4');
    body += text(box.left + w - 4, py - 5, label as string, {
      size: 10.5,
      anchor: 'end',
      fill: color as string,
      weight: 'bold',
    });
  }

  body += polyline(ctx.points.map((p, i) => [x(i), y(p.globalConflict)] as const), '#f59e0b', 1.8);
  body += polyline(ctx.points.map((p, i) => [x(i), y(p.maxConflict)] as const), '#1d4ed8', 2);

  body += line(box.left, box.top, box.left, base, PALETTE.axis, 1.2);
  body += line(box.left, base, box.left + w, base, PALETTE.axis, 1.2);
  body += header(box, ctx);
  body += yLabel(box, 'conflicto');
  body += legend(box.left, box.height - 16, [
    { label: 'K_max (Def. 3.5, decide con C1)', fill: '#1d4ed8' },
    { label: 'K_global (extension n-aria)', fill: '#f59e0b' },
  ]);

  return svgDocument(
    box,
    ctx.title,
    describe(
      ctx,
      'K_máx por pares y K_global n-ario hora a hora, con los tres umbrales de la regla C1: ' +
        'κ₁ y κ₂ se comparan con K_máx (Def. 3.6) y κ_deg es la guardia de degeneración ' +
        'sobre K_global.'
    ),
    body
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// f3 — plUpper en el tiempo, escala logarítmica
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Suelo de la escala logarítmica de f3.
 *
 * `plUpper` puede ser exactamente 0 —ninguna hipótesis del conjunto credal
 * propagado toca la región insegura— y log(0) no se dibuja. Los ceros se
 * representan EN EL SUELO y con marca propia, para que no se confundan con
 * «muy pequeño pero positivo»: son afirmaciones distintas.
 */
export const PL_FLOOR = 1e-8;

export function plausibilityFigure(
  ctx: FigureContext,
  pCritical: number,
  box: Box = HINDCAST_BOX
): string {
  const w = plotWidth(box);
  const h = plotHeight(box);
  const base = box.top + h;
  const nPts = ctx.points.length;

  const x = linearScale(0, Math.max(1, nPts - 1), box.left, box.left + w);
  const lo = Math.log10(PL_FLOOR);
  const y = linearScale(lo, 0, base, box.top);
  const py = (v: number) => y(Math.log10(Math.max(v, PL_FLOOR)));

  let body = '';
  for (let d = Math.ceil(lo); d <= 0; d++) {
    const gy = y(d);
    body += line(box.left, gy, box.left + w, gy, PALETTE.grid, 1);
    body += text(box.left - 9, gy + 4, `1e${d}`, { size: 11, anchor: 'end', fill: PALETTE.muted });
  }
  body += timeAxis(box, ctx, x);

  const gyCrit = py(pCritical);
  body += line(box.left, gyCrit, box.left + w, gyCrit, PALETTE.critical, 1.6, '7 4');
  body += text(box.left + w - 4, gyCrit - 6, `p_crit = ${pCritical} → 'critical'`, {
    size: 11,
    anchor: 'end',
    fill: PALETTE.critical,
    weight: 'bold',
  });
  body += text(box.left + 4, gyCrit + 14, `por debajo: 'warning' (des-escalada DEMOSTRADA)`, {
    size: 10,
    fill: PALETTE.muted,
  });

  body += polyline(ctx.points.map((p, i) => [x(i), py(p.plUpper)] as const), '#1d4ed8', 2);
  for (let i = 0; i < nPts; i++) {
    if (ctx.points[i].plUpper > 0) continue;
    body += `  <circle cx="${n(x(i))}" cy="${n(py(0))}" r="2.6" fill="${PALETTE.muted}"/>\n`;
  }

  body += line(box.left, box.top, box.left, base, PALETTE.axis, 1.2);
  body += line(box.left, base, box.left + w, base, PALETTE.axis, 1.2);
  body += header(box, ctx);
  body += yLabel(box, `Pl(inundación) — suelo en ${PL_FLOOR}`);
  body += legend(box.left, box.height - 16, [
    { label: 'plUpper (bound DEMOSTRADO)', fill: '#1d4ed8' },
    { label: 'plUpper = 0 exacto', fill: PALETTE.muted },
  ]);

  return svgDocument(
    box,
    ctx.title,
    describe(
      ctx,
      `Cota superior demostrada Pl(E) de la probabilidad de inundación, hora a hora, en ` +
        `escala logarítmica con suelo en ${PL_FLOOR}. La línea discontinua es el umbral ` +
        `p_crít = ${pCritical} que separa 'warning' de 'critical'. Los puntos grises son ` +
        `horas con plUpper exactamente 0.`
    ),
    body
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// f4 — anchura de la banda AURA frente a los baselines
// ─────────────────────────────────────────────────────────────────────────────

export function widthFigure(ctx: FigureContext, box: Box = HINDCAST_BOX): string {
  const w = plotWidth(box);
  const h = plotHeight(box);
  const base = box.top + h;
  const nPts = ctx.points.length;

  const all = ctx.points.flatMap((p) => [p.widths.band, p.widths.weightedMean, p.widths.kalman]);
  const lo = Math.floor(Math.log10(Math.max(Math.min(...all), 1e-3)));
  const hi = Math.ceil(Math.log10(Math.max(...all)));

  const x = linearScale(0, Math.max(1, nPts - 1), box.left, box.left + w);
  const y = linearScale(lo, hi, base, box.top);
  const py = (v: number) => y(Math.log10(Math.max(v, Math.pow(10, lo))));

  let body = '';
  for (let d = lo; d <= hi; d++) {
    const gy = y(d);
    body += line(box.left, gy, box.left + w, gy, PALETTE.grid, 1);
    body += text(box.left - 9, gy + 4, `1e${d}`, { size: 11, anchor: 'end', fill: PALETTE.muted });
  }
  body += timeAxis(box, ctx, x);

  for (const [key, color] of [
    ['band', WIDTH_COLORS.band],
    ['weightedMean', WIDTH_COLORS.weightedMean],
    ['kalman', WIDTH_COLORS.kalman],
  ] as const) {
    body += polyline(
      ctx.points.map((p, i) => [x(i), py(p.widths[key])] as const),
      color,
      key === 'band' ? 2 : 1.7
    );
  }

  body += line(box.left, box.top, box.left, base, PALETTE.axis, 1.2);
  body += line(box.left, base, box.left + w, base, PALETTE.axis, 1.2);
  body += header(box, ctx);
  body += yLabel(box, 'anchura del intervalo (mm/h, escala log)');
  body += legend(box.left, box.height - 16, [
    { label: 'AURA banda 95 %', fill: WIDTH_COLORS.band },
    { label: 'media ponderada', fill: WIDTH_COLORS.weightedMean },
    { label: 'Kalman estatico', fill: WIDTH_COLORS.kalman },
  ]);

  return svgDocument(
    box,
    ctx.title,
    describe(
      ctx,
      'Anchura del intervalo de cada método hora a hora, en escala logarítmica. Las de los ' +
        'dos baselines son CONSTANTES por construcción: dependen solo de σ y δ, no de la ' +
        'evidencia, de modo que no se enteran de nada de lo que pasa en el evento.'
    ),
    body
  );
}
