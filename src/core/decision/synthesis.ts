/**
 * AURA v2 — Síntesis de decisiones verificables
 *
 * Implements (papers/AURA_v2.pdf §5.5):
 * - Definición 5.5 (decisión certificada), Ecuación (31)
 * - Teorema 5.2 (corrección de la decisión)
 *
 * La Definición 5.5 es EXISTENCIAL: una decisión protectora está certificada
 * si ∃x ∈ R(t*) que viola la especificación de seguridad. No hay ninguna
 * magnitud ni probabilidad en el enunciado.
 *
 * La versión anterior colapsaba dos cosas incompatibles en un único número:
 * `violationFraction`, la fracción de LONGITUD del reachable set fuera de la
 * región segura, se comparaba contra `riskThreshold` como si fuera una
 * probabilidad de violación. No lo es: el reachable set es un conjunto
 * garantizado, sin medida de probabilidad asociada. Un intervalo alcanzable
 * que roza la región insegura en un 1% de su longitud contiene exactamente el
 * mismo hecho formal que uno que la invade al 90% — existe un escenario
 * alcanzable inseguro — y la Def. 5.5 dispara en ambos.
 *
 * Este módulo separa los dos conceptos:
 *   - `certifySafety`: el veredicto formal existencial de la Def. 5.5.
 *   - `severityScore`: la métrica continua de antes, marcada como heurística.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CERTIFICADO DE DOS NIVELES — EXTENSIÓN (docs/ERRATA.md §8)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * La separación anterior dejaba un hueco. Una vez H0 es honesta (docs/ERRATA.md
 * §5), la válvula de seguridad δ_i de la Def. 3.4 deja masa sobre Θ, Θ interseca
 * la hipótesis de cola, y el lifting de la Ec. (10) devuelve el rango completo
 * del marco CASI SIEMPRE. El veredicto existencial es entonces
 * 'unsafe-possible' casi siempre: sound, y vacuo.
 *
 * El nivel probabilístico llena ese hueco SIN tocar la semántica del nivel
 * existencial. `probabilityBounds` = [Bel(E), Pl(E)] del evento inseguro,
 * demostrados bajo las mismas H0-H3 (ver
 * src/core/credal-propagation/probability-bounds.ts). No es una tercera
 * heurística: es la segunda cosa demostrada del certificado.
 *
 * Jerarquía resultante, de más a menos fuerte:
 *   1. status                — demostrado, binario, existencial (Def. 5.5)
 *   2. probabilityBounds     — demostrado, continuo, probabilístico (Def. 5.5′)
 *   3. severity              — heurístico, geométrico, sin estatus formal
 */

import {
  SafetySpec,
  SafetyCertificate,
  CertifiedDecision,
  DecisionStatus,
  DeclaredDomainBound,
  EscalationBasis,
  CERTIFICATE_ASSUMPTIONS,
} from './types';
import { Interval } from '../intervals/types';
import { FrameOfDiscernment } from '../dempster-shafer/types';
import { ProbabilityBounds } from '../credal-propagation/types';

const fmt = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : String(x));
const fmtInterval = (iv: Interval): string => `[${fmt(iv.lower)}, ${fmt(iv.upper)}]`;
/** Probabilidades: notación exponencial, porque los plUpper útiles son ~1e-4. */
const fmtProb = (x: number): string => (x === 0 || x === 1 ? x.toFixed(0) : x.toExponential(3));

/**
 * Extrae los bounds de dominio declarados de los marcos de entrada, para
 * adjuntarlos al certificado como testigo material de H0.
 *
 * @see DeclaredDomainBound
 */
export function domainBoundsOf(
  frames: readonly FrameOfDiscernment[]
): DeclaredDomainBound[] {
  return frames.map((f) => ({
    variable: f.variable,
    unit: f.unit,
    domainBound: f.domainBound,
  }));
}

/**
 * Frase de H0 para la justificación textual del certificado.
 *
 * Con la lista vacía NO se calla: dice explícitamente que no hay marcos
 * declarados y que H0 queda sin auditar. El silencio es justamente el fallo que
 * esta capa corrige (docs/ERRATA.md §5).
 */
