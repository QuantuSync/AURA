/**
 * AURA v2 — Decision Types
 *
 * Tipos para la síntesis de decisiones verificables desde el reachable set.
 *
 * Se distinguen DOS capas que antes estaban mezcladas en un único campo:
 *
 *   1. Capa formal ({@link SafetyCertificate}): veredicto binario existencial
 *      según la Definición 5.5. Es lo único que tiene respaldo demostrativo.
 *   2. Capa heurística ({@link CertifiedDecision.severity}): métrica continua
 *      para priorizar en UI. NO es una probabilidad ni tiene estatus formal.
 */

import { Interval } from '../intervals/types';

export interface SafetySpec {
  /** Variable a verificar */
  variable: string;
  /** Intervalo seguro CERRADO: la variable debe permanecer en este rango */
  safeRegion: Interval;
  /**
   * Umbral de severidad heurística por encima del cual una situación
   * 'unsafe-possible' se escala de 'warning' a 'critical'.
   *
   * OJO: no es un umbral de probabilidad. Solo modula la PRIORIZACIÓN de un
   * caso ya declarado inseguro por {@link SafetyCertificate}; nunca convierte
   * un caso inseguro en seguro.
   */
  riskThreshold: number;
}

/**
 * Veredicto formal de seguridad — Definición 5.5.
 *
 * - 'proven-safe':     reachable ⊆ safeRegion. Certificado positivo: por la
 *                      soundness de la cadena de propagación, NINGÚN estado
 *                      realmente alcanzable puede ser inseguro.
 * - 'unsafe-possible': reachable ∩ (complemento de safeRegion) ≠ ∅. Existe un
 *                      escenario alcanzable inseguro → dispara la decisión
 *                      protectora según Def. 5.5.
 *
 * La asimetría es deliberada y esencial: el reachable set SOBRE-aproxima los
 * estados alcanzables, luego 'proven-safe' es una demostración, mientras que
 * 'unsafe-possible' es la AUSENCIA de demostración — no prueba que exista un
 * estado real inseguro. No hay tercer estado: la contención de intervalos es
 * decidible, de modo que 'unknown' no puede darse en esta capa.
 */
export type CertificationStatus = 'proven-safe' | 'unsafe-possible';

/**
 * Hipótesis H1–H3 del Teorema 6.1 (Soundness composicional de AURA),
 * de las que depende TODO certificado emitido por esta capa.
 *
 * Transcritas literalmente de papers/AURA_v2.pdf, Sección 6.3, Teorema 6.1.
 *
 * El propio paper subraya que "el Teorema 6.1 no dice «AURA siempre acierta».
 * Dice: «AURA acierta si se cumplen H1-H3»". Por eso cada certificado las
 * arrastra explícitamente: un certificado sin sus hipótesis no es auditable.
 */
export const THEOREM_6_1_HYPOTHESES = [
  'H1 (Cobertura sensorial): El valor real de cada variable de entrada está en el conjunto credal producido por la Capa 1 (i.e., al menos una fuente es compatible con la realidad).',
  'H2 (Fidelidad del modelo): El error de cada ecuación estructural del DAG está dentro de su bound calibrado: |u_i| ≤ ε_i para todo i (bounds calibrados según Definición 4.4).',
  'H3 (Regularidad dinámica): Las funciones del DAG satisfacen las condiciones de Lipschitz del Teorema 5.1 dentro del zonotope de trabajo.',
] as const;

/**
 * Certificado formal de seguridad — Definición 5.5.
 *
 * Es función pura de (reachableInterval, spec): sin timestamps ni estado, para
 * que sea reproducible y auditable a posteriori.
 */
export interface SafetyCertificate {
  status: CertificationStatus;
  /** Intervalo del reachable set para la variable de interés */
  reachableInterval: Interval;
  /** Spec contra la que se certificó */
  spec: SafetySpec;
  /**
   * Testigo existencial: los subintervalos del reachable set que caen fuera de
   * la región segura. Vacío si y solo si el estado es 'proven-safe'.
   *
   * Los extremos que coinciden con la frontera de la región segura son
   * abiertos (la región segura es cerrada), pero se representan como
   * intervalos cerrados por simplicidad de tipos.
   */
  witness: Interval[];
  /** Definiciones y teoremas que respaldan el veredicto */
  basis: string[];
  /** Hipótesis de las que depende — {@link THEOREM_6_1_HYPOTHESES} */
  assumptions: readonly string[];
  /** Justificación textual, con las citas formales explícitas */
  justification: string;
}

/**
 * Estado operativo para triage y UI.
 *
 * NO ES UNA CATEGORÍA FORMAL. Se deriva del certificado más la severidad
 * heurística. Para cualquier razonamiento sobre seguridad usar
 * {@link CertifiedDecision.certificate}, nunca este campo.
 *
 * - 'safe'     ⟺ certificado 'proven-safe'
 * - 'critical' ⟸ 'unsafe-possible' con severidad ≥ riskThreshold
 * - 'warning'  ⟸ 'unsafe-possible' con severidad < riskThreshold
 * - 'unknown'  → inalcanzable; se conserva en la unión por compatibilidad de
 *                tipos con consumidores previos.
 */
export type DecisionStatus = 'safe' | 'warning' | 'critical' | 'unknown';

export interface CertifiedDecision {
  /** Veredicto formal (Def. 5.5). La única parte con respaldo demostrativo. */
  certificate: SafetyCertificate;
  /** Estado operativo derivado, para UI. No formal. */
  status: DecisionStatus;
  /** Intervalo del reachable set para la variable de interés */
  reachableInterval: Interval;
  /** Spec que generó esta decisión */
  spec: SafetySpec;
  /**
   * Severidad heurística en [0, 1] — fracción de la LONGITUD del reachable set
   * fuera de la región segura. Métrica geométrica para priorizar, NO una
   * probabilidad de violación. Ver `severityScore`.
   */
  severity: number;
  /**
   * @deprecated Renombrado a `severity`. El nombre anterior sugería una
   * probabilidad de violación que esta magnitud nunca ha representado.
   * Se mantiene como alias para no romper consumidores existentes.
   */
  violationFraction: number;
  /** Justificación formal (copia de `certificate.justification`) */
  justification: string;
  timestamp: number;
}
