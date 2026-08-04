/**
 * AURA v2 — Bounds de probabilidad del evento inseguro
 *
 * EXTENSIÓN al paper (docs/ERRATA.md §8): candidata a **Definición 5.5′** en la
 * v3, como segundo nivel del certificado junto al veredicto existencial de la
 * Definición 5.5.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ENUNCIADO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Sea E ⊆ ℝ el evento inseguro sobre la variable objetivo, y {(m(A), J_A)} el
 * conjunto credal propagado. Se definen
 *
 *     Bel(E) = Σ_{A : J_A ⊆ E}      m(A)
 *     Pl(E)  = Σ_{A : J_A ∩ E ≠ ∅}  m(A)
 *
 * Entonces, bajo H0-H3,   Bel(E) ≤ P(v* ∈ E) ≤ Pl(E).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DEMOSTRACIÓN
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * (1) SEMÁNTICA DE LA BPA. Por la Definición 3.2, la masa m(A) es la parte de
 *     la evidencia que sostiene "el valor real está en A" y nada más fino. La
 *     distribución real del valor de entrada admite por tanto la
 *     descomposición P* = Σ_A m(A) · P_A, con cada P_A soportada en A. (Es la
 *     misma lectura que define el conjunto credal de la Def. 3.8: repartir
 *     libremente la masa de cada A entre los θ_j ∈ A recorre exactamente sus
 *     puntos extremos.) Equivale a decir que hay una variable de rama Λ con
 *     P(Λ = A) = m(A) tal que, condicionado a Λ = A, el valor real está en A.
 *
 * (2) CADA RAMA CAE EN SU INTERVALO PROPAGADO. Condicionado a Λ = A, el valor
 *     real de entrada está en A ⊆ I_A (hull). Por el Teorema 4.1 —usando H2,
 *     |u_i| ≤ ε_i, que `propagateIntervals` materializa con el ⊕ [−ε_i, ε_i] de
 *     la Ec. (24)— el valor real de la variable objetivo está en J_A. Es decir:
 *
 *         P(v* ∈ E | Λ = A) = 0   si J_A ∩ E = ∅
 *         P(v* ∈ E | Λ = A) = 1   si J_A ⊆ E
 *         P(v* ∈ E | Λ = A) ∈ [0, 1]   en otro caso
 *
 * (3) LEY DE LA PROBABILIDAD TOTAL.
 *
 *         P(v* ∈ E) = Σ_A m(A) · P(v* ∈ E | Λ = A)
 *
 *     Acotando cada término por debajo con 0 salvo los de J_A ⊆ E (que valen
 *     exactamente 1) se obtiene P(v* ∈ E) ≥ Bel(E). Acotando por arriba con 1
 *     salvo los de J_A ∩ E = ∅ (que valen exactamente 0) se obtiene
 *     P(v* ∈ E) ≤ Pl(E). ∎
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DIRECCIÓN DE LA SOBRE-APROXIMACIÓN (por qué ensanchar es seguro)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Los J_A son SOBRE-aproximaciones: contienen la imagen exacta, y en general
 * estrictamente (wrapping effect de la Prop. 4.1, hull de un A no contiguo,
 * ⊕[−ε,ε] con ε holgado). Sustituir J_A por un J'_A ⊇ J_A:
 *
 *   · hace la CONTENCIÓN más difícil — J'_A ⊆ E implica J_A ⊆ E, pero no al
 *     revés — luego solo puede QUITAR términos a `belLower`: la cota inferior
 *     baja, y una cota inferior más baja sigue siendo válida;
 *   · hace la INTERSECCIÓN más fácil — J_A ∩ E ≠ ∅ implica J'_A ∩ E ≠ ∅ — luego
 *     solo puede AÑADIR términos a `plUpper`: la cota superior sube, y una cota
 *     superior más alta sigue siendo válida.
 *
 * Es decir: [belLower, plUpper] ⊇ [P̲(E), P̄(E)] reales. La imprecisión de la
 * Capa 2 ENSANCHA el intervalo de probabilidad, nunca lo desplaza fuera. Es la
 * dirección conservadora en ambos extremos, exactamente como la
 * sobre-aproximación del reachable set es conservadora para la Def. 5.5.
 *
 * Corolario práctico: `plUpper` pequeño es una afirmación FUERTE (ni siquiera
 * la sobre-aproximación deja sitio para que el evento sea probable), mientras
 * que `belLower` pequeño es una afirmación DÉBIL (puede serlo solo por
 * imprecisión). Por eso el certificado de dos niveles usa `plUpper` como señal
 * de escalado y no `belLower`.
 */

import { Interval } from '../intervals/types';
import { CredalIntervalSet, ProbabilityBounds } from './types';

/**
 * ¿[a] ⊆ [b]? Intervalos CERRADOS, sin tolerancia numérica — misma decisión que
 * `certifySafety`: una holgura ε aquí permitiría contar como "íntegramente
 * inseguro" un focal que sobresale, o al revés.
 */
