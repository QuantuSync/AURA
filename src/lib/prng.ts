/**
 * AURA v2 — PRNG determinista con semilla
 *
 * ÚNICA fuente de aleatoriedad del repositorio fuera de fast-check. La comparten
 * el property-based testing (`__tests__/properties/_config.ts` reexporta
 * {@link makeRng}) y los experimentos de `scripts/experiments/`, para que
 * «semilla 20260804» signifique exactamente lo mismo en los dos sitios y un
 * resultado citado en el paper se pueda reproducir desde cualquiera de ellos.
 *
 * `Math.random()` NO se usa en ningún sitio: no admite semilla, luego cualquier
 * número que dependiera de él sería incitable.
 *
 * QUÉ GARANTIZA. Un LCG de 32 bits (Numerical Recipes: a = 1664525,
 * c = 1013904223, m = 2³²) es determinista, portable y barato. Sus constantes
 * pasan los tests espectrales habituales para las dimensiones bajas que aquí se
 * usan.
 *
 * QUÉ NO GARANTIZA. No es criptográficamente seguro y su periodo es 2³². Para
 * muestreos de Monte Carlo con más de ~10⁸ extracciones —o para estimar colas
 * muy finas— hace falta un generador de periodo mayor. Está declarado aquí para
 * que quien llegue a ese régimen lo sepa antes de citar el resultado.
 */

/** Semilla por defecto de todo el repositorio. Fecha de la campaña de referencia. */
export const DEFAULT_SEED = 20260804;

export interface Rng {
  /** Uniforme en [0, 1). */
  (): number;
}

/**
 * PRNG determinista a partir de una semilla entera.
 *
 * La semilla 0 se sustituye por 1: un LCG multiplicativo-aditivo con estado 0
 * arranca igualmente, pero 0 es el valor que llega cuando alguien olvidó pasar
 * la semilla, y hacerlo indistinguible de una semilla elegida sería un error
 * silencioso.
 */
export function makeRng(seed: number): Rng {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Uniforme en [min, max). */
export function uniform(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** Entero uniforme en [min, max]. */
export function randomInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/**
 * Normal(mu, sigma) por Box-Muller.
 *
 * Se descarta u = 0 (log(0) = −∞) reintentando; la probabilidad es 2⁻³² por
 * extracción, pero un `NaN` aislado en una campaña larga es indepurable.
 */
export function normal(rng: Rng, mu = 0, sigma = 1): number {
  let u = 0;
  while (u === 0) u = rng();
  const v = rng();
  return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Elemento uniforme de un array no vacío. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick: array vacío.');
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}