function describeDomainBounds(bounds: readonly DeclaredDomainBound[]): string {
  if (bounds.length === 0) {
    return (
      `H0 (soporte acotado) NO ES AUDITABLE en este certificado: no se declaró ` +
      `ningún marco de entrada, luego no consta qué límite físico se asumió para ` +
      `las variables que produjeron el reachable set.`
    );
  }
  const list = bounds
    .map((b) => `${b.variable} ≤ ${fmt(b.domainBound)} ${b.unit}`)
    .join('; ');
  return `Bajo H0 se asume soporte acotado de las entradas: ${list}.`;
}

/**
 * Valida la coherencia entre los dos niveles del certificado.
 *
 * Un certificado que se contradice a sí mismo es peor que uno incompleto, de
 * modo que se LANZA en vez de emitirlo. Las tres comprobaciones:
 *
 *  1. Los bounds son probabilidades: 0 ≤ belLower ≤ plUpper ≤ 1.
 *  2. 'proven-safe' ⟹ plUpper = 0. Si el reachable set no toca la región
 *     insegura, ningún elemento focal propagado puede tocarla (el reachable set
 *     es su hull), luego Pl(E) = 0. Un plUpper > 0 aquí significa que los bounds
 *     se computaron contra OTRA región o sobre OTRO conjunto credal.
 *  3. plUpper > 0 ⟹ 'unsafe-possible'. Es el contrarrecíproco de (2), y lo que
 *     hace que el nivel probabilístico nunca pueda "denunciar" un riesgo que el
 *     nivel existencial calla.
 *
 * La tolerancia 1e-12 es de coma flotante: cuando la implicación se cumple, la
 * suma es de cero términos y da 0 EXACTO; la holgura protege solo de un
 * `plUpper` construido a mano con residuo numérico.
 */
function assertCoherentProbabilityBounds(
  status: 'proven-safe' | 'unsafe-possible',
  pb: ProbabilityBounds
): void {
  const { belLower, plUpper } = pb;

  if (!Number.isFinite(belLower) || !Number.isFinite(plUpper)) {
    throw new Error(
      `certifySafety: probabilityBounds no finitos ([${belLower}, ${plUpper}]).`
    );
  }
  if (belLower < 0 || plUpper > 1 || belLower > plUpper) {
    throw new Error(
      `certifySafety: probabilityBounds inválidos ([${belLower}, ${plUpper}]). ` +
        `Deben cumplir 0 ≤ Bel(E) ≤ Pl(E) ≤ 1 (Def. 3.3, Ec. 1-2).`
    );
  }
  if (status === 'proven-safe' && plUpper > 1e-12) {
    throw new Error(
      `certifySafety: certificado incoherente. El veredicto existencial es ` +
        `'proven-safe' (reachable ⊆ región segura) pero Pl(evento inseguro) = ${plUpper} > 0. ` +
        `Si el reachable set no toca la región insegura, ningún elemento focal propagado ` +
        `puede tocarla: estos bounds se computaron contra otra región o sobre otro ` +
        `conjunto credal. Ver docs/ERRATA.md §8.`
    );
  }
}

/** Frase del nivel probabilístico para la justificación textual. */
function describeProbabilityBounds(pb: ProbabilityBounds | null): string {
  if (pb === null) {
    return (
      `NIVEL PROBABILÍSTICO NO DISPONIBLE: el certificado se emitió sin ruta credal ` +
      `(no hay conjunto credal propagado aguas arriba), luego no consta ningún bound ` +
      `[Bel(E), Pl(E)] del evento inseguro. El veredicto existencial es el único ` +
      `contenido formal de este certificado.`
    );
  }
  return (
    `NIVEL PROBABILÍSTICO (EXTENSIÓN a la Def. 5.5, ver docs/ERRATA.md §8): la ` +
    `probabilidad del evento inseguro está acotada por ` +
    `Bel(E) = ${fmtProb(pb.belLower)} ≤ P(E) ≤ Pl(E) = ${fmtProb(pb.plUpper)}, por ` +
    `propagación credal elemento focal a elemento focal (Def. 4.3 / Ec. 24 aplicada a ` +
    `cada elemento focal, con su masa intacta). Son bounds DEMOSTRADOS bajo las mismas ` +
    `H0-H3 que el veredicto existencial, no una heurística: los intervalos propagados ` +
    `sobre-aproximan, y sobre-aproximar solo puede quitar términos a Bel(E) y añadirlos ` +
    `a Pl(E), luego [Bel, Pl] contiene al intervalo de probabilidad real.`
  );
}

