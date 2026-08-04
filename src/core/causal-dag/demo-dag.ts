/**
 * AURA v2 — DAG causal de la demo (caso de uso meteorológico)
 *
 * Implements: §7.3 del paper (papers/AURA_v2.pdf), "DAG simplificado para la
 * demo", con el modelo de acumulación de la Ecuación (34):
 *
 *     h(t) = h₀ + (P − D)·t                                            (34)
 *
 * donde P es la precipitación fusionada por la Capa 1 (mm/h), D la capacidad de
 * drenaje (mm/h, constante y configurable), h₀ el nivel inicial acumulado (mm)
 * y t el horizonte temporal (h). El paper lo describe como "una linearización
 * del balance hídrico que permite zonotopes exactos (sin error de
 * linearización)"; el tercer nivel del DAG de §7.3 —riesgo de inundación,
 * binario, h > h_crit— NO es un nodo de este DAG: es el veredicto de la Capa 3
 * (Def. 5.5), que se emite con `certifySafety` sobre el reachable set.
 *
 * Ecuaciones estructurales y sus ε (Definición 4.3, Ecuación 24):
 *
 * - `h`: ε = {@link DEMO_H_MODEL_ERROR_BOUND} > 0. Que la ecuación sea lineal
 *   elimina el error de LINEARIZACIÓN, no el error de MODELO: el balance
 *   hídrico real tiene infiltración, saturación del terreno y una D que no es
 *   constante (cae al saturarse el drenaje). ε_h cubre esa discrepancia.
 */

import { CausalDAG } from './types';
import { createCausalDAG } from './dag';
import { add, multiply, subtract } from '../intervals/arithmetic';
import { Interval } from '../intervals/types';

/** Parámetros configurables del modelo de acumulación de la Ecuación (34). */
export interface DemoDAGParams {
  /** h₀ — nivel acumulado inicial (mm). Puede ser un intervalo si es incierto. */
  initialLevel: Interval;
  /** D — capacidad de drenaje (mm/h). Intervalo para admitir su incertidumbre. */
  drainageCapacity: Interval;
  /** t — horizonte temporal (h) sobre el que se evalúa h(t). */
  horizon: Interval;
  /**
   * ε_h — bound del error de modelo del nodo `h` (mm).
   * Por defecto {@link DEMO_H_MODEL_ERROR_BOUND}.
   */
  modelErrorBound?: number;
}

/**
 * ε_h por defecto para la Ecuación (34): **2,0 mm** sobre el horizonte de 2 h
 * de la demo (§7.4, paso 5: t ∈ [0, 120] min).
 *
 * ⚠ VALOR DECLARADO, NO CALIBRADO. La Definición 4.4 exige calibrar ε con N
 * observaciones históricas (ε = máx_k |v_k − f(x_k)| + δ_margin, Ec. 25). La
 * demo aún no tiene ese dataset: no hay serie histórica de nivel acumulado
 * medido contra el que evaluar los residuos. Este valor es, por tanto, una
 * declaración explícita de cuánto error de modelo se asume, no una calibración.
 *
 * Justificación del orden de magnitud, para que sea auditable y sustituible:
 * el término dominante que la Ec. (34) ignora es la variación de D dentro del
 * horizonte (drenaje que se degrada al saturarse). Con D del orden de 5 mm/h y
 * una desviación plausible de ±1 mm/h sostenida durante 2 h, el error acumulado
 * es ≈ 2 mm. Frente a un h_crit del orden de decenas de mm, ε_h añade una
 * holgura del orden del 5 %: conservador sin volver el certificado inútil.
 *
 * En cuanto exista el dataset de calibración, este valor debe recomputarse con
 * la Ecuación (25) y δ_margin = γ·σ̂_residuos, γ ∈ [1, 3]. Hasta entonces, H2
 * del Teorema 6.1 se ASUME también aquí, y el certificado lo arrastra.
 */
export const DEMO_H_MODEL_ERROR_BOUND = 2.0;

/** Valores por defecto de la demo (Madrid-Chamartín, horizonte de 2 h). */
export const DEMO_DAG_DEFAULTS: DemoDAGParams = {
  initialLevel: { lower: 0, upper: 0 },
  drainageCapacity: { lower: 5, upper: 5 },
  horizon: { lower: 0, upper: 2 },
  modelErrorBound: DEMO_H_MODEL_ERROR_BOUND,
};

/**
 * Construye el DAG de la demo: P → h, con h(t) = h₀ + (P − D)·t.
 *
 * El nodo `P` es raíz: su valor entra por `propagateIntervals(dag, inputs)`
 * como el intervalo credal que produce la Capa 1 (Def. 3.9, Ec. 10). No lleva
 * ε: su incertidumbre es sensorial (H1), no de modelo (H2).
 */
export function createDemoDAG(params: Partial<DemoDAGParams> = {}): CausalDAG {
  const { initialLevel, drainageCapacity, horizon, modelErrorBound } = {
    ...DEMO_DAG_DEFAULTS,
    ...params,
  };

  return createCausalDAG({
    nodes: [
      { id: 'P', label: 'Precipitación fusionada', unit: 'mm/h' },
      { id: 'h', label: 'Acumulación de agua h(t)', unit: 'mm' },
    ],
    edges: [{ from: 'P', to: 'h', weight: horizon }],
    equations: [
      {
        nodeId: 'h',
        // f_h([P]) = h₀ ⊕ ([P] ⊖ [D]) ⊗ [t] — Ecuación (34), sin el ⊕[−ε, ε],
        // que aplica la propagación (Ec. 24).
        compute: (parents) =>
          add(initialLevel, multiply(subtract(parents.get('P')!, drainageCapacity), horizon)),
        modelErrorBound: modelErrorBound ?? DEMO_H_MODEL_ERROR_BOUND,
      },
    ],
  });
}
