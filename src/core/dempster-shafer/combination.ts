/**
 * AURA v2 — Reglas de combinación
 *
 * Implementa:
 * - Regla de Dempster: Ecuación (3) del paper
 * - Media cautelosa: Ecuación (5) del paper
 * - Envolvente conservativa: Definición 3.7, Ecuaciones (6)-(7)
 */

import { BPA, FocalElement, FusionResult, FusionConfig, DEFAULT_FUSION_CONFIG } from './types';
import { allBeliefPlausibility } from './bpa';
import { assessConflict } from './conflict';

/**
 * Regla de combinación de Dempster para dos BPAs.
 *
 * Paper ref: Ecuación (3).
 * (m1 ⊕ m2)(A) = [1/(1-K)] Σ_{B∩C=A} m1(B)·m2(C)
 *
 * ADVERTENCIA: No usar si K > 0.7 (ver paper, Warning sobre problema de Zadeh).
 */
export function dempsterCombine(bpa1: BPA, bpa2: BPA): { combined: BPA; conflict: number } {
  const massMap = new Map<string, number>();
  let conflict = 0;

  for (const fe1 of bpa1.focalElements) {
    for (const fe2 of bpa2.focalElements) {
      const intersection = fe1.indices.filter((i) => fe2.indices.includes(i));
      const product = fe1.mass * fe2.mass;

      if (intersection.length === 0) {
        conflict += product;
      } else {
        const key = intersection.sort((a, b) => a - b).join(',');
        massMap.set(key, (massMap.get(key) ?? 0) + product);
      }
    }
  }

  if (conflict >= 1 - 1e-10) {
    throw new Error('Total conflict (K≈1): sources are completely contradictory. Cannot apply Dempster rule.');
  }

  const normFactor = 1 / (1 - conflict);
  const focalElements: FocalElement[] = [];

  for (const [key, mass] of massMap) {
    const indices = key.split(',').map(Number);
    focalElements.push({ indices, mass: mass * normFactor });
  }

  return {
    combined: {
      frame: bpa1.frame,
      focalElements,
      sourceId: `dempster(${bpa1.sourceId},${bpa2.sourceId})`,
      timestamp: Math.max(bpa1.timestamp, bpa2.timestamp),
    },
    conflict,
  };
}

/**
 * Combinación de Dempster para n BPAs (aplicación secuencial).
 */
export function dempsterCombineMultiple(bpas: BPA[]): { combined: BPA; conflicts: number[] } {
  if (bpas.length === 0) throw new Error('No BPAs to combine');
  if (bpas.length === 1) return { combined: bpas[0], conflicts: [] };

  let result = bpas[0];
  const conflicts: number[] = [];

  for (let i = 1; i < bpas.length; i++) {
    const { combined, conflict } = dempsterCombine(result, bpas[i]);
    result = combined;
    conflicts.push(conflict);
  }

  return { combined: result, conflicts };
}

/**
 * Media cautelosa ponderada.
 *
 * Paper ref: Ecuación (5).
 * m_fused(A) = Σ_i w_i · m_i(A)
 * w_i = (1 - δ_i)^{-1} / Σ_j (1 - δ_j)^{-1}
 *
 * @param failureRates - Tasa de fallo δ_i para cada fuente
 */
export function cautiousCombine(bpas: BPA[], failureRates: number[]): BPA {
  if (bpas.length === 0) throw new Error('No BPAs to combine');
  if (bpas.length !== failureRates.length) throw new Error('BPAs and failureRates must have same length');

  const n = bpas.length;

  // Calcular pesos: w_i = (1 - δ_i) / Σ_j (1 - δ_j)
  // Fuentes más fiables (δ bajo) reciben más peso.
  const rawWeights = failureRates.map((delta) => 1 - delta);
  const weightSum = rawWeights.reduce((s, w) => s + w, 0);
  const weights = rawWeights.map((w) => w / weightSum);

  // Acumular masas ponderadas
  const massMap = new Map<string, number>();

  for (let i = 0; i < n; i++) {
    for (const fe of bpas[i].focalElements) {
      const key = [...fe.indices].sort((a, b) => a - b).join(',');
      massMap.set(key, (massMap.get(key) ?? 0) + weights[i] * fe.mass);
    }
  }

  const focalElements: FocalElement[] = [];
  for (const [key, mass] of massMap) {
    if (mass > 1e-10) {
      focalElements.push({ indices: key.split(',').map(Number), mass });
    }
  }

  return {
    frame: bpas[0].frame,
    focalElements,
    sourceId: `cautious(${bpas.map((b) => b.sourceId).join(',')})`,
    timestamp: Math.max(...bpas.map((b) => b.timestamp)),
  };
}