/**
 * Certifica formalmente la seguridad del reachable set contra la spec.
 *
 * Paper ref: Definición 5.5 / Ecuación (31), §5.5; corrección por Teorema 5.2.
 *
 * Decide entre dos estados por contención/intersección exacta de intervalos:
 *
 *   proven-safe      ⟺ reachable ⊆ safeRegion
 *   unsafe-possible  ⟺ reachable ∩ (ℝ \ safeRegion) ≠ ∅
 *
 * NO SE APLICA TOLERANCIA NUMÉRICA. Una holgura ε en la comparación
 * `reachable ⊆ safeRegion` permitiría emitir certificados 'proven-safe' para
 * reachable sets que sobresalen hasta ε de la región segura, que es
 * exactamente el fallo que un certificado debe excluir. Los casos frontera se
 * resuelven, por tanto, a favor del lado conservador: la región segura es
 * cerrada, luego tocar la frontera desde dentro es seguro y rebasarla en
 * cualquier cantidad positiva no lo es.
 *
 * HIPÓTESIS H0. El certificado registra los `domainBounds` de las variables de
 * entrada (docs/ERRATA.md §5). Son obligatorios y no tienen valor por defecto:
 * el reachable set procede de un conjunto credal, y ese conjunto credal solo
 * puede contener la realidad dentro del dominio que su marco declara. Emitir el
 * certificado sin registrar esos bounds volvería a hacer implícita la hipótesis
 * que esta capa existe para explicitar. Pasar `[]` es legítimo cuando no hay
 * marcos aguas arriba (el reachable set se da directamente), y entonces la
 * justificación declara que H0 no es auditable.
 *
 * NIVEL PROBABILÍSTICO. El cuarto parámetro es el segundo nivel del certificado
 * (docs/ERRATA.md §8) y es OBLIGATORIO aunque sea `null`, por la misma razón que
 * `domainBounds`: un parámetro opcional se olvida en silencio, y entonces el
 * certificado no distingue "no hay ruta credal" de "se me olvidó pasarla". Con
 * `null`, la justificación declara explícitamente que el nivel probabilístico no
 * está disponible.
 *
 * El nivel existencial NO cambia de semántica por la presencia de bounds: los
 * bounds no pueden convertir un 'unsafe-possible' en 'proven-safe' ni al revés.
 * Solo se comprueba su COHERENCIA con el veredicto, y se lanza si falla.
 *
 * @param reachableInterval - Intervalo del reachable set para la variable. Con
 *   ruta credal debe ser el HULL del conjunto credal propagado (`hullOf`), que
 *   es lo que hace consistentes los dos niveles.
 * @param spec - Especificación de seguridad
 * @param domainBounds - Bounds de dominio declarados de las variables de
 *   entrada (H0). Usa {@link domainBoundsOf} para derivarlos de los marcos.
 * @param probabilityBounds - [Bel(E), Pl(E)] del evento inseguro, o `null` si no
 *   hay ruta credal. Usa `unsafeProbabilityBounds` para derivarlos.
 * @throws si los bounds son incoherentes con el veredicto existencial.
 */
