/**
 * AURA v2 — Generación de figuras en SVG, sin dependencias
 *
 * Las figuras se emiten como CADENA desde código puro: ni navegador, ni canvas,
 * ni librería de gráficos. Es lo que permite regenerarlas dentro de
 * `npm run repro` y compararlas byte a byte contra `snapshots/`.
 *
 * Toda coordenada pasa por {@link n}, que fija tres decimales: sin ese redondeo
 * un cambio de ulp en un cálculo intermedio produciría un SVG distinto y el
 * snapshot fallaría sin que nada real haya cambiado.
 */

/** Coordenada con precisión fija — ver la nota de determinismo del módulo. */
export const n = (x: number): string => (Object.is(x, -0) ? '0.000' : x.toFixed(3));

/** Escapa texto para incrustarlo en un nodo SVG. */
export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const FONT = 'Helvetica, Arial, sans-serif';

/** Paleta de la figura: contraste suficiente en impresión en gris. */
export const PALETTE = {
  axis: '#3f3f46',
  grid: '#e4e4e7',
  text: '#18181b',
  muted: '#71717a',
  hull: '#bfdbfe',
  hullStroke: '#3b82f6',
  core: '#1d4ed8',
  critical: '#dc2626',
  sources: ['#0ea5e9', '#f59e0b', '#10b981'],
  fused: '#1d4ed8',
} as const;

export interface Box {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export const DEFAULT_BOX: Box = {
  width: 840,
  height: 470,
  left: 78,
  right: 26,
  top: 62,
  bottom: 92,
};

export const plotWidth = (b: Box): number => b.width - b.left - b.right;
export const plotHeight = (b: Box): number => b.height - b.top - b.bottom;

/**
 * Escala symlog: lineal en |y| ≤ `linthresh`, logarítmica fuera.
 *
 * Hace falta porque el conjunto credal propagado abarca cinco órdenes de
 * magnitud en una sola figura: el 99,9 % de la masa cae en h ∈ [−2, 22] mm
 * mientras el hull llega a 992 mm por la masa δ sobre Θ. En escala lineal la
 * banda informativa colapsa a una línea de un píxel; en escala logarítmica pura
 * no caben los valores negativos, que son físicos (drenaje > lluvia).
 */
export function symlog(y: number, linthresh = 10): number {
  const a = Math.abs(y);
  if (a <= linthresh) return y / linthresh;
  return Math.sign(y) * (1 + Math.log10(a / linthresh));
}

export interface Scale {
  (v: number): number;
}

export function linearScale(d0: number, d1: number, r0: number, r1: number): Scale {
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

/** Envoltorio del documento SVG, con `<title>`/`<desc>` para accesibilidad. */
export function svgDocument(box: Box, title: string, desc: string, body: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}" ` +
    `viewBox="0 0 ${box.width} ${box.height}" role="img" aria-labelledby="t d">\n` +
    `  <title id="t">${esc(title)}</title>\n` +
    `  <desc id="d">${esc(desc)}</desc>\n` +
    `  <rect width="${box.width}" height="${box.height}" fill="#ffffff"/>\n` +
    body +
    `</svg>\n`
  );
}

export function text(
  x: number,
  y: number,
  content: string,
  opts: { size?: number; anchor?: string; fill?: string; weight?: string } = {}
): string {
  const { size = 12, anchor = 'start', fill = PALETTE.text, weight = 'normal' } = opts;
  return (
    `  <text x="${n(x)}" y="${n(y)}" font-family="${FONT}" font-size="${size}" ` +
    `text-anchor="${anchor}" fill="${fill}" font-weight="${weight}">${esc(content)}</text>\n`
  );
}

export function line(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke: string,
  width = 1,
  dash?: string
): string {
  return (
    `  <line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${stroke}" ` +
    `stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>\n`
  );
}

export function rect(
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  opts: { opacity?: number; stroke?: string } = {}
): string {
  const { opacity, stroke } = opts;
  return (
    `  <rect x="${n(x)}" y="${n(y)}" width="${n(Math.max(0, w))}" height="${n(Math.max(0, h))}" ` +
    `fill="${fill}"${opacity !== undefined ? ` fill-opacity="${opacity}"` : ''}` +
    `${stroke ? ` stroke="${stroke}" stroke-width="1"` : ''}/>\n`
  );
}

/** Polígono cerrado a partir de puntos ya en coordenadas de pantalla. */
export function polygon(points: readonly (readonly [number, number])[], fill: string, opacity = 1): string {
  const pts = points.map(([x, y]) => `${n(x)},${n(y)}`).join(' ');
  return `  <polygon points="${pts}" fill="${fill}" fill-opacity="${opacity}"/>\n`;
}

export function polyline(
  points: readonly (readonly [number, number])[],
  stroke: string,
  width = 1.6,
  dash?: string
): string {
  const pts = points.map(([x, y]) => `${n(x)},${n(y)}`).join(' ');
  return (
    `  <polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="${width}"` +
    `${dash ? ` stroke-dasharray="${dash}"` : ''}/>\n`
  );
}

/** Leyenda horizontal de cajas de color con etiqueta. */
export function legend(
  x: number,
  y: number,
  entries: readonly { label: string; fill: string; opacity?: number; stroke?: string }[]
): string {
  let out = '';
  let cx = x;
  for (const e of entries) {
    out += rect(cx, y - 9, 13, 13, e.fill, { opacity: e.opacity, stroke: e.stroke });
    out += text(cx + 19, y + 1.5, e.label, { size: 12, fill: PALETTE.muted });
    cx += 19 + e.label.length * 6.4 + 26;
  }
  return out;
}
