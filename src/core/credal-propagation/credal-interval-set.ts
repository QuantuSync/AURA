/**
 * AURA v2 — Construcción del conjunto credal intervalar
 *
 * EXTENSIÓN al paper (docs/ERRATA.md §8): es el Puente 1→2 con la estructura
 * credal INTACTA, frente al de la Definición 3.9 / Ecuación (10), que colapsa
 * el conjunto credal a su soporte externo y con ello lo vacía de contenido
 * en cuanto la válvula de seguridad δ_i de la Def. 3.4 deja masa sobre Θ.
 *
 * Ambos puentes coexisten y son coherentes: `hullOf` del conjunto construido
 * aquí es EXACTAMENTE el intervalo de la Ec. (10) (ver la nota de `hullOf`).
 * El nuevo no sustituye al viejo, lo refina.
 */

import { BPA, FusionResult, FrameOfDiscernment } from '../dempster-shafer/types';
import { hypothesisUpper } from '../dempster-shafer/frame';
import { Interval } from '../intervals/types';
import {
  CredalIntervalSet,
  CredalPropagationConfig,
  DEFAULT_CREDAL_PROPAGATION_CONFIG,
  FocalInterval,
  FrameRef,
  MASS_SUM_TOLERANCE,
} from './types';

/** Procedencia de un marco — el testigo de H0 que acompaña al conjunto. */
export function frameRefOf(frame: FrameOfDiscernment): FrameRef {
  return { variable: frame.variable, unit: frame.unit, domainBound: frame.domainBound };
}

/**
 * Constructor VALIDADO de un conjunto credal intervalar.
 *
 * Es la única vía legítima de crear uno: un literal satisface el tipo pero no
 * el invariante Σ mass = 1, y unos bounds de probabilidad calculados sobre masa
 * que no suma 1 no acotan ninguna probabilidad.
 *
 * @throws si no hay elementos, si alguna masa es negativa o no finita, si algún
 *         intervalo está invertido o no es finito, si Σ mass se aparta de 1 más
 *         de {@link MASS_SUM_TOLERANCE}, o si se excede
 *         `config.maxFocalElements`.
 */
export function createCredalIntervalSet(
  elements: readonly FocalInterval[],
  frameRef: FrameRef,
  config: CredalPropagationConfig = DEFAULT_CREDAL_PROPAGATION_CONFIG,
  nodeId?: string
): CredalIntervalSet {
  const where = `conjunto credal intervalar de '${frameRef.variable}'`;

  if (elements.length === 0) {
    throw new Error(
      `${where}: no tiene elementos focales. Una BPA de la Def. 3.2 tiene masa ` +
        `total 1, luego al menos un elemento focal; un conjunto vacío no representa ` +
        `ninguna función de creencia.`
    );
  }

  if (elements.length > config.maxFocalElements) {
    throw new Error(
      `${where}: ${elements.length} elementos focales exceden el límite ` +
        `maxFocalElements = ${config.maxFocalElements}. El coste de la propagación ` +
        `credal es lineal en este número (ver CredalPropagationConfig); súbelo ` +
        `explícitamente si asumes el coste, en lugar de degradar a un único intervalo.`
    );
  }

  let total = 0;
  for (const [i, fe] of elements.entries()) {
    if (!Number.isFinite(fe.mass) || fe.mass < 0) {
      throw new Error(`${where}: el elemento focal ${i} tiene masa inválida (${fe.mass}); debe ser finita y ≥ 0.`);
    }
    if (!Number.isFinite(fe.interval.lower) || !Number.isFinite(fe.interval.upper)) {
      throw new Error(
        `${where}: el elemento focal ${i} tiene un intervalo no finito ` +
          `[${fe.interval.lower}, ${fe.interval.upper}]. Un marco construido con ` +
          `\`createFrame\` cierra su cola en domainBound; ver docs/ERRATA.md §5.`
      );
    }
    if (fe.interval.lower > fe.interval.upper) {
      throw new Error(
        `${where}: el elemento focal ${i} tiene el intervalo invertido ` +
          `[${fe.interval.lower}, ${fe.interval.upper}].`
      );
    }
    total += fe.mass;
  }

  if (Math.abs(total - 1) > MASS_SUM_TOLERANCE) {
    throw new Error(
      `${where}: la masa total es ${total}, que se aparta de 1 más de la tolerancia ` +
        `de coma flotante ${MASS_SUM_TOLERANCE}. La Def. 3.2 exige Σ_{A⊆Θ} m(A) = 1; ` +
        `unos bounds [Bel, Pl] calculados sobre masa que no suma 1 no acotan ninguna ` +
        `probabilidad. Se prefiere lanzar a renormalizar en silencio.`
    );
  }

  return {
    elements: elements.map((fe) => ({ mass: fe.mass, interval: { ...fe.interval } })),
    frameRef: { ...frameRef },
    ...(nodeId !== undefined ? { nodeId } : {}),
  };
}