export function certifySafety(
  reachableInterval: Interval,
  spec: SafetySpec,
  domainBounds: readonly DeclaredDomainBound[],
  probabilityBounds: ProbabilityBounds | null
): SafetyCertificate {
  const { safeRegion } = spec;

  const contained =
    reachableInterval.lower >= safeRegion.lower && reachableInterval.upper <= safeRegion.upper;

  // Testigo existencial: las porciones del reachable set fuera de la región
  // segura. Es la evidencia que respalda un veredicto 'unsafe-possible'.
  const witness: Interval[] = [];
  if (reachableInterval.lower < safeRegion.lower) {
    witness.push({
      lower: reachableInterval.lower,
      upper: Math.min(reachableInterval.upper, safeRegion.lower),
    });
  }
  if (reachableInterval.upper > safeRegion.upper) {
    witness.push({
      lower: Math.max(reachableInterval.lower, safeRegion.upper),
      upper: reachableInterval.upper,
    });
  }

  const status = contained ? 'proven-safe' : 'unsafe-possible';
  if (probabilityBounds !== null) {
    assertCoherentProbabilityBounds(status, probabilityBounds);
  }

  const reach = fmtInterval(reachableInterval);
  const safe = fmtInterval(safeRegion);
  const h0 = describeDomainBounds(domainBounds);
  const pl = describeProbabilityBounds(probabilityBounds);
  const bounds = domainBounds.map((b) => ({ ...b }));
  const pb = probabilityBounds === null ? null : { ...probabilityBounds };

  // Cita del mecanismo probabilístico. Solo aparece cuando el nivel existe: un
  // certificado no debe citar como base una extensión que no ha usado.
  const credalBasis =
    probabilityBounds === null
      ? []
      : [
          'EXTENSIÓN a la Definición 5.5 — nivel probabilístico: bounds [Bel(E), Pl(E)] ' +
            'del evento inseguro por propagación credal por elementos focales. Candidata a ' +
            'Definición 5.5′ en la v3; ver docs/ERRATA.md §8.',
          'Definición 3.2 (BPA) y Definición 3.3 y Ec. (1)-(2) (Bel/Pl), §3.2 — aplicadas a ' +
            'la función de creencia imagen sobre el dominio continuo',
          'Teorema 4.1 (soundness de la propagación intervalar), §4.4.2 — aplicado a cada ' +
            'elemento focal por separado',
        ];

  if (contained) {
    return {
      status: 'proven-safe',
      reachableInterval,
      spec,
      witness: [],
      basis: [
        'Definición 5.5 (decisión certificada), §5.5',
        'Definición 5.3 (conjunto alcanzable R(t)), §5.5',
        'Teorema 5.1 (soundness de la propagación zonotópica), §5.4',
        'Teorema 5.2 (corrección de la decisión), §5.5',
        'Teorema 6.1 (soundness composicional end-to-end), §6.3',
        ...credalBasis,
      ],
      assumptions: CERTIFICATE_ASSUMPTIONS,
      domainBounds: bounds,
      probabilityBounds: pb,
      justification:
        `Reachable set ${reach} ⊆ región segura ${safe} para '${spec.variable}'. ` +
        `Por la soundness end-to-end (Teorema 6.1), el reachable set de la Def. 5.3 ` +
        `sobre-aproxima el conjunto de estados realmente alcanzables; como ni siquiera ` +
        `esa sobre-aproximación toca la región insegura, NINGÚN estado real puede ser ` +
        `inseguro. Certificado positivo en el sentido de la Def. 5.5, válido bajo ` +
        `H0 (soporte acotado) y H1–H3 del Teorema 6.1 (ver \`assumptions\`). ${h0} ${pl}`,
    };
  }

  return {
    status: 'unsafe-possible',
    reachableInterval,
    spec,
    witness,
    basis: [
      'Definición 5.5 (decisión certificada), §5.5',
      'Definición 5.3 (conjunto alcanzable R(t)), §5.5',
      'Teorema 5.2 (corrección de la decisión), §5.5',
      'Teorema 6.1 (soundness composicional end-to-end), §6.3',
      ...credalBasis,
    ],
    assumptions: CERTIFICATE_ASSUMPTIONS,
    domainBounds: bounds,
    probabilityBounds: pb,
    justification:
      `Reachable set ${reach} interseca la región insegura en ` +
      `${witness.map(fmtInterval).join(' ∪ ')} para '${spec.variable}' ` +
      `(región segura ${safe}). Existe al menos un escenario alcanzable que viola la ` +
      `especificación, luego la Def. 5.5 exige disparar la decisión protectora. ` +
      `IMPORTANTE: por ser el reachable set una sobre-aproximación, este veredicto ` +
      `NO demuestra que exista un estado real inseguro — demuestra que no puede ` +
      `descartarse. Válido bajo H0 (soporte acotado) y H1–H3 del Teorema 6.1 ` +
      `(ver \`assumptions\`). ${h0} ${pl}`,
  };
}

/**
 * Severidad heurística: fracción de la LONGITUD del reachable set que cae
 * fuera de la región segura.
 *
 * ⚠ MÉTRICA INFORMATIVA, NO FORMAL. No aparece en ningún teorema del paper y
 * no debe usarse para decidir seguridad. En particular NO es:
 *   - una probabilidad de violación (el reachable set no lleva medida asociada);
 *   - monótona respecto al riesgo físico (un rebase pequeño de una presión
 *     crítica puede ser mucho peor que uno grande de una variable benigna).
 *
 * Su único uso legítimo es ORDENAR alarmas ya declaradas inseguras por
 * {@link certifySafety}, para priorizar en la UI cuando hay muchas a la vez.
 *
 * Anteriormente se llamaba `violationFraction` y se comparaba contra
 * `riskThreshold` como si fuera probabilidad; ese uso ha desaparecido de la
 * capa formal.
 *
 * @returns Valor en [0, 1]. 0 = enteramente dentro; 1 = enteramente fuera.
 */
