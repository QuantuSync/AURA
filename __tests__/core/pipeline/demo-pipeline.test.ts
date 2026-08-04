/**
 * Regresión del escenario de la demo (§7 de papers/AURA_v2.pdf) con NÚMEROS
 * FIJADOS.
 *
 * Lo que este fichero protege no es el pipeline: es la TESIS de docs/ERRATA.md
 * §8. Si alguien "arregla" la vacuidad del nivel existencial estrechando el
 * intervalo credal —subiendo el umbral 1e-10, truncando la cola, filtrando por
 * plausibilidad—, estos tests fallan, porque comprueban a la vez que:
 *
 *   (a) el nivel existencial SIGUE siendo vacuo (reachable = rango completo,
 *       'unsafe-possible', y con severidad heurística IDÉNTICA en escenarios
 *       operativamente opuestos), y
 *   (b) el nivel probabilístico SÍ los separa.
 *
 * Los dos hechos juntos son el argumento. Comprobar solo (b) permitiría
 * "resolver" el problema rompiendo la soundness de (a).
 */

import { describe, it, expect } from 'vitest';
import {
  DEMO_H_CRIT,
  DEMO_SOURCES_HEAVY_RAIN,
  DEMO_SOURCES_LIGHT_RAIN,
  DEMO_UNSAFE_PROBABILITY_THRESHOLD,
  runDemoPipeline,
} from '@/core/pipeline/demo-pipeline';
import { PRECIPITATION_DOMAIN_BOUND } from '@/lib/constants';
import { unsafeProbabilityBounds } from '@/core/credal-propagation/probability-bounds';
import { totalMass } from '@/core/credal-propagation/credal-interval-set';

const light = () => runDemoPipeline({ sources: DEMO_SOURCES_LIGHT_RAIN });
const heavy = () => runDemoPipeline({ sources: DEMO_SOURCES_HEAVY_RAIN });

// ─────────────────────────────────────────────────────────────────────────
// (a) El nivel existencial es vacuo — el problema que motiva la extensión
// ─────────────────────────────────────────────────────────────────────────