/**
 * Eleva una BPA a conjunto credal intervalar: cada elemento focal A se mapea a
 * su HULL continuo.
 *
 *     I_A = [ mín_{θ_j ∈ A} a_j , máx_{θ_j ∈ A} b_j ]
 *
 * con b_j el bound superior EFECTIVO de la hipótesis j — el mismo de la
 * Ecuación (10), vía `hypothesisUpper`, que devuelve `domainBound` para la cola
 * (H0, soporte acotado declarado; docs/ERRATA.md §5).
 *
 * SOBRE-APROXIMACIÓN DEL HULL. Para un A no contiguo, I_A contiene puntos que
 * no están en ninguna hipótesis de A. Es sound: el valor real, dado que la
 * evidencia lo sitúa en A, está en A ⊆ I_A. Y la dirección es la conservadora
 * en ambos bounds de probabilidad (ver `probabilityBounds`). Un tratamiento
 * exacto exigiría propagar uniones de intervalos por el DAG, lo que multiplica
 * el coste sin cambiar la dirección de la garantía.
 */
export function credalIntervalSetFromBPA(
  bpa: BPA,
  config: CredalPropagationConfig = DEFAULT_CREDAL_PROPAGATION_CONFIG
): CredalIntervalSet {
  const frame = bpa.frame;

  const elements: FocalInterval[] = bpa.focalElements.map((fe) => {
    if (fe.indices.length === 0) {
      // m(∅) = 0 por construcción (Def. 3.2). Un focal vacío no tiene hull.
      throw new Error(
        `conjunto credal intervalar de '${frame.variable}': la BPA contiene un elemento ` +
          `focal vacío, y la Def. 3.2 exige m(∅) = 0.`
      );
    }
    let lower = Infinity;
    let upper = -Infinity;
    for (const j of fe.indices) {
      if (j < 0 || j >= frame.hypotheses.length) {
        throw new Error(
          `conjunto credal intervalar de '${frame.variable}': índice de hipótesis ${j} ` +
            `fuera del marco (${frame.hypotheses.length} hipótesis).`
        );
      }
      lower = Math.min(lower, frame.hypotheses[j].lower);
      upper = Math.max(upper, hypothesisUpper(frame, j));
    }
    return { mass: fe.mass, interval: { lower, upper } };
  });

  return createCredalIntervalSet(elements, frameRefOf(frame), config);
}

/**
 * Eleva el resultado de fusión (Def. 3.6) a conjunto credal intervalar.
 *
 * RUTA DE ENVOLVENTE (alto conflicto, K_decision > κ₂). Se usa igualmente la
 * BPA sintética de `envelopeCombine`, no la envolvente exacta de la Def. 3.7:
 * la envolvente es un box de bounds [Bel, Pl] POR HIPÓTESIS y no lleva
 * asignación de masa, luego no hay elementos focales que propagar. La BPA
 * sintética sí los tiene, y sus masas son CONSERVADORAS respecto de la
 * envolvente exacta:
 *
 *   · a cada singleton le asigna mín_i Bel_i({θ_j}), que es exactamente el
 *     lower de la Ec. (8): no inventa creencia;
 *   · manda TODO el resto de la masa a Θ, cuyo hull es el rango completo del
 *     marco. Esa masa cuenta siempre para `plUpper` y nunca para `belLower`,
 *     que es la dirección conservadora en ambos extremos.
 *
 * El precio es informatividad —Pl_sintética({θ_j}) ≥ máx_i Pl_i({θ_j}), en
 * general estricto (ver el JSDoc de `envelopeCombine`)— y el precio es el
 * correcto: con conflicto alto el sistema debe perder informatividad, no
 * ganarla.
 */
export function toCredalIntervalSet(
  source: FusionResult | BPA,
  config: CredalPropagationConfig = DEFAULT_CREDAL_PROPAGATION_CONFIG
): CredalIntervalSet {
  const bpa: BPA = 'fused' in source ? source.fused : source;
  return credalIntervalSetFromBPA(bpa, config);
}

/**
 * Hull del conjunto: el menor intervalo que contiene todos los elementos
 * focales.
 *
 * COINCIDE CON LA ECUACIÓN (10) para el conjunto de entrada, y no por
 * casualidad:
 *
 *   (⊆) Todo I_A está contenido en el lifting de la Ec. (10): si m(A) > 0,
 *       cada θ_j ∈ A tiene Pl(θ_j) ≥ m(A) > 0, luego I_j entra en la unión.
 *   (⊇) Toda hipótesis con Pl(θ_j) > 0 pertenece a algún A con m(A) > 0, luego
 *       I_j ⊆ I_A ⊆ hull.
 *
 * De ahí que esta capa REFINE la Def. 3.9 sin contradecirla: el soporte es el
 * mismo, lo que se recupera es la distribución de masa dentro de él.
 *
 * Tras propagar por el DAG el hull puede ser MÁS ESTRECHO que propagar
 * directamente el intervalo de la Ec. (10), por monotonía de la inclusión de
 * las extensiones intervalares: f(⋃ I_A) ⊇ ⋃ f(I_A). Sigue siendo un
 * sobre-conjunto de los estados alcanzables —el valor real cae en algún A con
 * probabilidad total 1— luego es un reachable set legítimo para la Def. 5.5.
 */
export function hullOf(set: CredalIntervalSet): Interval {
  let lower = Infinity;
  let upper = -Infinity;
  for (const fe of set.elements) {
    lower = Math.min(lower, fe.interval.lower);
    upper = Math.max(upper, fe.interval.upper);
  }
  return { lower, upper };
}

/** Σ m(A) — debe ser 1 ± {@link MASS_SUM_TOLERANCE} por el invariante. */
export function totalMass(set: CredalIntervalSet): number {
  return set.elements.reduce((s, fe) => s + fe.mass, 0);
}
