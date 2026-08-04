/**
 * AURA v2 — Linearización automática y cota de Lagrange
 *
 * Implements: Teorema 5.1 (propagación zonotópica de una función no lineal),
 * Ecuaciones (28)-(29), papers/AURA_v2.pdf §5.4.
 *
 * `propagateNonlinear` (propagation.ts) delega en el llamador la construcción
 * de la jacobiana y de la cota del resto de Lagrange. Nada en aquel módulo
 * verifica que la cota suministrada sea válida, de modo que un llamador
 * descuidado rompe la soundness del pipeline completo sin que salte ningún
 * error. Este módulo cierra ese hueco: calcula ambos objetos a partir
 * únicamente de `f` y del zonotopo de entrada.
 *
 * Descomposición de Taylor de primer orden con resto de Lagrange, para
 * x = c + Σᵢ εᵢ gᵢ ∈ Z:
 *
 *   f(x) = f(c) + J(c)·(x - c) + R(x),   ‖R(x)‖ ≤ L · ‖x - c‖² / 2
 *
 * donde L es la constante de la Ecuación (28) del Teorema 5.1:
 *
 *   ‖Df(x) - Df(c)‖ ≤ L · ‖x - c‖,   ∀x ∈ Z
 *
 * es decir, la constante de Lipschitz de la JACOBIANA (equivalentemente, una
 * cota de la norma del hessiano) sobre Z — no la de f. Que esta condición se
 * cumpla dentro del zonotope de trabajo es exactamente la hipótesis H3 del
 * Teorema 6.1 (§6.3). Como ‖x - c‖ ≤ Σᵢ ‖gᵢ‖ =: r_Z, el Teorema 5.1 usa la
 * cota uniforme
 *
 *   ‖R(x)‖ ≤ L · r_Z² / 2   para todo x ∈ Z.
 *
 * ────────────────────────────────────────────────────────────────────────
 * ADVERTENCIA DE SOUNDNESS (leer antes de usar en producción)
 * ────────────────────────────────────────────────────────────────────────
 * L se ESTIMA POR MUESTREO de la variación de la jacobiana sobre Z. Un
 * muestreo finito produce una cota inferior del supremo real, no una cota
 * superior certificada. Por tanto:
 *
 *   - `propagateNonlinearAuto` es MUCHO más seguro que pasar a mano una cota
 *     inventada, pero NO constituye una prueba formal de contención.
 *   - `safetyFactor` (default 1.5) infla la estimación para absorber el hueco
 *     entre el supremo muestreado y el real. Es una salvaguarda heurística.
 *   - Para una garantía formal se necesita aritmética de intervalos sobre el
 *     hessiano (o una cota analítica de f''). Véase la nota TODO al final.
 *
 * Para funciones con hessiano constante (polinomios de grado ≤ 2) el muestreo
 * SÍ es exacto: la variación de la jacobiana es lineal y cualquier par de
 * puntos distintos recupera L exactamente.
 */

import { Zonotope } from './types';
import { propagateNonlinear } from './propagation';
import { Interval } from '../intervals/types';

/** Paso por defecto de las diferencias centrales (relativo a la escala de c). */
export const DEFAULT_STEP = 1e-5;

/** Número por defecto de puntos internos aleatorios usados al estimar L. */
export const DEFAULT_SAMPLES = 64;

/**
 * Factor de seguridad por defecto aplicado a la L estimada.
 *
 * El muestreo subestima el supremo de ‖∇²f‖ sobre Z; este factor compensa
 * ese sesgo. No es una cota rigurosa, es una salvaguarda ingenieril.
 */
export const DEFAULT_SAFETY_FACTOR = 1.5;

export interface LinearizationOptions {
  /** Paso de las diferencias centrales. Default {@link DEFAULT_STEP}. */
  h?: number;
  /** Puntos internos aleatorios al estimar L. Default {@link DEFAULT_SAMPLES}. */
  samples?: number;
  /** Multiplicador de seguridad sobre L. Default {@link DEFAULT_SAFETY_FACTOR}. */
  safetyFactor?: number;
  /** Tope de vértices enumerados del zonotopo. Default 256. */
  maxVertices?: number;
  /** Semilla del PRNG, para que el muestreo sea reproducible. Default 0x5EED. */
  seed?: number;
}

