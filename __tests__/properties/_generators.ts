/**
 * AURA v2 — Generadores compartidos para property-based testing
 *
 * Arbitraries que producen objetos VÁLIDOS según las definiciones del paper
 * (papers/AURA_v2.pdf): BPAs que cumplen la Definición 3.2, zonotopes que
 * cumplen la Definición 5.1, etc. Un generador que produzca objetos inválidos
 * convertiría un fallo de la propiedad en ruido, no en evidencia.
 */

import fc from 'fast-check';
import { BPA, FrameOfDiscernment } from '@/core/dempster-shafer/types';
import { createFrame } from '@/core/dempster-shafer/frame';
import { Zonotope } from '@/core/zonotope/types';
import { Interval } from '@/core/intervals/types';
import { realArb, makeRng } from './_config';

// ─────────────────────────────────────────────────────────────────────────
// Capa 1 — Dempster-Shafer
// ─────────────────────────────────────────────────────────────────────────

/**
 * Marco de discernimiento Θ con k hipótesis contiguas — Definición 3.1.
 *
 * El `domainBound` (H0, soporte acotado declarado — ver docs/ERRATA.md §5) se
 * genera EXPLÍCITAMENTE por encima del final de la penúltima hipótesis, de modo
 * que la anchura de la hipótesis de cola varía entre casos: es exactamente la
 * dimensión que el truncamiento `a_j·2` fijaba a ojo y que ahora es un
 * parámetro declarado. El marco se construye con `createFrame`, luego cada
 * caso generado pasa por la misma validación que un marco de producción.
 */
export const frameArb = (minK = 2, maxK = 5): fc.Arbitrary<FrameOfDiscernment> =>
  fc
    .tuple(
      fc.integer({ min: minK, max: maxK }),
      // Multiplicador del ancho de la hipótesis de cola respecto a las demás.
      fc.double({ min: 0.5, max: 40, noNaN: true, noDefaultInfinity: true })
    )
    .map(([k, tailWidth]) => {
      const domainBound = (k - 1) * 10 + 10 * tailWidth;
      return createFrame({
        variable: 'X',
        unit: 'u',
        hypotheses: Array.from({ length: k }, (_, j) => ({
          label: `h${j}`,
          lower: j * 10,
          upper: j === k - 1 ? domainBound : (j + 1) * 10,
        })),
        domainBound,
      });
    });

/**
 * Variante con la cola ABIERTA tal como la escribe la Definición 3.1
 * ([a_{k−1}, ∞)) pero con `domainBound` declarado.
 *
 * Es el marco que el paper define literalmente: un literal que satisface el
 * tipo sin pasar por `createFrame`. Sirve para verificar que el lifting de la
 * Ec. (10) sigue siendo finito por la vía de `hypothesisUpper`, sin que el
 * `Infinity` declarado se cuele en el intervalo credal.
 */
export const openTailFrameArb = (minK = 2, maxK = 5): fc.Arbitrary<FrameOfDiscernment> =>
  frameArb(minK, maxK).map((frame) => ({
    ...frame,
    hypotheses: frame.hypotheses.map((h, j) =>
      j === frame.hypotheses.length - 1 ? { ...h, upper: Infinity } : h
    ),
  }));

/**
 * BPA arbitraria VÁLIDA sobre `frame` — Definición 3.2:
 *   m(∅) = 0,  Σ_{A⊆Θ} m(A) = 1,  m(A) ≥ 0
 *
 * Los elementos focales son subconjuntos arbitrarios no vacíos. La mezcla
 * pondera explícitamente singletons y Θ completo porque son los dos casos con
 * significado propio en el paper (evidencia precisa e ignorancia total), y un
 * generador uniforme sobre subconjuntos los produciría rara vez.
 */
