/**
 * AURA v2 — Estadística de las campañas de cobertura
 *
 * Lo mínimo, y con la justificación de por qué es eso y no otra cosa.
 */

import { Z_95 } from './methods';

/**
 * Intervalo de Wilson al 95 % para una proporción.
 *
 *   centro = (p̂ + z²/2n) / (1 + z²/n)
 *   radio  = z/(1 + z²/n) · √( p̂(1−p̂)/n + z²/4n² )
 *
 * POR QUÉ WILSON Y NO LA APROXIMACIÓN NORMAL (p̂ ± z√(p̂(1−p̂)/n)). Porque la
 * magnitud que más interesa aquí es una cobertura cercana a 1: con p̂ = 1 la
 * normal da un intervalo de anchura CERO —«cobertura 100 %, ±0»—, que es una
 * afirmación falsa sobre 10.000 muestras. Wilson devuelve [0,99963, 1] y no se
 * degrada en los extremos, que es exactamente el régimen del nivel existencial
 * de AURA.
 *
 * @param successes k ∈ [0, n]
 * @param total     n > 0
 */
export function wilsonInterval(
  successes: number,
  total: number
): { lower: number; upper: number } {
  if (total <= 0) return { lower: 0, upper: 1 };

  const z = Z_95;
  const p = successes / total;
  const z2n = (z * z) / total;
  const denom = 1 + z2n;
  const center = (p + z2n / 2) / denom;
  const radius =
    (z / denom) * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));

  return { lower: Math.max(0, center - radius), upper: Math.min(1, center + radius) };
}

/** Media aritmética; 0 sobre un array vacío. */
export function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
}

/**
 * Mediana por interpolación lineal entre los dos centrales cuando n es par.
 *
 * NO muta la entrada: los arrays de anchuras se reutilizan para la media y para
 * las figuras, y ordenarlos en sitio cambiaría el orden en que se dibujan.
 */
export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Acumulador de un estrato: aciertos, total y anchuras. */
export class Stratum {
  successes = 0;
  total = 0;
  readonly widths: number[] = [];

  add(hit: boolean, width: number): void {
    this.total++;
    if (hit) this.successes++;
    this.widths.push(width);
  }

  get coverage(): number {
    return this.total === 0 ? 0 : this.successes / this.total;
  }

  summary() {
    const ci = wilsonInterval(this.successes, this.total);
    return {
      successes: this.successes,
      total: this.total,
      coverage: this.coverage,
      wilsonLower: ci.lower,
      wilsonUpper: ci.upper,
      meanWidth: mean(this.widths),
      medianWidth: median(this.widths),
    };
  }
}

export type StratumSummary = ReturnType<Stratum['summary']>;

/** Tabla estrato → acumulador, creando el estrato al primer uso. */
export class StratumTable {
  private readonly map = new Map<string, Stratum>();

  get(key: string): Stratum {
    let s = this.map.get(key);
    if (s === undefined) {
      s = new Stratum();
      this.map.set(key, s);
    }
    return s;
  }

  /** Claves presentes, en el orden de `order` y luego el resto alfabético. */
  keys(order: readonly string[] = []): string[] {
    const present = [...this.map.keys()];
    const ranked = order.filter((k) => present.includes(k));
    const rest = present.filter((k) => !order.includes(k)).sort();
    return [...ranked, ...rest];
  }

  summaries(order: readonly string[] = []): Record<string, StratumSummary> {
    const out: Record<string, StratumSummary> = {};
    for (const k of this.keys(order)) out[k] = this.get(k).summary();
    return out;
  }
}