/**
 * Generador congruencial lineal determinista.
 *
 * Se usa un PRNG propio con semilla en vez de `Math.random` para que dos
 * ejecuciones con la misma entrada produzcan la misma cota. Una cota de
 * soundness que fluctúa entre ejecuciones no es auditable.
 */
function makeRng(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    // Constantes de Numerical Recipes (LCG de 32 bits).
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function norm2(v: number[]): number {
  return Math.sqrt(v.reduce((s, x) => s + x * x, 0));
}

function distance(a: number[], b: number[]): number {
  return Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) * (x - b[i]), 0));
}

/**
 * Jacobiana numérica por diferencias centrales.
 *
 *   J[i][j] = (f_i(c + h·e_j) - f_i(c - h·e_j)) / (2h)
 *
 * El paso se escala con |c_j| para mantener la precisión relativa cuando las
 * componentes tienen magnitudes muy distintas (p.ej. presión en Pa frente a
 * un coeficiente adimensional).
 *
 * Error de truncamiento O(h²), frente a O(h) de las diferencias hacia
 * adelante: por eso se usan centrales.
 *
 * @param f - Función f: ℝⁿ → ℝᵐ
 * @param c - Punto de evaluación (típicamente el centro del zonotopo)
 * @param h - Paso relativo. Default {@link DEFAULT_STEP}
 * @returns Matriz m×n como array de m filas
 */
export function numericalJacobian(
  f: (x: number[]) => number[],
  c: number[],
  h: number = DEFAULT_STEP
): number[][] {
  if (h <= 0) throw new Error('numericalJacobian: h must be positive');

  const n = c.length;
  // columns[j] = ∂f/∂x_j, vector de longitud m
  const columns: number[][] = [];

  for (let j = 0; j < n; j++) {
    const hj = h * Math.max(1, Math.abs(c[j]));
    const forward = [...c];
    const backward = [...c];
    forward[j] += hj;
    backward[j] -= hj;

    const fp = f(forward);
    const fm = f(backward);
    if (fp.length !== fm.length) {
      throw new Error('numericalJacobian: f returned inconsistent output dimensions');
    }
    columns.push(fp.map((v, i) => (v - fm[i]) / (2 * hj)));
  }

  const m = columns[0]?.length ?? 0;
  if (m === 0) throw new Error('numericalJacobian: f must return a non-empty vector');

  // Transponer columnas → filas
  return Array.from({ length: m }, (_, i) => columns.map((col) => col[i]));
}

/**
 * Genera un conjunto de puntos representativo del zonotopo Z.
 *
 * Combina tres familias, porque cada una cubre un fallo distinto del muestreo:
 *   1. El centro: punto de linearización.
 *   2. Vértices extremos vía generadores (εᵢ = ±1): la curvatura suele ser
 *      máxima en la frontera, y el centro solo nunca la detecta.
 *   3. Puntos internos aleatorios: pares cercanos entre sí dan buenas
 *      estimaciones locales de la segunda derivada en el interior.
 *
 * Con k generadores hay 2^k vértices. Si 2^k excede `maxVertices` se
 * enumeran los 2k vértices axiales (c ± gᵢ) más combinaciones de signo
 * aleatorias hasta el tope.
 */