export function severityScore(reachableInterval: Interval, spec: SafetySpec): number {
  const { safeRegion } = spec;
  const reachWidth = reachableInterval.upper - reachableInterval.lower;

  const overlapLower = Math.max(reachableInterval.lower, safeRegion.lower);
  const overlapUpper = Math.min(reachableInterval.upper, safeRegion.upper);
  const overlapWidth = Math.max(0, overlapUpper - overlapLower);

  // Reachable set degenerado (un punto): la fracción de longitud es 0/0. La
  // versión anterior devolvía 0, lo que hacía parecer inocuo un punto
  // alcanzable situado ENTERAMENTE fuera de la región segura. Se resuelve por
  // pertenencia del punto.
  if (reachWidth <= 0) {
    const inside =
      reachableInterval.lower >= safeRegion.lower && reachableInterval.lower <= safeRegion.upper;
    return inside ? 0 : 1;
  }

  return 1 - overlapWidth / reachWidth;
}

/**
 * Sintetiza una decisión certificada comparando el reachable set contra la
 * safety spec.
 *
 * El certificado formal de la Def. 5.5 MANDA: nada puede convertir un caso
 * inseguro en seguro. Lo único que se decide aquí es el escalado de un
 * 'unsafe-possible' entre 'warning' y 'critical', y con qué señal:
 *
 *  (a) NIVEL PROBABILÍSTICO, si hay bounds y la spec declara
 *      `unsafeProbabilityThreshold` = p_crít:
 *
 *          plUpper ≥ p_crít  →  'critical'
 *          plUpper <  p_crít →  'warning'
 *
 *      A diferencia de la versión anterior, esto NO es una heurística: `plUpper`
 *      es un bound demostrado (docs/ERRATA.md §8), luego `plUpper < p_crít`
 *      DEMUESTRA que P(evento inseguro) < p_crít. La des-escalada tiene
 *      respaldo formal. En la dirección contraria puede sobre-escalar, porque
 *      `plUpper` sobre-estima — el error tolerable.
 *
 *  (b) SEVERIDAD HEURÍSTICA, si falta cualquiera de las dos cosas: la regla de
 *      siempre, `severity ≥ riskThreshold`. Sigue siendo una métrica geométrica
 *      sin estatus formal, y `severityScore` sigue existiendo aparte
 *      precisamente para que no se confunda con (a).
 *
 * `escalationBasis` registra cuál se usó: las dos señales tienen estatus
 * epistémico distinto y el certificado no debe difuminarlo.
 *
 * @param reachableInterval - Intervalo del reachable set para la variable
 * @param spec - Especificación de seguridad
 * @param domainBounds - Bounds de dominio declarados de las variables de
 *   entrada (H0); se propagan tal cual al certificado. Ver {@link certifySafety}.
 * @param probabilityBounds - [Bel(E), Pl(E)] del evento inseguro, o `null`.
 */
export function synthesizeDecision(
  reachableInterval: Interval,
  spec: SafetySpec,
  domainBounds: readonly DeclaredDomainBound[],
  probabilityBounds: ProbabilityBounds | null
): CertifiedDecision {
  const certificate = certifySafety(reachableInterval, spec, domainBounds, probabilityBounds);
  const severity = severityScore(reachableInterval, spec);

  const useProbability =
    probabilityBounds !== null && spec.unsafeProbabilityThreshold !== undefined;

  let status: DecisionStatus;
  let escalationBasis: EscalationBasis;

  if (certificate.status === 'proven-safe') {
    status = 'safe';
    escalationBasis = 'not-applicable';
  } else if (useProbability) {
    escalationBasis = 'probability-bound';
    status =
      probabilityBounds!.plUpper >= spec.unsafeProbabilityThreshold! ? 'critical' : 'warning';
  } else {
    escalationBasis = 'severity-heuristic';
    status = severity >= spec.riskThreshold ? 'critical' : 'warning';
  }

  return {
    certificate,
    status,
    reachableInterval,
    spec,
    severity,
    violationFraction: severity,
    probabilityBounds: certificate.probabilityBounds,
    escalationBasis,
    justification: certificate.justification,
    timestamp: Date.now(),
  };
}