export function bpaArb(frame: FrameOfDiscernment, sourceId: string): fc.Arbitrary<BPA> {
  const k = frame.hypotheses.length;
  const allIndices = Array.from({ length: k }, (_, i) => i);

  const subsetArb: fc.Arbitrary<number[]> = fc.oneof(
    {
      weight: 5,
      arbitrary: fc
        .uniqueArray(fc.integer({ min: 0, max: k - 1 }), { minLength: 1, maxLength: k })
        .map((a) => [...a].sort((x, y) => x - y)),
    },
    // Singleton: evidencia que distingue una hipótesis concreta.
    { weight: 4, arbitrary: fc.integer({ min: 0, max: k - 1 }).map((j) => [j]) },
    // Θ completo: ignorancia total, la "válvula de seguridad" de la Def. 3.4.
    { weight: 2, arbitrary: fc.constant(allIndices) }
  );

  return fc
    .array(
      fc.tuple(subsetArb, fc.double({ min: 0.05, max: 1, noNaN: true, noDefaultInfinity: true })),
      { minLength: 1, maxLength: 6 }
    )
    .map((entries) => {
      // Fusionar duplicados y normalizar a masa total 1.
      const massMap = new Map<string, number>();
      for (const [indices, weight] of entries) {
        const key = indices.join(',');
        massMap.set(key, (massMap.get(key) ?? 0) + weight);
      }
      const total = [...massMap.values()].reduce((s, v) => s + v, 0);
      const focalElements = [...massMap].map(([key, weight]) => ({
        indices: key.split(',').map(Number),
        mass: weight / total,
      }));
      return { frame, focalElements, sourceId, timestamp: 0 };
    });
}

/** n BPAs válidas sobre un mismo marco generado. */
export const multiSourceArb = (
  minSources = 2,
  maxSources = 4
): fc.Arbitrary<{ frame: FrameOfDiscernment; bpas: BPA[] }> =>
  frameArb().chain((frame) =>
    fc.integer({ min: minSources, max: maxSources }).chain((n) =>
      fc
        .tuple(...Array.from({ length: n }, (_, i) => bpaArb(frame, `s${i}`)))
        .map((bpas) => ({ frame, bpas: bpas as BPA[] }))
    )
  );

// ─────────────────────────────────────────────────────────────────────────
// Capas 2 y 3 — intervalos y zonotopes
// ─────────────────────────────────────────────────────────────────────────

/** Caja de n intervalos bien formados (salida típica de la Capa 2). */
export const intervalBoxArb = (minN = 1, maxN = 4): fc.Arbitrary<Interval[]> =>
  fc.integer({ min: minN, max: maxN }).chain((n) =>
    fc.array(
      fc
        .tuple(realArb(-100, 100), realArb(-100, 100))
        .map(([p, q]) => ({ lower: Math.min(p, q), upper: Math.max(p, q) })),
      { minLength: n, maxLength: n }
    )
  );

/** Zonotope arbitrario Z = <c, G> — Definición 5.1. */
export const zonotopeArb = (
  minDim = 1,
  maxDim = 3,
  maxGenerators = 4
): fc.Arbitrary<Zonotope> =>
  fc.integer({ min: minDim, max: maxDim }).chain((n) =>
    fc
      .tuple(
        fc.array(realArb(-10, 10), { minLength: n, maxLength: n }),
        fc.array(fc.array(realArb(-5, 5), { minLength: n, maxLength: n }), {
          minLength: 1,
          maxLength: maxGenerators,
        })
      )
      .map(([center, generators]) => ({ center, generators, dimension: n }))
  );

/** Matriz n×n arbitraria, para probar la Observación 5.1. */
export const matrixArb = (n: number): fc.Arbitrary<number[][]> =>
  fc.array(fc.array(realArb(-3, 3), { minLength: n, maxLength: n }), {
    minLength: n,
    maxLength: n,
  });

/**
 * Muestrea puntos de Z = <c, G>: vértices (ε ∈ {−1,+1}^p) más puntos
 * interiores uniformes. Los vértices van primero porque es donde la
 * contención suele estar más al límite.
 */
export function samplePoints(z: Zonotope, count: number, seed: number): number[][] {
  const rng = makeRng(seed);
  const p = z.generators.length;
  const at = (eps: number[]): number[] =>
    z.center.map((c, i) => c + z.generators.reduce((s, g, r) => s + eps[r] * g[i], 0));

  const points: number[][] = [[...z.center]];
  const totalVertices = Math.pow(2, p);
  if (totalVertices <= 512) {
    for (let mask = 0; mask < totalVertices; mask++) {
      points.push(at(Array.from({ length: p }, (_, r) => ((mask >> r) & 1 ? 1 : -1))));
    }
  }
  while (points.length < count) {
    points.push(at(Array.from({ length: p }, () => 2 * rng() - 1)));
  }
  return points;
}

/** Punto de una caja de intervalos, parametrizado por fracciones t ∈ [0,1]^n. */
export function pointInBox(box: Interval[], ts: number[]): number[] {
  return box.map((iv, i) => {
    const t = ts[i % ts.length];
    const x = iv.lower + t * (iv.upper - iv.lower);
    return Math.min(iv.upper, Math.max(iv.lower, x));
  });
}