export function sampleZonotope(
  z: Zonotope,
  samples: number = DEFAULT_SAMPLES,
  options: Pick<LinearizationOptions, 'maxVertices' | 'seed'> = {}
): number[][] {
  const { maxVertices = 256, seed = 0x5eed } = options;
  const rng = makeRng(seed);
  const k = z.generators.length;

  const fromEpsilons = (eps: number[]): number[] =>
    z.center.map((c, i) => c + z.generators.reduce((s, g, r) => s + eps[r] * g[i], 0));

  const points: number[][] = [[...z.center]];

  if (k > 0) {
    const totalVertices = Math.pow(2, k);
    if (totalVertices <= maxVertices) {
      // Enumeración exhaustiva de los 2^k vértices.
      for (let mask = 0; mask < totalVertices; mask++) {
        const eps = Array.from({ length: k }, (_, r) => ((mask >> r) & 1 ? 1 : -1));
        points.push(fromEpsilons(eps));
      }
    } else {
      // Vértices axiales: c ± gᵢ (aisla la contribución de cada generador).
      for (let r = 0; r < k; r++) {
        const plus = new Array(k).fill(0);
        const minus = new Array(k).fill(0);
        plus[r] = 1;
        minus[r] = -1;
        points.push(fromEpsilons(plus), fromEpsilons(minus));
      }
      // Completar con vértices de signo aleatorio.
      const extra = Math.max(0, maxVertices - 2 * k);
      for (let s = 0; s < extra; s++) {
        points.push(fromEpsilons(Array.from({ length: k }, () => (rng() < 0.5 ? -1 : 1))));
      }
    }

    // Puntos internos: εᵢ ~ U(-1, 1).
    for (let s = 0; s < samples; s++) {
      points.push(fromEpsilons(Array.from({ length: k }, () => 2 * rng() - 1)));
    }
  }

  return points;
}

/**
 * Estima la constante de Lipschitz de la jacobiana de `f` sobre el zonotopo `z`,
 * por dimensión de salida.
 *
 * Para cada par de puntos muestreados (p, q) con p ≠ q y cada salida i:
 *
 *   L_i ≥ ‖J_i(p) - J_i(q)‖₂ / ‖p - q‖₂
 *
 * y se toma el máximo sobre todos los pares, multiplicado por `safetyFactor`.
 * Esta L_i es exactamente la constante que aparece en el resto de Lagrange del
 * Teorema 5.1 (no es la constante de Lipschitz de f, sino la de su jacobiana).
 *
 * NO ES UNA COTA CERTIFICADA: el máximo sobre un conjunto finito de pares es
 * una cota INFERIOR del supremo sobre Z. Véase la advertencia de la cabecera
 * del módulo.
 *
 * @param f - Función f: ℝⁿ → ℝᵐ
 * @param z - Zonotopo sobre el que se estima la variación
 * @param samples - Puntos internos aleatorios. Default {@link DEFAULT_SAMPLES}
 * @param options - Paso, factor de seguridad, tope de vértices, semilla
 * @returns L_i para cada una de las m dimensiones de salida
 */
export function estimateLipschitz(
  f: (x: number[]) => number[],
  z: Zonotope,
  samples: number = DEFAULT_SAMPLES,
  options: Omit<LinearizationOptions, 'samples'> = {}
): number[] {
  const {
    h = DEFAULT_STEP,
    safetyFactor = DEFAULT_SAFETY_FACTOR,
    maxVertices = 256,
    seed = 0x5eed,
  } = options;

  if (safetyFactor < 1) {
    throw new Error('estimateLipschitz: safetyFactor must be >= 1 to remain conservative');
  }

  const points = sampleZonotope(z, samples, { maxVertices, seed });
  const jacobians = points.map((p) => numericalJacobian(f, p, h));

  const m = jacobians[0].length;
  const lipschitz = new Array<number>(m).fill(0);

  // Umbral por debajo del cual la separación entre puntos es comparable al
  // ruido de las diferencias finitas; dividir por ella amplificaría ruido.
  const minSeparation = 1e-9;

  for (let a = 0; a < points.length; a++) {
    for (let b = a + 1; b < points.length; b++) {
      const d = distance(points[a], points[b]);
      if (d < minSeparation) continue;

      for (let i = 0; i < m; i++) {
        const rowA = jacobians[a][i];
        const rowB = jacobians[b][i];
        const gradDiff = norm2(rowA.map((v, j) => v - rowB[j]));
        const ratio = gradDiff / d;
        if (ratio > lipschitz[i]) lipschitz[i] = ratio;
      }
    }
  }

  return lipschitz.map((L) => L * safetyFactor);
}

