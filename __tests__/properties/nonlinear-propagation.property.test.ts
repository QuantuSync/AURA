/**
 * Propiedad B6 — Teorema 5.1 (propagación zonotópica de una función no lineal)
 * papers/AURA_v2.pdf §5.4, Ecuaciones (28)-(29)
 *
 *   f(Z) ⊆ Z' = <f(c), [ J·G | (L·r_Z²/2)·I_m ]>
 *
 * Es el invariante más fuerte del sistema y el que más fácilmente se rompe:
 * depende de que la cota del resto de Lagrange sea válida sobre TODO el
 * zonotope, no solo en los puntos donde se estimó L.
 *
 * Se genera una familia de funciones suaves parametrizadas al azar —las del
 * dominio del paper: polinomios, raíces (Darcy-Weisbach, Ec. 11) y senos— y se
 * verifica que ningún punto propagado escapa del interval hull computado.
 *
 * MÉTRICA ADICIONAL (no aserción): el ratio de sobre-aproximación
 *   ρ̂ = ancho(hull computado) / ancho(hull empírico de las imágenes)
 * es el análogo unidimensional y muestral del ratio de sobre-conservatismo de
 * la Definición 5.6 (§5.6), que allí se define sobre volúmenes y contra el
 * conjunto real R_real. ρ̂ ≥ 1 por soundness; ρ̂ = 1 sería exactitud.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { toIntervalHull } from '@/core/zonotope/zonotope';
import { propagateNonlinearAuto } from '@/core/zonotope/linearization';
import { Zonotope } from '@/core/zonotope/types';
import { fcParams, realArb, containedWithin, NUM_RUNS, SEED } from './_config';
import { zonotopeArb, samplePoints } from './_generators';

/** Puntos muestreados por caso — el enunciado exige ≥ 500. */
const POINTS_PER_CASE = 500;

/** Tolerancia relativa: la contención es hasta error de redondeo. */
const REL_EPS = 1e-9;

type VectorFn = (x: number[]) => number[];

