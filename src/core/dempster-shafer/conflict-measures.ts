/**
 * AURA v2 — Qué se mide cuando se dice «conflicto entre dos fuentes»
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ PROBLEMA RESUELVE ESTE FICHERO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * La entrada 9 de `docs/ERRATA.md` corrigió QUÉ MAGNITUD se compara con κ₁ y κ₂
 * (regla C1: el conflicto por pares, con K_global relegado a guardia de
 * degeneración). El hindcast sobre datos reales dejó ver que debajo había una
 * segunda pregunta, que aquella corrección no toca: **con qué escala** fueron
 * elegidos κ₁ y κ₂.
 *
 * El hecho medido, reproducible en tres líneas: tres BPAs gaussianas construidas
 * sobre la MISMA medición exacta —acuerdo perfecto, dispersión cero— con las σ
 * declaradas del hindcast (5,0 / 1,8 / 10,0 mm/h) dan
 *
 *     K_máx = 0,3651  >  κ₁ = 0,30       (las tres midiendo 0 mm/h)
 *
 * No hay desacuerdo físico que medir ahí: hay **discretización**. La fuente fina
 * concentra casi toda su masa en una hipótesis del marco y la gruesa la extiende
 * sobre tres; el solape es incompleto y K_ij > 0 por construcción. Como ese suelo
 * ya supera κ₁, la rama de Dempster es INALCANZABLE en todo el régimen de
 * intensidades bajas y medias — en las 264 horas de los dos eventos del hindcast
 * no se aplicó ni una sola vez.
 *
 * Dos componentes distintas viven dentro del mismo número K_ij:
 *
 *   K_ij  =  [ conflicto de discretización ]  ⊕  [ desacuerdo físico ]
 *
 * y la Definición 3.6 solo pretende gobernar la segunda. Este módulo separa la
 * **medida** por pares de la **regla** que la usa (`./conflict-rules.ts`), de
 * modo que la elección entre medidas sea otra vez un experimento y no una
 * opinión: `scripts/experiments/conflict-floor.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SEPARACIÓN ESTRUCTURAL — QUÉ CAMBIA Y QUÉ NO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * La medida gobierna **solo la decisión de informatividad** (la comparación con
 * κ₁ y κ₂). NO toca la **guardia de degeneración** de la regla C1, que sigue
 * operando sobre el K_global **CRUDO**:
 *
 *   · la explosión 1/(1−K) que las propiedades (P2)/(P2′) previenen es una
 *     propiedad del K crudo del producto conjunto, no de ninguna reescala;
 *   · una medida que reste un suelo puede acercarse a 0 con K_global ≈ 1, y si
 *     gobernara la guardia la desactivaría justo donde hace falta.
 *
 * Consecuencia comprobada en `__tests__/core/dempster-shafer/conflict-measures.test.ts`:
 * el contraejemplo del ciclo va a envolvente **por la guardia** bajo las tres
 * medidas, incluidas las que le asignan un conflicto bajo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PUNTEROS DE LITERATURA (nombres y conceptos, NO citas)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Se anotan como punteros a formalizar en la fase de paper; aquí no se afirma
 * ninguna referencia concreta ni se le atribuye a nadie un enunciado literal:
 *
 *  · **distancia de Jousselme** — la métrica sobre BPAs construida con la matriz
 *    de Jaccard del marco, que es exactamente {@link JOUSSELME}/{@link MEASURE_D2};
 *  · **auto-conflicto (self-conflict) de Martin / Osswald** — la observación de
 *    que K(m, m) > 0 para una BPA no categórica, es decir, que el K escalar
 *    atribuye conflicto a una fuente consigo misma;
 *  · **crítica de Liu al K escalar** — que un solo número K no distingue las
 *    situaciones que la regla de Dempster trata de forma distinta, y que hace
 *    falta acompañarlo de una medida de distancia entre las BPAs.
 *
 * El suelo que aquí se mide es un pariente del auto-conflicto pero NO es el
 * mismo objeto: no es K(m, m) sino K(m_i(x̂), m_j(x̂)) con **σ distintas**. El
 * auto-conflicto es su caso particular σ_i = σ_j.
 */

import { createBPAFromGaussian } from './bpa';
import { BPA, FusionConfig } from './types';

/** Identificador estable de una medida. Es clave de configuración y de salida. */
export type ConflictMeasureId = 'D0' | 'D1' | 'D2';

export const CONFLICT_MEASURE_IDS = ['D0', 'D1', 'D2'] as const;

