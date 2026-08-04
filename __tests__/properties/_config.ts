/**
 * AURA v2 — Configuración compartida del property-based testing
 *
 * Los invariantes de soundness del paper (papers/AURA_v2.pdf) se verifican
 * aquí sobre entradas generadas, no sobre casos escogidos a mano. El objetivo
 * es que los resultados sean citables: reproducibles bit a bit en CI y
 * escalables a campañas largas sin tocar el código.
 *
 * Variables de entorno:
 *   FC_NUM_RUNS  Casos generados por propiedad (default 1000, el mínimo que
 *                exige el protocolo de evidencia).
 *   FC_SEED      Semilla del generador. Fija por defecto → CI determinista.
 *                Pásala explícitamente para reproducir un fallo concreto.
 *   FC_VERBOSE   '1' para que fast-check imprima el árbol de reducción.
 */

import fc from 'fast-check';

const parsePositiveInt = (raw: string | undefined, fallback: number): number => {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Mínimo exigido por el protocolo de evidencia. No bajar de aquí en CI. */
export const MIN_RUNS = 1000;

export const NUM_RUNS = parsePositiveInt(process.env.FC_NUM_RUNS, MIN_RUNS);

/**
 * Semilla fija: dos ejecuciones de CI sobre el mismo commit exploran
 * exactamente el mismo espacio de entradas. Sin esto, un fallo intermitente
 * sería imposible de atribuir a un cambio de código.
 */
export const SEED = parsePositiveInt(process.env.FC_SEED, 20260804);

export const VERBOSE = process.env.FC_VERBOSE === '1';

/** Parámetros para `fc.assert`. */
export const fcParams: fc.Parameters<unknown> = {
  numRuns: NUM_RUNS,
  seed: SEED,
  verbose: VERBOSE,
  // La reducción (shrinking) es lo que convierte un fallo en un contraejemplo
  // mínimo utilizable; no limitarla artificialmente.
  endOnFailure: false,
};

// ─────────────────────────────────────────────────────────────────────────
// Generadores y utilidades comunes
// ─────────────────────────────────────────────────────────────────────────

/** Real finito en un rango moderado: evita NaN/Infinity y overflow. */
export const realArb = (min = -1e3, max = 1e3): fc.Arbitrary<number> =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

/** Fracción en [0, 1], usada para interpolar puntos dentro de un conjunto. */
export const unitArb = (): fc.Arbitrary<number> =>
  fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true });

/**
 * Comparación con tolerancia RELATIVA a la magnitud de los operandos.
 *
 * La aritmética de este motor es de punto flotante sin redondeo dirigido
 * (ver src/core/intervals/arithmetic.ts), de modo que la soundness se cumple
 * hasta el error de redondeo, no de forma exacta. Una tolerancia absoluta
 * fallaría espuriamente con magnitudes grandes y sería demasiado laxa con
 * magnitudes pequeñas.
 */
export function withinTolerance(value: number, bound: number, relEps: number): number {
  return relEps * Math.max(1, Math.abs(value), Math.abs(bound));
}

/** ¿`value` ∈ [lower, upper] admitiendo error de redondeo relativo? */
export function containedWithin(
  value: number,
  lower: number,
  upper: number,
  relEps = 1e-9
): boolean {
  return (
    value >= lower - withinTolerance(value, lower, relEps) &&
    value <= upper + withinTolerance(value, upper, relEps)
  );
}

/** PRNG determinista para muestreos internos de un caso generado. */
export function makeRng(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