/**
 * Calcula la cota del resto de Lagrange L · r_Z² / 2 por dimensión de salida.
 *
 * Paper ref: Teorema 5.1, Ecuación (29), §5.4.
 *
 * r_Z = Σᵢ ‖gᵢ‖₂ es el radio del zonotopo, exactamente como lo define el
 * Teorema 5.1 ("computable como r_Z = Σᵢ ‖gᵢ‖"): acota ‖x - c‖₂ para todo
 * x ∈ Z, ya que
 * ‖Σᵢ εᵢ gᵢ‖₂ ≤ Σᵢ |εᵢ| ‖gᵢ‖₂ ≤ Σᵢ ‖gᵢ‖₂ con εᵢ ∈ [-1, 1].
 *
 * La cota se devuelve como intervalo simétrico [-b_i, +b_i] porque el resto
 * puede tener cualquier signo: es una cota en valor absoluto.
 *
 * @returns Un Interval por dimensión de salida, listo para `propagateNonlinear`
 */
export function lagrangeRemainderBound(
  f: (x: number[]) => number[],
  z: Zonotope,
  samples: number = DEFAULT_SAMPLES,
  options: Omit<LinearizationOptions, 'samples'> = {}
): Interval[] {
  const lipschitz = estimateLipschitz(f, z, samples, options);

  // r_Z = Σ ‖g_i‖₂
  const radius = z.generators.reduce((s, g) => s + norm2(g), 0);
  const halfRadiusSquared = (radius * radius) / 2;

  return lipschitz.map((L) => {
    const bound = L * halfRadiusSquared;
    return { lower: -bound, upper: bound };
  });
}

/**
 * Cota del error que introduce usar una jacobiana NUMÉRICA en lugar de la
 * exacta, por dimensión de salida.
 *
 * Hallado por property-based testing (__tests__/properties/nonlinear-propagation
 * .property.test.ts): el Teorema 5.1 supone J = Df(c) exacta. Con diferencias
 * centrales, J̃ arrastra error de truncamiento O(h²·f''') y, sobre todo, de
 * redondeo ≈ ε·|f| / (h·|∂f|). El término lineal computado es entonces
 * J̃·G en vez de J·G, y la diferencia sobre el zonotope llega a
 *
 *   ‖(J̃ - J)·(x - c)‖ ≤ ‖J̃ - J‖ · r_Z
 *
 * Para f casi lineal la cota de Lagrange vale ≈ 0 y no absorbe nada, de modo
 * que el zonotope de salida podía quedar ESTRICTAMENTE MÁS ESTRECHO que f(Z):
 * una violación real de la Ecuación (29), aunque de orden 1e-8 relativo. Se
 * observó un ratio de conservatismo ρ̂ = 0,99999997 < 1.
 *
 * ‖J̃ - J‖ se estima por paso doble (estilo Richardson): para diferencias
 * centrales el error escala con h², luego ‖J(h) - J(2h)‖ es del orden de
 * 3·‖J(h) - J‖. Usar la diferencia completa sin dividir por 3 deja el
 * estimador del lado conservador.
 */
export function jacobianUncertaintyBound(
  f: (x: number[]) => number[],
  z: Zonotope,
  h: number = DEFAULT_STEP
): number[] {
  const J1 = numericalJacobian(f, z.center, h);
  const J2 = numericalJacobian(f, z.center, 2 * h);
  const radius = z.generators.reduce((s, g) => s + norm2(g), 0);

  return J1.map((row, i) => norm2(row.map((v, j) => v - J2[i][j])) * radius);
}

/**
 * Suelo de redondeo: cota del error de coma flotante acumulado al construir el
 * zonotope de salida (evaluar f(c), formar J·G y sumar el hull).
 *
 * Sin este término, una f exactamente lineal con jacobiana analítica todavía
 * podría perder el último ulp al sumar generadores. Es proporcional a la
 * magnitud del resultado, no absoluto, para no ensanchar artificialmente
 * problemas bien escalados.
 */