describe('el nivel existencial NO distingue lluvia ligera de lluvia intensa', () => {
  it('la Ec. (10) devuelve el rango COMPLETO del marco en ambos escenarios', () => {
    for (const r of [light(), heavy()]) {
      expect(r.credalSet.continuousInterval).toEqual({
        lower: 0,
        upper: PRECIPITATION_DOMAIN_BOUND,
      });
    }
  });

  it('la causa es la válvula δ_i: Pl(cola) ≥ Π δ_i, doce órdenes sobre el umbral 1e-10', () => {
    const r = light();
    const prodDeltas = DEMO_SOURCES_LIGHT_RAIN.reduce((p, s) => p * s.failureRate, 1);
    expect(prodDeltas).toBeCloseTo(1.2e-4, 12);

    const tail = r.credalSet.bounds[r.credalSet.bounds.length - 1];
    expect(tail.plausibility).toBeGreaterThanOrEqual(prodDeltas);
    expect(tail.plausibility).toBeGreaterThan(1e-10);
  });

  it('el reachable set es IDÉNTICO en los dos escenarios', () => {
    expect(light().reachableInterval).toEqual({ lower: -12, upper: 992 });
    expect(heavy().reachableInterval).toEqual({ lower: -12, upper: 992 });
  });

  it("ambos certifican 'unsafe-possible' — el veredicto formal no cambia", () => {
    expect(light().decision.certificate.status).toBe('unsafe-possible');
    expect(heavy().decision.certificate.status).toBe('unsafe-possible');
  });

  it('la severidad HEURÍSTICA tampoco los distingue: es exactamente la misma', () => {
    // Consecuencia directa de que el reachable set sea idéntico. Con la regla
    // anterior (severity ≥ riskThreshold = 0,5) los dos escenarios habrían
    // salido 'critical': la heurística geométrica no puede separar lo que el
    // nivel probabilístico separa en cuatro órdenes de magnitud.
    expect(light().decision.severity).toBe(heavy().decision.severity);
    expect(light().decision.severity).toBeGreaterThan(0.5);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// (b) El nivel probabilístico SÍ los separa — la informatividad recuperada
// ─────────────────────────────────────────────────────────────────────────

describe('lluvia ligera concordante — números fijados', () => {
  const r = light();

  it('la fusión es por Dempster con conflicto bajo', () => {
    expect(r.fusion.method).toBe('dempster');
    // K_decision de la regla vigente (C1) es el máximo por pares de la MEDIDA
    // vigente (D2, distancia de Jousselme) y vale 0,153405. El K_máx crudo de
    // la Def. 3.5 (0,157632) y el K_global (0,184412) se siguen reportando
    // aparte y NO se han movido: la medida cambia con qué se decide, no qué se
    // observa. Ver ERRATA §9.
    expect(r.fusion.rule).toBe('C1');
    expect(r.fusion.measure).toBe('D2');
    expect(r.fusion.decisionConflict).toBeCloseTo(0.153405, 5);
    expect(r.fusion.measureConflict).toBeCloseTo(0.153405, 5);
    expect(r.fusion.maxConflict).toBeCloseTo(0.157632, 5);
    expect(r.fusion.globalConflict).toBeCloseTo(0.184412, 5);
    expect(r.fusion.degeneracyGuard).toBe(false);
    // Escenario concordante: los tres números están muy por debajo de κ₁ y la
    // rama elegida es la misma que con la medida anterior. La corrección del
    // suelo no cambia este caso, y conviene que conste.
    expect(r.fusion.method).toBe('dempster');
  });

  it('la BPA fusionada tiene 4 elementos focales y ~99,9 % de masa sobre *ligera*', () => {
    expect(r.inputCredalSet.elements).toHaveLength(4);
    const ligera = r.inputCredalSet.elements.find(
      (e) => e.interval.lower === 5 && e.interval.upper === 15
    )!;
    expect(ligera.mass).toBeCloseTo(0.99895814, 7);
  });

  it('la masa sobre Θ es Π δ_i renormalizada por 1/(1−K)', () => {
    const theta = r.inputCredalSet.elements.find(
      (e) => e.interval.lower === 0 && e.interval.upper === PRECIPITATION_DOMAIN_BOUND
    )!;
    const prodDeltas = DEMO_SOURCES_LIGHT_RAIN.reduce((p, s) => p * s.failureRate, 1);
    // El denominador es 1 − K_GLOBAL, no 1 − K_decision. La reducción
    // secuencial normaliza una vez por paso, y por la identidad (I2) de
    // `conflict-rules.ts` el producto de esos (1 − K^(k)) es exactamente
    // 1 − K_global. Hasta ERRATA §9 los dos números coincidían porque la regla
    // C0 decidía con K_global; con C1 ya no, y la fórmula correcta se ve.
    expect(theta.mass).toBeCloseTo(prodDeltas / (1 - r.fusion.globalConflict), 9);
    expect(r.fusion.sequentialConflicts!.reduce((p, k) => p * (1 - k), 1)).toBeCloseTo(
      1 - r.fusion.globalConflict,
      9
    );
    expect(theta.mass).toBeCloseTo(1.4713e-4, 8);
  });

  it('plUpper ≈ 1,559e-4 y belLower = 0', () => {
    expect(r.probabilityBounds.belLower).toBe(0);
    expect(r.probabilityBounds.plUpper).toBeCloseTo(1.559438e-4, 9);
  });

  it('plUpper es exactamente la masa que no cabe bajo h_crít', () => {
    // Los dos únicos focales que pueden superar h_crít = 25 mm: *moderada*
    // (8,81e-6) y Θ (1,4713e-4). El 99,9 % de la masa propaga a [−2, 22] ⊆ seguro.
    const unsafeMass = r.propagatedCredalSet.elements
      .filter((e) => e.interval.upper > DEMO_H_CRIT)
      .reduce((s, e) => s + e.mass, 0);
    expect(r.probabilityBounds.plUpper).toBeCloseTo(unsafeMass, 15);
  });

  it("el status operativo baja a 'warning', y por el BOUND, no por la heurística", () => {
    expect(r.decision.status).toBe('warning');
    expect(r.decision.escalationBasis).toBe('probability-bound');
    // La des-escalada tiene respaldo formal: está DEMOSTRADO P(E) < p_crít.
    expect(r.probabilityBounds.plUpper).toBeLessThan(DEMO_UNSAFE_PROBABILITY_THRESHOLD);
    // Y la heurística, por sí sola, habría dicho 'critical'.
    expect(r.decision.severity).toBeGreaterThanOrEqual(r.decision.spec.riskThreshold);
  });
});

describe('lluvia intensa concordante — contraste', () => {
  const r = heavy();

  it('belLower ≈ 0,99988 y plUpper = 1', () => {
    expect(r.probabilityBounds.belLower).toBeCloseTo(0.9998800, 6);
    // No es 1 EXACTO: la BPA fusionada descarta masas ≤ 1e-10, de modo que
    // Σ m = 1 − 1,25e-12, dentro de MASS_SUM_TOLERANCE.
    expect(r.probabilityBounds.plUpper).toBeCloseTo(1, 9);
  });

  it('la masa está sobre *intensa*, que propaga ENTERAMENTE por encima de h_crít', () => {
    const intensa = r.propagatedCredalSet.elements.find((e) => e.mass > 0.5)!;
    expect(intensa.interval).toEqual({ lower: 48, upper: 112 });
    expect(intensa.interval.lower).toBeGreaterThan(DEMO_H_CRIT);
  });

  it("el status operativo es 'critical' por el bound", () => {
    expect(r.decision.status).toBe('critical');
    expect(r.decision.escalationBasis).toBe('probability-bound');
  });

  it('cuatro órdenes de magnitud de diferencia en plUpper frente a lluvia ligera', () => {
    const ratio = r.probabilityBounds.plUpper / light().probabilityBounds.plUpper;
    expect(ratio).toBeGreaterThan(6000);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Invariantes estructurales del pipeline
// ─────────────────────────────────────────────────────────────────────────

describe('invariantes del pipeline credal', () => {
  it('la masa se conserva de la entrada a la salida', () => {
    for (const r of [light(), heavy()]) {
      expect(totalMass(r.propagatedCredalSet)).toBeCloseTo(totalMass(r.inputCredalSet), 15);
      expect(totalMass(r.propagatedCredalSet)).toBeCloseTo(1, 9);
    }
  });

  it('el certificado arrastra los bounds y el H0 del marco', () => {
    const r = light();
    expect(r.decision.certificate.probabilityBounds).toEqual(r.probabilityBounds);
    expect(r.decision.certificate.domainBounds).toEqual([
      { variable: 'precipitation', unit: 'mm/h', domainBound: PRECIPITATION_DOMAIN_BOUND },
    ]);
  });

  it('la justificación cita el mecanismo como EXTENSIÓN de la Def. 5.5', () => {
    const cert = light().decision.certificate;
    expect(cert.justification).toContain('NIVEL PROBABILÍSTICO');
    expect(cert.justification).toContain('ERRATA.md §8');
    expect(cert.basis.some((b) => b.includes('EXTENSIÓN a la Definición 5.5'))).toBe(true);
    expect(cert.basis.some((b) => b.includes('Definición 5.5 (decisión certificada)'))).toBe(true);
  });

  it('el hull del conjunto propagado ES el reachable set del certificado', () => {
    const r = light();
    expect(r.decision.certificate.reachableInterval).toEqual(r.reachableInterval);
    expect(r.reachableInterval.lower).toBe(
      Math.min(...r.propagatedCredalSet.elements.map((e) => e.interval.lower))
    );
    expect(r.reachableInterval.upper).toBe(
      Math.max(...r.propagatedCredalSet.elements.map((e) => e.interval.upper))
    );
  });

  it('con la ventana [0, 2] en vez del instante final, belLower es estructuralmente 0', () => {
    // Documentado en DEMO_PIPELINE_DAG_PARAMS: t = 0 da h = h₀, trivialmente
    // seguro, luego ningún focal queda CONTENIDO en la región insegura. Sigue
    // siendo sound —Bel(E) = 0 es cierto—, pero el evento deja de ser el que
    // interesa operativamente.
    const r = runDemoPipeline({
      sources: DEMO_SOURCES_HEAVY_RAIN,
      dagParams: { horizon: { lower: 0, upper: 2 } },
    });
    expect(r.probabilityBounds.belLower).toBe(0);
    expect(r.probabilityBounds.plUpper).toBeCloseTo(1, 9);
  });

  it('un escenario proven-safe da plUpper = 0 y status safe', () => {
    // Bajar δ NO basta para llegar a proven-safe: la masa sobre Θ sigue
    // contando por pequeña que sea, y el hull sigue llegando a 992 mm. Lo único
    // que lo consigue es subir h_crít por encima de ese techo — que es
    // precisamente el argumento de docs/ERRATA.md §8: el nivel existencial
    // depende del SOPORTE, no de la evidencia.
    const r = runDemoPipeline({
      sources: DEMO_SOURCES_LIGHT_RAIN,
      spec: {
        variable: 'h',
        safeRegion: { lower: -Infinity, upper: 2000 },
        riskThreshold: 0.5,
        unsafeProbabilityThreshold: DEMO_UNSAFE_PROBABILITY_THRESHOLD,
      },
    });
    expect(r.decision.certificate.status).toBe('proven-safe');
    expect(r.probabilityBounds.plUpper).toBe(0);
    expect(r.decision.status).toBe('safe');
    expect(r.decision.escalationBasis).toBe('not-applicable');
  });

  it('los bounds del pipeline coinciden con recomputarlos desde el conjunto propagado', () => {
    const r = light();
    expect(unsafeProbabilityBounds(r.propagatedCredalSet, r.decision.spec.safeRegion)).toEqual(
      r.probabilityBounds
    );
  });

  it('LANZA sin fuentes', () => {
    expect(() => runDemoPipeline({ sources: [] })).toThrow(/al menos una fuente/);
  });
});
