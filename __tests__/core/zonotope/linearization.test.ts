import { describe, it, expect } from 'vitest';
import { fromIntervals, toIntervalHull } from '@/core/zonotope/zonotope';
import { propagateNonlinear } from '@/core/zonotope/propagation';
import {
  numericalJacobian,
  estimateLipschitz,
  lagrangeRemainderBound,
  propagateNonlinearAuto,
} from '@/core/zonotope/linearization';
import { Zonotope } from '@/core/zonotope/types';
import { Interval } from '@/core/intervals/types';

// ─────────────────────────────────────────────────────────────────────────
// Utilidades de muestreo (deterministas, para que un fallo sea reproducible)
// ─────────────────────────────────────────────────────────────────────────

function makeRng(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * Muestrea N puntos del zonotopo: los 2^k vértices (cuando son pocos) más
 * puntos interiores uniformes en ε ∈ [-1, 1]^k. Los vértices se incluyen
 * explícitamente porque es donde el resto de Lagrange es máximo y donde,
 * por tanto, la contención está más al límite.
 */
function sampleZonotopePoints(z: Zonotope, n: number, seed = 12345): number[][] {
  const rng = makeRng(seed);
  const k = z.generators.length;
  const point = (eps: number[]): number[] =>
    z.center.map((c, i) => c + z.generators.reduce((s, g, r) => s + eps[r] * g[i], 0));

  const points: number[][] = [];
  const totalVertices = Math.pow(2, k);
  if (totalVertices <= 1024) {
    for (let mask = 0; mask < totalVertices; mask++) {
      points.push(point(Array.from({ length: k }, (_, r) => ((mask >> r) & 1 ? 1 : -1))));
    }
  }
  while (points.length < n) {
    points.push(point(Array.from({ length: k }, () => 2 * rng() - 1)));
  }
  return points;
}

function inHull(value: number[], hull: Interval[]): boolean {
  return value.every((v, i) => v >= hull[i].lower && v <= hull[i].upper);
}

/** Ejecuta la comprobación de contención por muestreo y reporta el peor caso. */
function assertContainment(
  z: Zonotope,
  f: (x: number[]) => number[],
  hull: Interval[],
  samples: number
): void {
  const points = sampleZonotopePoints(z, samples);
  let escapes = 0;
  let worst: { point: number[]; value: number[] } | null = null;

  for (const p of points) {
    const value = f(p);
    if (!inHull(value, hull)) {
      escapes++;
      if (!worst) worst = { point: p, value };
    }
  }

  expect(
    escapes,
    worst
      ? `${escapes}/${points.length} puntos fuera del hull. Primero: f(${worst.point}) = ` +
        `${worst.value}, hull = ${JSON.stringify(hull)}`
      : ''
  ).toBe(0);
}

const SAMPLES = 12_000;

// ─────────────────────────────────────────────────────────────────────────
// numericalJacobian
// ─────────────────────────────────────────────────────────────────────────

describe('numericalJacobian', () => {
  it('recovers the exact jacobian of a linear map', () => {
    // f(x, y) = [2x + 3y, -x + 4y]
    const f = ([x, y]: number[]) => [2 * x + 3 * y, -x + 4 * y];
    const J = numericalJacobian(f, [1, 2]);
    expect(J[0][0]).toBeCloseTo(2, 6);
    expect(J[0][1]).toBeCloseTo(3, 6);
    expect(J[1][0]).toBeCloseTo(-1, 6);
    expect(J[1][1]).toBeCloseTo(4, 6);
  });

  it('matches the analytic jacobian of a nonlinear map', () => {
    // f(x, y) = [x², x·y] → J = [[2x, 0], [y, x]]
    const f = ([x, y]: number[]) => [x * x, x * y];
    const J = numericalJacobian(f, [3, 5]);
    expect(J[0][0]).toBeCloseTo(6, 5);
    expect(J[0][1]).toBeCloseTo(0, 5);
    expect(J[1][0]).toBeCloseTo(5, 5);
    expect(J[1][1]).toBeCloseTo(3, 5);
  });

  it('shape is m×n, not n×m', () => {
    // f: ℝ³ → ℝ² ⇒ jacobiana de 2 filas y 3 columnas
    const f = ([x, y, w]: number[]) => [x + y, y * w];
    const J = numericalJacobian(f, [1, 1, 1]);
    expect(J.length).toBe(2);
    expect(J[0].length).toBe(3);
  });

  it('rejects a non-positive step', () => {
    expect(() => numericalJacobian(([x]) => [x], [0], 0)).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// estimateLipschitz / lagrangeRemainderBound
// ─────────────────────────────────────────────────────────────────────────

describe('estimateLipschitz', () => {
  it('is ~0 for a linear function (zero curvature)', () => {
    const z = fromIntervals([{ lower: 1, upper: 3 }]);
    const [L] = estimateLipschitz(([x]) => [5 * x], z);
    expect(L).toBeLessThan(1e-4);
  });

  it('recovers L = 2 exactly for x² (constant hessian), scaled by safetyFactor', () => {
    // f''(x) = 2 en todo punto ⇒ el muestreo es exacto, no una subestimación.
    const z = fromIntervals([{ lower: 1, upper: 3 }]);
    const [L] = estimateLipschitz(([x]) => [x * x], z, 64, { safetyFactor: 1 });
    expect(L).toBeCloseTo(2, 4);

    const [Lsafe] = estimateLipschitz(([x]) => [x * x], z);
    expect(Lsafe).toBeCloseTo(3, 4); // 2 × 1.5
  });

  it('is deterministic across runs (seeded sampling)', () => {
    const z = fromIntervals([{ lower: 0, upper: 2 }]);
    const f = ([x]: number[]) => [Math.sin(x)];
    expect(estimateLipschitz(f, z)).toEqual(estimateLipschitz(f, z));
  });

  it('rejects a safetyFactor below 1 (would be anti-conservative)', () => {
    const z = fromIntervals([{ lower: 1, upper: 3 }]);
    expect(() => estimateLipschitz(([x]) => [x * x], z, 64, { safetyFactor: 0.5 })).toThrow();
  });
});

describe('lagrangeRemainderBound', () => {
  it('dominates the true remainder of x² at the worst point', () => {
    // Para f(x) = x² el resto es exactamente d², máximo r² en los vértices.
    const z = fromIntervals([{ lower: 1, upper: 3 }]); // c = 2, r = 1
    const [bound] = lagrangeRemainderBound(([x]) => [x * x], z);
    const trueWorstRemainder = 1 * 1; // d² con d = r = 1
    expect(bound.upper).toBeGreaterThan(trueWorstRemainder);
    expect(bound.lower).toBeCloseTo(-bound.upper, 12); // simétrico
  });

  it('scales as r² — duplicar el radio cuadruplica la cota', () => {
    const narrow = fromIntervals([{ lower: 1.5, upper: 2.5 }]); // r = 0.5
    const wide = fromIntervals([{ lower: 1, upper: 3 }]); // r = 1.0
    const f = ([x]: number[]) => [x * x];
    const [bn] = lagrangeRemainderBound(f, narrow);
    const [bw] = lagrangeRemainderBound(f, wide);
    expect(bw.upper / bn.upper).toBeCloseTo(4, 3);
  });

  it('emits one bound per output dimension', () => {
    const z = fromIntervals([
      { lower: 1, upper: 3 },
      { lower: 2, upper: 4 },
    ]);
    const bounds = lagrangeRemainderBound(([x, y]) => [x * x, x * y, y * y], z);
    expect(bounds.length).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Soundness por muestreo — el test central del Teorema 5.1
// ─────────────────────────────────────────────────────────────────────────

describe('propagateNonlinearAuto — soundness por muestreo (≥10.000 puntos)', () => {
  it('f(x) = x² : todos los puntos propagados caen en el interval hull', () => {
    const z = fromIntervals([{ lower: 1, upper: 3 }]);
    const f = ([x]: number[]) => [x * x];
    const hull = toIntervalHull(propagateNonlinearAuto(z, f));

    assertContainment(z, f, hull, SAMPLES);

    // El rango real es [1, 9]; el hull debe contenerlo de verdad.
    expect(hull[0].lower).toBeLessThanOrEqual(1);
    expect(hull[0].upper).toBeGreaterThanOrEqual(9);
  });

  it('f(x) = sin(x) : contención sobre un intervalo que cruza el máximo', () => {
    // [-1, 2] contiene π/2, donde |f''| es máximo: el caso más exigente.
    const z = fromIntervals([{ lower: -1, upper: 2 }]);
    const f = ([x]: number[]) => [Math.sin(x)];
    const hull = toIntervalHull(propagateNonlinearAuto(z, f));

    assertContainment(z, f, hull, SAMPLES);

    expect(hull[0].lower).toBeLessThanOrEqual(Math.sin(-1));
    expect(hull[0].upper).toBeGreaterThanOrEqual(1); // sin(π/2)
  });

  it('Darcy-Weisbach Q = k·√P : contención sobre el rango operativo', () => {
    // Relación caudal-presión del modelo hidráulico. La curvatura es máxima en
    // el extremo inferior de presión, que es donde la cota aprieta.
    const k = 0.8;
    const z = fromIntervals([{ lower: 4, upper: 6 }]); // bar
    const f = ([P]: number[]) => [k * Math.sqrt(P)];
    const hull = toIntervalHull(propagateNonlinearAuto(z, f));

    assertContainment(z, f, hull, SAMPLES);

    expect(hull[0].lower).toBeLessThanOrEqual(k * Math.sqrt(4));
    expect(hull[0].upper).toBeGreaterThanOrEqual(k * Math.sqrt(6));
  });

  it('caso multivariable f(x, y) = [x², x·y] : contención en ambas salidas', () => {
    const z = fromIntervals([
      { lower: 1, upper: 3 },
      { lower: 2, upper: 4 },
    ]);
    const f = ([x, y]: number[]) => [x * x, x * y];
    const hull = toIntervalHull(propagateNonlinearAuto(z, f));

    assertContainment(z, f, hull, SAMPLES);
  });

  it('acepta una jacobiana analítica sin perder la contención', () => {
    const z = fromIntervals([{ lower: 4, upper: 6 }]);
    const f = ([P]: number[]) => [0.8 * Math.sqrt(P)];
    // J analítica en el centro: k / (2√P)
    const hull = toIntervalHull(
      propagateNonlinearAuto(z, f, { jacobian: [[0.8 / (2 * Math.sqrt(5))]] })
    );
    assertContainment(z, f, hull, SAMPLES);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Por qué existe la cota: sin ella la contención SE ROMPE
// ─────────────────────────────────────────────────────────────────────────

describe('errorBound = 0 rompe la contención (razón de ser del Teorema 5.1)', () => {
  it('f(x) = x² : la pura linearización deja fuera los extremos del zonotopo', () => {
    const z = fromIntervals([{ lower: 1, upper: 3 }]); // c = 2, r = 1
    const f = ([x]: number[]) => [x * x];

    // Linearización en el centro SIN término de error: f(2) + 4·(x-2).
    // El resto de Lagrange que se está ignorando vale d², hasta 1 en x = 3.
    const naive = propagateNonlinear(z, f, [[4]], [{ lower: 0, upper: 0 }]);
    const naiveHull = toIntervalHull(naive);

    // El hull "sin cota" es [0, 8], pero f(3) = 9 es alcanzable de verdad.
    expect(naiveHull[0].upper).toBeCloseTo(8, 6);
    expect(f([3])[0]).toBe(9);
    expect(inHull(f([3]), naiveHull)).toBe(false);

    // Cuantificar el fallo sobre el mismo muestreo del test de soundness:
    // una fracción NO despreciable de puntos alcanzables se escapa.
    const points = sampleZonotopePoints(z, SAMPLES);
    const escapes = points.filter((p) => !inHull(f(p), naiveHull)).length;
    expect(escapes).toBeGreaterThan(0);

    // Y la versión automática, sobre exactamente los mismos puntos, no falla.
    const autoHull = toIntervalHull(propagateNonlinearAuto(z, f));
    expect(points.filter((p) => !inHull(f(p), autoHull)).length).toBe(0);
  });

  it('sin(x) : errorBound = 0 también pierde puntos alcanzables', () => {
    const z = fromIntervals([{ lower: -1, upper: 2 }]);
    const f = ([x]: number[]) => [Math.sin(x)];
    const J = numericalJacobian(f, z.center);

    const naiveHull = toIntervalHull(propagateNonlinear(z, f, J, [{ lower: 0, upper: 0 }]));
    const points = sampleZonotopePoints(z, SAMPLES);
    expect(points.filter((p) => !inHull(f(p), naiveHull)).length).toBeGreaterThan(0);

    const autoHull = toIntervalHull(propagateNonlinearAuto(z, f));
    expect(points.filter((p) => !inHull(f(p), autoHull)).length).toBe(0);
  });

  it('una función lineal SÍ es exacta con errorBound = 0 (la cota solo paga curvatura)', () => {
    const z = fromIntervals([{ lower: 1, upper: 3 }]);
    const f = ([x]: number[]) => [2 * x + 1];
    const hull = toIntervalHull(propagateNonlinear(z, f, [[2]], [{ lower: 0, upper: 0 }]));
    assertContainment(z, f, hull, SAMPLES);
    expect(hull[0].lower).toBeCloseTo(3, 6);
    expect(hull[0].upper).toBeCloseTo(7, 6);
  });
});
