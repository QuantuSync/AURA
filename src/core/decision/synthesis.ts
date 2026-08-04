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
 */

import {
  SafetySpec,
  SafetyCertificate,
  CertifiedDecision,
  DecisionStatus,
  DeclaredDomainBound,
  CERTIFICATE_ASSUMPTIONS,
} from './types';
import { Interval } from '../intervals/types';
import { FrameOfDiscernment } from '../dempster-shafer/types';

const fmt = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : String(x));
const fmtInterval = (iv: Interval): string => `[${fmt(iv.lower)}, ${fmt(iv.upper)}]`;

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
 * @param reachableInterval - Intervalo del reachable set para la variable
 * @param spec - Especificación de seguridad
 * @param domainBounds - Bounds de dominio declarados de las variables de
 *   entrada (H0). Usa {@link domainBoundsOf} para derivarlos de los marcos.
 */
export function certifySafety(
  reachableInterval: Interval,
  spec: SafetySpec,
  domainBounds: readonly DeclaredDomainBound[]
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

  const reach = fmtInterval(reachableInterval);
  const safe = fmtInterval(safeRegion);
  const h0 = describeDomainBounds(domainBounds);
  const bounds = domainBounds.map((b) => ({ ...b }));

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
      ],
      assumptions: CERTIFICATE_ASSUMPTIONS,
      domainBounds: bounds,
      justification:
        `Reachable set ${reach} ⊆ región segura ${safe} para '${spec.variable}'. ` +
        `Por la soundness end-to-end (Teorema 6.1), el reachable set de la Def. 5.3 ` +
        `sobre-aproxima el conjunto de estados realmente alcanzables; como ni siquiera ` +
        `esa sobre-aproximación toca la región insegura, NINGÚN estado real puede ser ` +
        `inseguro. Certificado positivo en el sentido de la Def. 5.5, válido bajo ` +
        `H0 (soporte acotado) y H1–H3 del Teorema 6.1 (ver \`assumptions\`). ${h0}`,
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
    ],
    assumptions: CERTIFICATE_ASSUMPTIONS,
    domainBounds: bounds,
    justification:
      `Reachable set ${reach} interseca la región insegura en ` +
      `${witness.map(fmtInterval).join(' ∪ ')} para '${spec.variable}' ` +
      `(región segura ${safe}). Existe al menos un escenario alcanzable que viola la ` +
      `especificación, luego la Def. 5.5 exige disparar la decisión protectora. ` +
      `IMPORTANTE: por ser el reachable set una sobre-aproximación, este veredicto ` +
      `NO demuestra que exista un estado real inseguro — demuestra que no puede ` +
      `descartarse. Válido bajo H0 (soporte acotado) y H1–H3 del Teorema 6.1 ` +
      `(ver \`assumptions\`). ${h0}`,
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
 * Combina las dos capas: el certificado formal de la Def. 5.5 manda, y la
 * severidad heurística solo escala 'unsafe-possible' entre 'warning' y
 * 'critical' para priorización. La severidad NUNCA puede convertir un caso
 * inseguro en seguro.
 *
 * @param reachableInterval - Intervalo del reachable set para la variable
 * @param spec - Especificación de seguridad
 * @param domainBounds - Bounds de dominio declarados de las variables de
 *   entrada (H0); se propagan tal cual al certificado. Ver {@link certifySafety}.
 */
export function synthesizeDecision(
  reachableInterval: Interval,
  spec: SafetySpec,
  domainBounds: readonly DeclaredDomainBound[]
): CertifiedDecision {
  const certificate = certifySafety(reachableInterval, spec, domainBounds);
  const severity = severityScore(reachableInterval, spec);

  const status: DecisionStatus =
    certificate.status === 'proven-safe'
      ? 'safe'
      : severity >= spec.riskThreshold
        ? 'critical'
        : 'warning';

  return {
    certificate,
    status,
    reachableInterval,
    spec,
    severity,
    violationFraction: severity,
    justification: certificate.justification,
    timestamp: Date.now(),
  };
}