/**
 * Envolvente conservativa.
 *
 * Paper ref: Definición 3.7, Ecuaciones (6)-(7).
 *
 * Cuando el conflicto es alto, no fusionamos: tomamos el min de Bel
 * y el max de Pl sobre todas las fuentes para cada hipótesis.
 *
 * Retorna una BPA "sintética" que representa la envolvente.
 */
export function envelopeCombine(bpas: BPA[]): BPA {
  if (bpas.length === 0) throw new Error('No BPAs to combine');

  const frame = bpas[0].frame;
  const n = frame.hypotheses.length;

  // Calcular Bel y Pl para cada fuente y cada hipótesis
  const allBP = bpas.map((bpa) => allBeliefPlausibility(bpa));

  // Envolvente: [min Bel_i, max Pl_i] para cada θ_j
  const focalElements: FocalElement[] = [];
  const allIndices = Array.from({ length: n }, (_, i) => i);

  // Construir BPA que refleje la envolvente:
  // Para cada singleton, asignar masa = min Bel (evidencia mínima directa)
  let assignedMass = 0;

  for (let j = 0; j < n; j++) {
    const minBel = Math.min(...allBP.map((bp) => bp[j].belief));
    if (minBel > 1e-10) {
      focalElements.push({ indices: [j], mass: minBel });
      assignedMass += minBel;
    }
  }

  // Masa restante va a Θ (ignorancia máxima compatible con la envolvente)
  const remainingMass = 1 - assignedMass;
  if (remainingMass > 1e-10) {
    focalElements.push({ indices: allIndices, mass: remainingMass });
  }

  return {
    frame,
    focalElements,
    sourceId: `envelope(${bpas.map((b) => b.sourceId).join(',')})`,
    timestamp: Math.max(...bpas.map((b) => b.timestamp)),
  };
}

/**
 * Función principal de fusión: aplica la estrategia escalonada.
 *
 * Paper ref: Definición 3.6 completa.
 *
 * 1. Calcula conflicto entre fuentes.
 * 2. Según el nivel de conflicto, aplica Dempster / cautelosa / envolvente.
 * 3. Retorna resultado fusionado con metadatos completos.
 */
export function fuse(
  bpas: BPA[],
  failureRates: number[],
  config: FusionConfig = DEFAULT_FUSION_CONFIG
): FusionResult {
  if (bpas.length === 0) throw new Error('No BPAs to fuse');
  if (bpas.length !== failureRates.length) throw new Error('BPAs and failureRates must have same length');

  const assessment = assessConflict(bpas, config);

  let fused: BPA;

  switch (assessment.method) {
    case 'dempster': {
      const { combined } = dempsterCombineMultiple(bpas);
      fused = combined;
      break;
    }
    case 'cautious': {
      fused = cautiousCombine(bpas, failureRates);
      break;
    }
    case 'envelope': {
      fused = envelopeCombine(bpas);
      break;
    }
  }

  // Calcular pesos de fuente (para trazabilidad)
  const rawWeights = failureRates.map((delta) => 1 - delta);
  const weightSum = rawWeights.reduce((s, w) => s + w, 0);
  const sourceWeights = rawWeights.map((w) => w / weightSum);

  return {
    fused,
    method: assessment.method,
    conflictMatrix: assessment.matrix,
    maxConflict: assessment.maxConflict,
    sourceWeights,
  };
}