function roundoffFloor(center: number[], generators: number[][]): number[] {
  return center.map((c, i) => {
    const spread = generators.reduce((s, g) => s + Math.abs(g[i]), 0);
    return 16 * Number.EPSILON * (Math.abs(c) + spread);
  });
}

export interface AutoPropagationOptions extends LinearizationOptions {
  /**
   * Jacobiana analítica en el centro, si se conoce. Evita el error de
   * truncamiento de las diferencias centrales. La cota de Lagrange se sigue
   * estimando por muestreo.
   */
  jacobian?: number[][];
}

/**
 * Propaga un zonotopo a través de f: ℝⁿ → ℝᵐ calculando automáticamente la
 * jacobiana y la cota del resto de Lagrange.
 *
 * Esta es la variante recomendada: el llamador no puede olvidarse de la cota
 * ni equivocarse al calcularla. Delega en {@link propagateNonlinear} una vez
 * construidos ambos argumentos.
 *
 * Paper ref: Teorema 5.1 completo (condición de Lipschitz Eq (28) + zonotope
 * imagen Eq (29)), §5.4.
 *
 * Coste: O((V + S)²·m) comparaciones de jacobianas y (V + S)·2n evaluaciones
 * de f, donde V son los vértices muestreados y S los puntos internos. Para
 * zonotopos con muchos generadores conviene bajar `maxVertices` y `samples`,
 * asumiendo el riesgo de subestimar L.
 *
 * Recuerda: la contención resultante es empíricamente robusta, no certificada.
 * Véase la advertencia de la cabecera del módulo.
 */
export function propagateNonlinearAuto(
  z: Zonotope,
  f: (x: number[]) => number[],
  options: AutoPropagationOptions = {}
): Zonotope {
  const { h = DEFAULT_STEP, samples = DEFAULT_SAMPLES, jacobian } = options;

  const J = jacobian ?? numericalJacobian(f, z.center, h);
  const lagrange = lagrangeRemainderBound(f, z, samples, options);

  if (J.length !== lagrange.length) {
    throw new Error(
      `propagateNonlinearAuto: jacobian has ${J.length} rows but f returns ${lagrange.length} outputs`
    );
  }

  // Error de la jacobiana numérica. Si el llamador aporta una jacobiana
  // analítica exacta este término no aplica.
  const jacError = jacobian ? lagrange.map(() => 0) : jacobianUncertaintyBound(f, z, h);

  // Suelo de redondeo sobre el zonotope linealizado que va a construirse.
  const linearGenerators = z.generators.map((g) =>
    J.map((row) => row.reduce((s, a, j) => s + a * g[j], 0))
  );
  const floor = roundoffFloor(f(z.center), linearGenerators);

  const errorBound: Interval[] = lagrange.map((lb, i) => {
    const total = lb.upper + jacError[i] + floor[i];
    return { lower: -total, upper: total };
  });

  return propagateNonlinear(z, f, J, errorBound);
}

/*
 * TODO (soundness formal): sustituir `estimateLipschitz` por una cota rigurosa.
 * Dos vías, en orden de esfuerzo creciente:
 *   1. Permitir que el llamador pase una cota analítica de ‖∇²f‖ sobre Z
 *      (trivial para las f del modelo hidráulico: Darcy-Weisbach, k·√P, etc.).
 *   2. Aritmética de intervalos sobre el hessiano (extensión natural de
 *      src/core/intervals/arithmetic.ts), que sí produce una cota superior
 *      certificada y cerraría el hueco del Teorema 5.1 de verdad.
 *
 * Mientras tanto, H3 del Teorema 6.1 se asume, no se verifica. El paper ya lo
 * reconoce como hipótesis ("H3 se viola si la dinámica tiene discontinuidades
 * o no-linealidades extremas dentro del zonotope de trabajo", §6.3); lo que
 * este módulo aporta es una estimación defendible de L, no su demostración.
 */