/**
 * Una forma de puntuar el desacuerdo de un PAR de fuentes.
 *
 * Deliberadamente por pares y no n-aria: la Definición 3.6 compara κ₁ y κ₂ con
 * una magnitud por pares (Definición 3.5), y el objeto de esta interfaz es
 * cambiar esa magnitud sin cambiar los umbrales ni la aridad.
 *
 * Toda medida debe cumplir, y está testeado para las tres:
 *   · rango [0, 1];
 *   · simetría `pair(a, b) = pair(b, a)` **hasta el redondeo IEEE-754**. D2 la
 *     cumple bit a bit (suma en orden canónico); D0 y D1 pueden diferir en un
 *     ulp porque `pairwiseConflict` recorre el producto de elementos focales en
 *     el orden de sus argumentos y la suma en coma flotante no es asociativa.
 *     Es la salvedad de `docs/ERRATA.md` §3, y no llega a la decisión:
 *     `assessConflict` computa cada par una sola vez (i < j) y espeja la
 *     matriz;
 *   · independencia del orden de los elementos focales dentro de cada BPA.
 */
export interface PairwiseConflictMeasure {
  id: ConflictMeasureId;
  /** Una línea para tablas y salidas de experimento. */
  label: string;
  /** Valor de la medida para el par. */
  pair(a: BPA, b: BPA): number;
  /**
   * Suelo del par bajo esta medida: el valor que la medida CRUDA (K_ij) daría
   * si las dos fuentes hubieran medido exactamente lo mismo. `null` en las
   * medidas que no lo definen (D0 y D2), y por tanto no lo publican.
   */
  floor(a: BPA, b: BPA): number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// D0 — el K de la Ecuación (6)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcula el factor de conflicto K entre dos BPAs.
 *
 * Paper ref: Ecuación (6), §3.4.1 (y entrada K_ij de la Definición 3.5).
 * K = Σ_{B∩C=∅} m1(B) · m2(C)
 *
 * Vive en este módulo, y no en `./conflict.ts`, porque es literalmente la
 * medida D0 y porque las otras dos se construyen sobre él; `./conflict.ts` lo
 * reexporta para que su nombre siga estando donde la Definición 3.5 lo pone.
 *
 * @returns K ∈ [0, 1). K=0 significa acuerdo total, K→1 contradicción total.
 */
export function pairwiseConflict(bpa1: BPA, bpa2: BPA): number {
  let conflict = 0;

  for (const fe1 of bpa1.focalElements) {
    for (const fe2 of bpa2.focalElements) {
      // Comprobar si la intersección es vacía
      const intersection = fe1.indices.filter((i) => fe2.indices.includes(i));
      if (intersection.length === 0) {
        conflict += fe1.mass * fe2.mass;
      }
    }
  }

  return conflict;
}

// ─────────────────────────────────────────────────────────────────────────────
// D1 — exceso sobre el suelo de discretización
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valor de referencia x̂ de un par, ponderado por PRECISIÓN (w ∝ 1/σ²).
 *
 *     x̂ = (x_i/σ_i² + x_j/σ_j²) / (1/σ_i² + 1/σ_j²)
 *
 * Es el estimador de máxima verosimilitud de una media común con varianzas
 * conocidas — el mismo que usa el baseline «Kalman estático» de la campaña—, y
 * se elige por eso: es el punto en que las dos fuentes ESTARÍAN de acuerdo si
 * todo su desacuerdo fuese ruido de medición.
 *
 * CASO LÍMITE tratado a mano, y por qué. Con `xa === xb` se devuelve `xa` TAL
 * CUAL en lugar de evaluar la fórmula. En ℝ son el mismo número (w_i + w_j = 1),
 * pero en coma flotante `w_i·x + w_j·x` no es exactamente `x`, y de esa
 * diferencia de un ulp saldría un K_floor distinto del K_ij observado y un
 * K_excess de 1e-16 donde la propiedad (i) exige CERO EXACTO. La propiedad es lo
 * que hace que la medida signifique algo; se protege en la construcción.
 */
export function precisionWeightedReference(
  xa: number,
  sa: number,
  xb: number,
  sb: number
): number {
  if (xa === xb) return xa;
  const pa = 1 / (sa * sa);
  const pb = 1 / (sb * sb);
  return (pa * xa + pb * xb) / (pa + pb);
}

/**
 * K_floor del par: el conflicto que existiría SIN ningún desacuerdo.
 *
 * Se construyen las dos BPAs otra vez, cada una con su propia σ y su propia δ
 * pero AMBAS sobre el mismo valor x̂ = {@link precisionWeightedReference}, y se
 * mide su K. Todo lo que quede ahí es discretización: dos gaussianas centradas
 * en el mismo punto pero de anchura distinta reparten esa misma medición de
 * forma distinta sobre las hipótesis del marco.
 *
 * SIN PROCEDENCIA NO HAY SUELO. Una BPA que no venga de la Definición 3.4 —una
 * envolvente sintética, una BPA generada por property testing, una fusionada—
 * no tiene un (valor, σ) del que reconstruir nada. En ese caso se devuelve
 * `null` y {@link excessConflict} usa suelo 0, con lo que D1 **degrada
 * exactamente a D0**. Es la dirección conservadora: sin información para
 * separar discretización de desacuerdo, no se resta nada.
 */
export function structuralFloor(a: BPA, b: BPA): number | null {
  const pa = a.provenance;
  const pb = b.provenance;
  if (pa === undefined || pb === undefined) return null;

  const x = precisionWeightedReference(pa.value, pa.stddev, pb.value, pb.stddev);

  const fa = createBPAFromGaussian(a.frame, x, pa.stddev, pa.failureRate, a.sourceId, a.timestamp);
  const fb = createBPAFromGaussian(b.frame, x, pb.stddev, pb.failureRate, b.sourceId, b.timestamp);

  return pairwiseConflict(fa, fb);
}

/**
 * D1 — conflicto en EXCESO sobre el suelo, normalizado.
 *
 *     K_excess = máx(0, (K − K_floor) / (1 − K_floor))
 *
 * La normalización por (1 − K_floor) no es cosmética: K_floor es la masa
 * conjunta que cae en intersecciones vacías **antes de que exista desacuerdo
 * alguno**, de modo que solo queda (1 − K_floor) de masa disponible para que el
 * desacuerdo la mueva. Dividir por ella devuelve la medida al rango completo
 * [0, 1] y hace que «la mitad del conflicto disponible» signifique lo mismo con
 * un suelo de 0,05 que con uno de 0,60 — que es exactamente lo que κ₁ y κ₂
 * necesitan para ser transportables entre despliegues con σ distintas.
 *
 * PROPIEDADES (demostradas aquí, testeadas en
 * `__tests__/core/dempster-shafer/conflict-measures.test.ts`):
 *
 *  (i)  **Mediciones idénticas ⇒ K_excess = 0 EXACTAMENTE.** Con x_i = x_j se
 *       tiene x̂ = x_i por el caso límite de {@link precisionWeightedReference},
 *       luego las BPAs del suelo son bit a bit las BPAs originales y
 *       K_floor = K. El numerador es un cero exacto, no un 1e-16.
 *
 *  (ii) **K_excess ∈ [0, 1].** El `máx(0, ·)` cierra por abajo. Por arriba:
 *       K ≤ 1 ⟹ K − K_floor ≤ 1 − K_floor, y el cociente de dos no negativos
 *       con numerador ≤ denominador está en [0, 1].
 *
 *  (iii) **K_excess ≤ K siempre.** Porque
 *            (K − K_floor)/(1 − K_floor) ≤ K
 *        ⟺  K − K_floor ≤ K − K·K_floor
 *        ⟺  K_floor·(K − 1) ≤ 0,
 *        cierto para todo K ≤ 1. Con σ_i = σ_j y mediciones muy separadas,
 *        K → 1 y el cociente → 1: el exceso vuelve a acercarse al K crudo, que
 *        es lo que debe pasar cuando el desacuerdo es real y grande.
 *
 * CASO K_floor = 1, documentado y tratado: el denominador se anula. Significa
 * que las dos fuentes son estructuralmente incapaces de coincidir sobre este
 * marco ni midiendo lo mismo, y entonces NINGUNA parte del conflicto observado
 * es atribuible a desacuerdo. Se devuelve **0**, que es la lectura literal de
 * «cuánto conflicto hay por encima del que habría con acuerdo perfecto». No es
 * una situación alcanzable con BPAs gaussianas sobre un marco que cubra el
 * dominio —siempre queda solape en la hipótesis de x̂—, pero se cierra
 * explícitamente porque un NaN silencioso aquí decidiría la estrategia de
 * fusión por azar de propagación.
 */
export function excessConflict(a: BPA, b: BPA): number {
  const floor = structuralFloor(a, b);
  const k = pairwiseConflict(a, b);
  return floor === null ? k : normalizedExcess(k, floor);
}

/**
 * La aritmética de D1, aislada de las BPAs.
 *
 *     máx(0, (k − floor) / (1 − floor))       con el caso floor = 1 → 0
 *
 * Vive aparte por una razón concreta: el caso `floor ≥ 1` es INALCANZABLE con
 * BPAs de la Definición 3.4 sobre un marco que cubra el dominio —las dos
 * gaussianas están centradas en el mismo x̂ y comparten al menos la hipótesis que
 * lo contiene, luego siempre queda solape—, y un caso límite que no se puede
 * construir es un caso límite que no se puede testear a través de la función que
 * lo contiene. Separándolo, la rama se comprueba directamente en lugar de
 * quedar documentada y sin verificar.
 */
export function normalizedExcess(k: number, floor: number): number {
  if (floor >= 1) return 0;
  const excess = (k - floor) / (1 - floor);
  return excess <= 0 ? 0 : excess >= 1 ? 1 : excess;
}

// ─────────────────────────────────────────────────────────────────────────────
// D2 — distancia de Jousselme
// ─────────────────────────────────────────────────────────────────────────────

/** Clave canónica de un elemento focal: índices ordenados. */
const focalKey = (indices: readonly number[]): string =>
  [...indices].sort((x, y) => x - y).join(',');

/** Masas de una BPA agregadas por elemento focal canónico. */
function massByFocal(bpa: BPA): Map<string, number> {
  const map = new Map<string, number>();
  for (const fe of bpa.focalElements) {
    const key = focalKey(fe.indices);
    map.set(key, (map.get(key) ?? 0) + fe.mass);
  }
  return map;
}

/**
 * Índice de Jaccard de dos elementos focales: |A∩B| / |A∪B|.
 *
 * Es la matriz D que hace de la distancia de Jousselme una métrica genuina
 * sobre BPAs y no una distancia euclídea ciega a la estructura del marco: dos
 * fuentes que apuestan por hipótesis SOLAPADAS quedan más cerca que dos que
 * apuestan por hipótesis disjuntas, aunque sus vectores de masa disten lo mismo.
 *
 * D(∅, ∅) = 1 por convención; no se alcanza aquí porque m(∅) = 0 en toda BPA
 * válida (Definición 3.2).
 */
export function jaccard(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const setB = new Set(b);
  let inter = 0;
  for (const x of a) if (setB.has(x)) inter++;
  const union = a.length + b.length - inter;
  return union === 0 ? 1 : inter / union;
}

/**
 * D2 — distancia de Jousselme entre dos BPAs sobre el mismo marco.
 *
 *     d_J(m₁, m₂) = √( ½ · (m₁ − m₂)ᵀ · D · (m₁ − m₂) )
 *
 * con D la matriz de Jaccard sobre los elementos focales (ver {@link jaccard}).
 * Es la alternativa establecida en la literatura al K escalar (punteros en el
 * encabezado del módulo: distancia de Jousselme, crítica de Liu).
 *
 * POR QUÉ ES CANDIDATA AQUÍ. **d_J(m, m) = 0 por construcción**: la diferencia
 * de una BPA consigo misma es el vector nulo. El auto-conflicto —K(m,m) > 0 para
 * toda BPA no categórica, el fenómeno que Martin y Osswald nombran— desaparece
 * sin restar nada y sin necesidad de conocer la procedencia de la BPA.
 *
 * ⚠ LO QUE NO ELIMINA, y hay que decirlo antes de medir nada: d_J anula el
 * auto-conflicto, pero **el suelo del hindcast NO es auto-conflicto**. Allí las
 * dos BPAs son distintas —misma medición, σ distintas— y su distancia no tiene
 * por qué ser cero. D2 ataca por tanto una parte del problema, no
 * necesariamente toda; cuánta es exactamente la parte es lo que mide el
 * experimento pre-registrado, no este comentario.
 *
 * PROPIEDADES (testeadas): d_J(m, m) = 0; simetría exacta; rango [0, 1].
 *
 * @returns d_J ∈ [0, 1], recortado en los extremos para absorber el redondeo de
 *          la forma cuadrática (que puede dar −1e-17 con dos BPAs iguales).
 */
export function jousselmeDistance(a: BPA, b: BPA): number {
  const ma = massByFocal(a);
  const mb = massByFocal(b);

  // ORDEN CANÓNICO, y no es cosmético: la forma cuadrática se suma en este
  // orden, y en coma flotante la suma no es asociativa. Sin ordenar, d_J(a,b) y
  // d_J(b,a) difieren en un ulp porque el conjunto unión sale en el orden de
  // inserción de cada mapa — la simetría dejaría de ser exacta, y con ella el
  // determinismo de cualquier salida que dependa del orden de las fuentes.
  const keys = [...new Set([...ma.keys(), ...mb.keys()])].sort();
  const diff = keys.map((k) => (ma.get(k) ?? 0) - (mb.get(k) ?? 0));
  const sets = keys.map((k) => (k === '' ? [] : k.split(',').map(Number)));

  let quadratic = 0;
  for (let i = 0; i < keys.length; i++) {
    if (diff[i] === 0) continue;
    for (let j = 0; j < keys.length; j++) {
      if (diff[j] === 0) continue;
      quadratic += diff[i] * diff[j] * jaccard(sets[i], sets[j]);
    }
  }

  const d = Math.sqrt(Math.max(0, quadratic / 2));
  return d >= 1 ? 1 : d;
}

// ─────────────────────────────────────────────────────────────────────────────
// Registro
// ─────────────────────────────────────────────────────────────────────────────

/**
 * D0 — el conflicto de la Ecuación (6) tal cual. La medida vigente hasta esta
 * iteración y la referencia contra la que se comparan las otras dos: incluye el
 * suelo de discretización, que es exactamente lo que se está midiendo.
 */
export const MEASURE_D0: PairwiseConflictMeasure = {
  id: 'D0',
  label: 'D0 · K_ij crudo (Ec. 6, Def. 3.5)',
  pair: pairwiseConflict,
  floor: () => null,
};

/** D1 — {@link excessConflict}. */
export const MEASURE_D1: PairwiseConflictMeasure = {
  id: 'D1',
  label: 'D1 · exceso normalizado sobre el suelo: máx(0, (K−K_floor)/(1−K_floor))',
  pair: excessConflict,
  floor: structuralFloor,
};

/** D2 — {@link jousselmeDistance}. */
export const MEASURE_D2: PairwiseConflictMeasure = {
  id: 'D2',
  label: 'D2 · distancia de Jousselme d_J(m_i, m_j) (matriz de Jaccard)',
  pair: jousselmeDistance,
  floor: () => null,
};

/** Nombre corto de la construcción de D2, para la traza de los experimentos. */
export const JOUSSELME = 'jousselme';

export const CONFLICT_MEASURES: Readonly<Record<ConflictMeasureId, PairwiseConflictMeasure>> = {
  D0: MEASURE_D0,
  D1: MEASURE_D1,
  D2: MEASURE_D2,
};

/**
 * Resuelve la medida de una configuración.
 *
 * @throws si el identificador no existe. Mismo criterio que `ruleOf`: un typo en
 *         `FusionConfig.measure` no debe caer en silencio a la medida por
 *         defecto, porque cambiaría la estrategia de fusión de todo el pipeline
 *         sin que nadie se entere.
 */
export function measureOf(config: Pick<FusionConfig, 'measure'>): PairwiseConflictMeasure {
  const measure = CONFLICT_MEASURES[config.measure];
  if (measure === undefined) {
    throw new Error(
      `medida de conflicto desconocida: '${String(config.measure)}'. ` +
        `Disponibles: ${CONFLICT_MEASURE_IDS.join(', ')}.`
    );
  }
  return measure;
}

/** Matriz simétrica n×n de la medida, con diagonal 0. */
export function measureMatrix(bpas: BPA[], measure: PairwiseConflictMeasure): number[][] {
  const n = bpas.length;
  const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const v = measure.pair(bpas[i], bpas[j]);
      matrix[i][j] = v;
      matrix[j][i] = v;
    }
  }
  return matrix;
}

/**
 * Matriz de suelos K_floor, o `null` si la medida no define suelo o si ningún
 * par tiene procedencia gaussiana de la que reconstruirlo.
 *
 * La diagonal lleva el suelo de la fuente CONSIGO MISMA, que es el
 * auto-conflicto K(m_i, m_i): se publica porque es la magnitud con la que se
 * separa «suelo por heterogeneidad de σ» de «suelo por discretización de una
 * sola fuente», y las dos aparecen en el hindcast.
 */
export function floorMatrix(
  bpas: BPA[],
  measure: PairwiseConflictMeasure
): number[][] | null {
  const n = bpas.length;
  const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  let any = false;

  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const v = measure.floor(bpas[i], bpas[j]);
      if (v === null) continue;
      any = true;
      matrix[i][j] = v;
      matrix[j][i] = v;
    }
  }

  return any ? matrix : null;
}