const containedIn = (a: Interval, b: Interval): boolean =>
  a.lower >= b.lower && a.upper <= b.upper;

/** ¿[a] ∩ [b] ≠ ∅? Intervalos CERRADOS: tocarse por un extremo cuenta. */
const intersects = (a: Interval, b: Interval): boolean =>
  a.lower <= b.upper && a.upper >= b.lower;

/**
 * Clampea a [0, 1].
 *
 * Σ mass puede desviarse de 1 hasta `MASS_SUM_TOLERANCE` por acumulación
 * de coma flotante (la validación del constructor la acota, no la elimina), de
 * modo que una suma parcial puede salir 1 + 1e-16. Clampear es seguro en ambos
 * extremos: una probabilidad nunca está fuera de [0,1], luego recortar no puede
 * invalidar un bound —bajar `plUpper` a 1 sigue siendo cota superior, subir
 * `belLower` a 0 sigue siendo cota inferior—.
 */
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/**
 * Bounds [Bel(E), Pl(E)] del evento "la variable objetivo cae en
 * `unsafeRegion`".
 *
 * @param credalSet - Conjunto credal YA PROPAGADO sobre la variable objetivo
 *   (salida de `propagateCredalThroughDAG` + `credalSetAtNode`).
 * @param unsafeRegion - El evento E, como intervalo cerrado.
 *
 * Para el evento de la Definición 5.5 —violar la especificación de seguridad—
 * usa {@link unsafeProbabilityBounds}: ese evento es el COMPLEMENTO de la
 * región segura, que en general no es un intervalo.
 */
export function probabilityBounds(
  credalSet: CredalIntervalSet,
  unsafeRegion: Interval
): ProbabilityBounds {
  let belLower = 0;
  let plUpper = 0;

  for (const fe of credalSet.elements) {
    if (containedIn(fe.interval, unsafeRegion)) belLower += fe.mass;
    if (intersects(fe.interval, unsafeRegion)) plUpper += fe.mass;
  }

  return { belLower: clamp01(belLower), plUpper: clamp01(plUpper) };
}

/**
 * Bounds [Bel(E), Pl(E)] del evento inseguro de la **Definición 5.5**:
 *
 *     E = ℝ \ safeRegion = (−∞, s̲) ∪ (s̄, +∞)
 *
 * No es un intervalo, luego no se puede delegar en {@link probabilityBounds}.
 * Los dos predicados se escriben directamente contra la región segura, y son
 * exactamente los complementarios de los que usa `certifySafety`:
 *
 *     J ⊆ E        ⟺  J ∩ safeRegion = ∅   ⟺  J̄ < s̲  ∨  J̲ > s̄
 *     J ∩ E ≠ ∅    ⟺  ¬(J ⊆ safeRegion)    ⟺  J̲ < s̲  ∨  J̄ > s̄
 *
 * La región segura es CERRADA (Def. 5.4), luego el complemento es abierto y
 * tocar la frontera desde dentro no cuenta como violación — la misma
 * convención, y las mismas comparaciones estrictas, que `certifySafety`. De ahí
 * la consistencia entre los dos niveles del certificado:
 *
 *   · `plUpper` > 0 ⟹ algún J_A no está contenido en la región segura ⟹ el hull
 *     tampoco ⟹ el veredicto existencial es 'unsafe-possible';
 *   · 'proven-safe' (hull ⊆ safeRegion) ⟹ todo J_A ⊆ safeRegion ⟹ `plUpper` = 0.
 *
 * (Ambas requieren que el reachable set del certificado sea el hull del
 * conjunto credal propagado, que es lo que hace el pipeline.)
 */
export function unsafeProbabilityBounds(
  credalSet: CredalIntervalSet,
  safeRegion: Interval
): ProbabilityBounds {
  let belLower = 0;
  let plUpper = 0;

  for (const fe of credalSet.elements) {
    const { lower, upper } = fe.interval;

    // J enteramente fuera de la región segura ⟹ violación segura.
    if (upper < safeRegion.lower || lower > safeRegion.upper) belLower += fe.mass;

    // J no contenido en la región segura ⟹ violación posible.
    if (lower < safeRegion.lower || upper > safeRegion.upper) plUpper += fe.mass;
  }

  return { belLower: clamp01(belLower), plUpper: clamp01(plUpper) };
}

/**
 * Anchura de la ignorancia probabilística: Pl(E) − Bel(E).
 *
 * 0 = el conjunto credal determina la probabilidad del evento; 1 = ignorancia
 * total sobre él. Es el análogo continuo de `ignoranceWidth` (Capa 1).
 */
export function probabilityIgnorance(bounds: ProbabilityBounds): number {
  return bounds.plUpper - bounds.belLower;
}