interface TestCase {
  z: Zonotope;
  f: VectorFn;
  family: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Familias de funciones no lineales suaves
// ─────────────────────────────────────────────────────────────────────────

/** Interval hull de la entrada, para acotar dominios (p.ej. √ requiere x > 0). */
function inputBounds(z: Zonotope): { lower: number[]; upper: number[] } {
  const hull = toIntervalHull(z);
  return { lower: hull.map((h) => h.lower), upper: hull.map((h) => h.upper) };
}

/**
 * Polinomio de grado ≤ 3 en las n variables de entrada, con m salidas.
 * El hessiano de un polinomio cúbico es afín, luego su supremo sobre Z se
 * alcanza en un vértice — que es donde `estimateLipschitz` muestrea.
 */
function makePolynomial(n: number, m: number, coeffs: number[]): VectorFn {
  let k = 0;
  const next = () => coeffs[k++ % coeffs.length];
  const specs = Array.from({ length: m }, () => ({
    a0: next(),
    linear: Array.from({ length: n }, () => next()),
    quad: Array.from({ length: n }, () => next()),
    cross: next(),
    cubic: Array.from({ length: n }, () => next()),
  }));

  return (x: number[]) =>
    specs.map((s) => {
      let acc = s.a0;
      for (let i = 0; i < n; i++) {
        acc += s.linear[i] * x[i];
        acc += s.quad[i] * x[i] * x[i];
        acc += s.cubic[i] * x[i] * x[i] * x[i];
      }
      if (n >= 2) acc += s.cross * x[0] * x[1];
      return acc;
    });
}

/**
 * Familia k·√(x₀ + c) con dominio garantizado positivo.
 *
 * Es la forma de la Ecuación (11) del paper (Darcy-Weisbach: Q_d ∝ √P). El
 * desplazamiento c se elige a partir del hull de entrada para que el radicando
 * se mantenga acotado lejos de 0 en todo el zonotope — fuera de ahí la función
 * no es C¹ y el Teorema 5.1 no aplica (violaría H3).
 */
function makeSqrt(z: Zonotope, gain: number, margin: number): VectorFn {
  const { lower } = inputBounds(z);
  const shift = -lower[0] + margin;
  return (x: number[]) => [gain * Math.sqrt(Math.max(x[0] + shift, 1e-12))];
}

/** Composición con seno: k·sin(a·x₀ + b) + acoplamiento suave con x₁. */
function makeSin(a: number, b: number, gain: number, n: number): VectorFn {
  return (x: number[]) => [
    gain * Math.sin(a * x[0] + b) + (n >= 2 ? 0.5 * Math.sin(x[1]) : 0),
  ];
}

/** Real con MAGNITUD garantizada en [lo, hi] y signo arbitrario. */
const signedMagnitude = (lo: number, hi: number): fc.Arbitrary<number> =>
  fc
    .tuple(fc.double({ min: lo, max: hi, noNaN: true, noDefaultInfinity: true }), fc.boolean())
    .map(([m, negative]) => (negative ? -m : m));

/**
 * Zonotopes de radio moderado pero NO degenerado.
 *
 * El paper es explícito (§5.6, "Implicación práctica"): el Teorema 5.1 es útil
 * cuando "la incertidumbre es acotada y la dinámica es razonablemente suave".
 * Radios enormes con curvatura cúbica caen fuera del régimen que el paper
 * reclama, no de la corrección del código.
 *
 * Se exige magnitud mínima en los generadores por una razón de método: con
 * `fc.double` sin cota inferior, la inmensa mayoría de los zonotopes generados
 * son puntos numéricos (generadores ~1e-300). La contención se cumple
 * trivialmente y el ratio de conservatismo queda indefinido (0/0), de modo que
 * la métrica se calculaba sobre una muestra ridícula. Con esta cota, tanto la
 * aserción de soundness como la métrica operan sobre conjuntos con volumen
 * real — y la aserción es MÁS exigente, no menos.
 */
const meaningfulZonotope = (): fc.Arbitrary<Zonotope> =>
  fc.integer({ min: 1, max: 3 }).chain((n) =>
    fc
      .tuple(
        fc.array(signedMagnitude(0, 10), { minLength: n, maxLength: n }),
        fc
          .integer({ min: 1, max: 3 })
          .chain((p) =>
            fc.array(fc.array(signedMagnitude(0.05, 1.5), { minLength: n, maxLength: n }), {
              minLength: p,
              maxLength: p,
            })
          )
      )
      .map(([center, generators]) => ({ center, generators, dimension: n }))
  );

/** Zonotopes casi degenerados: cubren el otro extremo del espectro. */
const degenerateZonotope = (): fc.Arbitrary<Zonotope> =>
  zonotopeArb(1, 3, 3).map((z) => ({
    ...z,
    generators: z.generators.map((g) => g.map((v) => v * 1e-6)),
  }));

const testCaseArb = (): fc.Arbitrary<TestCase> =>
  meaningfulZonotope().chain((z) => {
    const n = z.dimension;
    return fc.oneof(
      // Polinomios de grado ≤ 3
      fc
        .tuple(
          fc.integer({ min: 1, max: 2 }),
          fc.array(realArb(-2, 2), { minLength: 8, maxLength: 16 })
        )
        .map(([m, coeffs]) => ({ z, f: makePolynomial(n, m, coeffs), family: 'polinomio≤3' })),
      // k·√(x + c), dominio positivo — Ec. (11), Darcy-Weisbach
      fc
        .tuple(realArb(0.2, 5), realArb(0.5, 10))
        .map(([gain, margin]) => ({ z, f: makeSqrt(z, gain, margin), family: 'k·√(x+c)' })),
      // Composiciones con seno
      fc
        .tuple(realArb(-3, 3), realArb(-Math.PI, Math.PI), realArb(0.2, 3))
        .map(([a, b, gain]) => ({ z, f: makeSin(a, b, gain, n), family: 'sin' }))
    );
  });

// ─────────────────────────────────────────────────────────────────────────
// Acumulación de la métrica de conservatismo
// ─────────────────────────────────────────────────────────────────────────

interface Accumulator {
  ratios: number[];
  degenerate: number;
}

const stats = new Map<string, Accumulator>();

function recordRatio(family: string, ratio: number, degenerate: boolean): void {
  if (!stats.has(family)) stats.set(family, { ratios: [], degenerate: 0 });
  const acc = stats.get(family)!;
  if (degenerate) acc.degenerate++;
  else acc.ratios.push(ratio);
}

const mean = (xs: number[]): number => xs.reduce((s, v) => s + v, 0) / xs.length;

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(xs: number[], p: number): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

describe('B6 · Teorema 5.1 — soundness de la propagación no lineal', () => {
  it('todo punto propagado cae en el interval hull de propagateNonlinearAuto', () => {
    fc.assert(
      fc.property(testCaseArb(), fc.integer({ min: 1, max: 1e6 }), ({ z, f, family }, seed) => {
        const propagated = propagateNonlinearAuto(z, f);
        const hull = toIntervalHull(propagated);

        const points = samplePoints(z, POINTS_PER_CASE, seed);
        const images = points.map(f);
        const m = hull.length;

        // (1) Soundness: ninguna imagen escapa del hull computado.
        for (let k = 0; k < images.length; k++) {
          for (let i = 0; i < m; i++) {
            const v = images[k][i];
            if (!Number.isFinite(v)) continue; // dominio degenerado, no aplica
            const ok = containedWithin(v, hull[i].lower, hull[i].upper, REL_EPS);
            if (!ok) {
              throw new Error(
                `[${family}] f(${points[k]})[${i}] = ${v} fuera de ` +
                  `[${hull[i].lower}, ${hull[i].upper}]`
              );
            }
          }
        }

        // (2) Métrica de conservatismo (Def. 5.6, versión muestral por eje).
        for (let i = 0; i < m; i++) {
          const values = images.map((img) => img[i]).filter(Number.isFinite);
          if (values.length === 0) continue;
          const empiricalWidth = Math.max(...values) - Math.min(...values);
          const computedWidth = hull[i].upper - hull[i].lower;
          // Umbral RELATIVO a la magnitud: un ancho de 1e-9 es significativo
          // para valores de orden 1e-6 y ruido puro para valores de orden 1e6.
          const scale = Math.max(1, ...values.map(Math.abs));
          const degenerate =
            !(empiricalWidth > 1e-12 * scale) || !Number.isFinite(computedWidth);
          recordRatio(family, degenerate ? NaN : computedWidth / empiricalWidth, degenerate);
        }
      }),
      fcParams
    );
  });

  it('el hull computado contiene el hull empírico de las imágenes', () => {
    // Formulación conjuntista de lo mismo: f(Z) ⊆ Z' de la Ec. (29).
    fc.assert(
      fc.property(testCaseArb(), fc.integer({ min: 1, max: 1e6 }), ({ z, f }, seed) => {
        const hull = toIntervalHull(propagateNonlinearAuto(z, f));
        const images = samplePoints(z, 200, seed).map(f);

        for (let i = 0; i < hull.length; i++) {
          const values = images.map((img) => img[i]).filter(Number.isFinite);
          if (values.length === 0) continue;
          expect(containedWithin(Math.min(...values), hull[i].lower, hull[i].upper, REL_EPS)).toBe(
            true
          );
          expect(containedWithin(Math.max(...values), hull[i].lower, hull[i].upper, REL_EPS)).toBe(
            true
          );
        }
      }),
      fcParams
    );
  });

  it('la soundness también se cumple sobre zonotopes casi degenerados', () => {
    // Otro extremo del espectro: radios ~1e-6, donde la cota de Lagrange es
    // despreciable y toda la contención descansa en el término lineal J·G.
    // Es el régimen que destapó el déficit de la jacobiana numérica.
    fc.assert(
      fc.property(
        degenerateZonotope().chain((z) =>
          fc
            .array(realArb(-2, 2), { minLength: 8, maxLength: 16 })
            .map((coeffs) => ({ z, f: makePolynomial(z.dimension, 1, coeffs) }))
        ),
        fc.integer({ min: 1, max: 1e6 }),
        ({ z, f }, seed) => {
          const hull = toIntervalHull(propagateNonlinearAuto(z, f));
          for (const p of samplePoints(z, 100, seed)) {
            const image = f(p);
            for (let i = 0; i < hull.length; i++) {
              if (!Number.isFinite(image[i])) continue;
              expect(containedWithin(image[i], hull[i].lower, hull[i].upper, REL_EPS)).toBe(true);
            }
          }
        }
      ),
      fcParams
    );
  });

  it('el ratio de conservatismo es ≥ 1 (consecuencia directa de la soundness)', () => {
    // ρ < 1 significaría que el conjunto computado es MÁS ESTRECHO que las
    // imágenes reales: soundness violada. Es la Def. 5.6, "ρ(t) ≥ 1 siempre".
    const all = [...stats.values()].flatMap((a) => a.ratios).filter(Number.isFinite);
    expect(all.length).toBeGreaterThan(0);
    for (const r of all) {
      expect(r).toBeGreaterThanOrEqual(1 - 1e-9);
    }
  });

  it('reporta el conservatismo por familia de funciones (Definición 5.6)', () => {
    const rows = [...stats.entries()]
      .map(([family, acc]) => {
        const ratios = acc.ratios.filter(Number.isFinite);
        if (ratios.length === 0) {
          return { Familia: family, Casos: 0, 'ρ̂ medio': 'n/a' } as Record<string, unknown>;
        }
        return {
          Familia: family,
          Casos: ratios.length,
          'ρ̂ medio': mean(ratios).toFixed(3),
          'ρ̂ mediana': median(ratios).toFixed(3),
          'ρ̂ p95': percentile(ratios, 0.95).toFixed(3),
          'ρ̂ máx': Math.max(...ratios).toFixed(3),
          'ρ̂ mín': Math.min(...ratios).toFixed(3),
          Degenerados: acc.degenerate,
        };
      })
      .filter((r) => (r.Casos as number) > 0);

    const global = [...stats.values()].flatMap((a) => a.ratios).filter(Number.isFinite);
    if (global.length > 0) {
      rows.push({
        Familia: 'TODAS',
        Casos: global.length,
        'ρ̂ medio': mean(global).toFixed(3),
        'ρ̂ mediana': median(global).toFixed(3),
        'ρ̂ p95': percentile(global, 0.95).toFixed(3),
        'ρ̂ máx': Math.max(...global).toFixed(3),
        'ρ̂ mín': Math.min(...global).toFixed(3),
        Degenerados: [...stats.values()].reduce((s, a) => s + a.degenerate, 0),
      });
    }

    console.log(
      `\nRatio de sobre-aproximación ρ̂ = ancho(hull computado) / ancho(hull empírico)\n` +
        `Teorema 5.1 · Definición 5.6 — ${NUM_RUNS} casos generados, semilla ${SEED}, ` +
        `${POINTS_PER_CASE} puntos por caso`
    );
    console.table(rows);

    expect(rows.length).toBeGreaterThan(0);
  });
});
