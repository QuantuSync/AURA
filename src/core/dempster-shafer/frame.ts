/**
 * AURA v2 — Construcción y validación de marcos de discernimiento
 *
 * Implementa (papers/AURA_v2.pdf):
 * - Definición 3.1 (marco de discernimiento Θ), §3.2
 * - Definición 3.9 y Ecuación (10) (lifting continuo), §3.6 — a través del
 *   bound superior efectivo de cada hipótesis.
 *
 * EXTENSIÓN al paper (docs/ERRATA.md §5): el marco lleva un
 * {@link FrameOfDiscernment.domainBound} obligatorio que cierra su última
 * hipótesis. Este módulo es el único punto donde esa declaración se valida, y
 * `createFrame` es la vía canónica de construir un marco: un literal escrito a
 * mano satisface el tipo pero no pasa por la validación.
 */

import { FrameOfDiscernment, Hypothesis } from './types';

/** Especificación de un marco: lo mismo que el marco, con `hypotheses` legible. */
export interface FrameSpec {
  variable: string;
  unit: string;
  hypotheses: Hypothesis[];
  /** P_máx — ver {@link FrameOfDiscernment.domainBound}. */
  domainBound: number;
}

/**
 * Valida un marco de discernimiento — Definición 3.1 + H0 (soporte acotado).
 *
 * LANZA en vez de corregir. Un marco mal declarado invalida todo certificado
 * emitido aguas abajo, de modo que degradar en silencio (recortar el bound,
 * inventar un default) sería exactamente el fallo que esta iteración corrige.
 *
 * Comprobaciones:
 *  1. El marco tiene al menos una hipótesis.
 *  2. `domainBound` es finito y estrictamente mayor que el inicio de la última
 *     hipótesis (si no, la última hipótesis sería vacía o estaría invertida y
 *     el marco dejaría de ser exhaustivo sobre su propio dominio).
 *  3. Si la última hipótesis tiene un `upper` finito, debe COINCIDIR con
 *     `domainBound`: dos declaraciones distintas del mismo hecho físico son
 *     una contradicción, no una preferencia.
 *  4. Las hipótesis son contiguas y crecientes (mutuamente excluyentes y
 *     exhaustivas sobre [a₀, domainBound], como exige la Definición 3.1).
 */
export function validateFrame(frame: FrameOfDiscernment): void {
  const { variable, hypotheses, domainBound } = frame;
  const where = `marco '${variable}'`;

  if (!hypotheses || hypotheses.length === 0) {
    throw new Error(`${where}: un marco de discernimiento necesita al menos una hipótesis (Def. 3.1)`);
  }

  const last = hypotheses[hypotheses.length - 1];

  if (!Number.isFinite(domainBound)) {
    throw new Error(
      `${where}: domainBound debe ser un número finito (recibido ${domainBound}). ` +
        `Es el límite físico declarado de la variable, la hipótesis H0 del certificado; ` +
        `sin él la Ecuación (10) devuelve +∞ y el conjunto credal es inutilizable ` +
        `aguas abajo. Ver docs/ERRATA.md §5.`
    );
  }

  if (domainBound <= last.lower) {
    throw new Error(
      `${where}: domainBound (${domainBound}) debe ser estrictamente mayor que el ` +
        `inicio de la última hipótesis '${last.label}' (${last.lower}); en otro caso ` +
        `esa hipótesis sería vacía y el marco no sería exhaustivo.`
    );
  }

  if (Number.isFinite(last.upper) && last.upper !== domainBound) {
    throw new Error(
      `${where}: la última hipótesis '${last.label}' declara upper = ${last.upper} y el ` +
        `marco declara domainBound = ${domainBound}. Son el mismo hecho físico declarado ` +
        `dos veces con valores distintos: corrige uno de los dos.`
    );
  }

  for (let j = 0; j < hypotheses.length; j++) {
    const h = hypotheses[j];
    if (!Number.isFinite(h.lower)) {
      throw new Error(`${where}: la hipótesis '${h.label}' tiene lower no finito (${h.lower})`);
    }
    const upper = j === hypotheses.length - 1 ? domainBound : h.upper;
    if (!(upper > h.lower)) {
      throw new Error(
        `${where}: la hipótesis '${h.label}' es vacía o está invertida ([${h.lower}, ${upper}])`
      );
    }
    if (j > 0 && hypotheses[j - 1].upper !== h.lower) {
      throw new Error(
        `${where}: las hipótesis deben ser contiguas (Def. 3.1: mutuamente excluyentes y ` +
          `exhaustivas). '${hypotheses[j - 1].label}' termina en ${hypotheses[j - 1].upper} ` +
          `y '${h.label}' empieza en ${h.lower}.`
      );
    }
  }
}

/**
 * Construye un marco de discernimiento validado — Definición 3.1 + H0.
 *
 * Normaliza además la última hipótesis cerrándola en `domainBound`, de modo que
 * un marco construido aquí NO contiene `Infinity` en ninguna parte y el lifting
 * de la Ecuación (10) es finito por construcción.
 *
 * @throws si el marco viola cualquiera de las comprobaciones de
 *         {@link validateFrame}.
 */
export function createFrame(spec: FrameSpec): FrameOfDiscernment {
  const frame: FrameOfDiscernment = {
    variable: spec.variable,
    unit: spec.unit,
    hypotheses: spec.hypotheses.map((h) => ({ ...h })),
    domainBound: spec.domainBound,
  };

  validateFrame(frame);

  // Cerrar la cola: [a_n, ∞) → [a_n, domainBound]. Idempotente cuando ya venía
  // cerrada, porque `validateFrame` exige entonces la igualdad.
  const last = frame.hypotheses[frame.hypotheses.length - 1];
  frame.hypotheses[frame.hypotheses.length - 1] = { ...last, upper: spec.domainBound };

  return frame;
}

/**
 * Bound superior EFECTIVO de la hipótesis j — el b_j de la Ecuación (10).
 *
 * Devuelve `domainBound` para cualquier hipótesis cuyo `upper` declarado no sea
 * finito. Con marcos construidos por {@link createFrame} esto no cambia nada
 * (ya vienen cerrados); existe para que un marco escrito como literal, que
 * satisface el tipo sin haber pasado por la validación, no reintroduzca `+∞` en
 * el lifting por la puerta de atrás.
 */
export function hypothesisUpper(frame: FrameOfDiscernment, j: number): number {
  const declared = frame.hypotheses[j].upper;
  return Number.isFinite(declared) ? declared : frame.domainBound;
}

/** Rango completo del marco: [a₀, domainBound]. */
export function frameRange(frame: FrameOfDiscernment): { lower: number; upper: number } {
  return { lower: frame.hypotheses[0].lower, upper: frame.domainBound };
}
