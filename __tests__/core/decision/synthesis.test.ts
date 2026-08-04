import { describe, it, expect } from 'vitest';
import { certifySafety, severityScore, synthesizeDecision } from '@/core/decision/synthesis';
import { SafetySpec, THEOREM_6_1_HYPOTHESES } from '@/core/decision/types';

const spec: SafetySpec = {
  variable: 'pressure',
  safeRegion: { lower: 2, upper: 6 },
  riskThreshold: 0.5,
};

// ─────────────────────────────────────────────────────────────────────────
// certifySafety — veredicto formal (Definición 5.5)
// ─────────────────────────────────────────────────────────────────────────

describe('certifySafety — proven-safe', () => {
  it('reachable estrictamente dentro de la región segura', () => {
    const cert = certifySafety({ lower: 3, upper: 5 }, spec);
    expect(cert.status).toBe('proven-safe');
    expect(cert.witness).toEqual([]);
  });

  it('reachable degenerado (un punto) dentro de la región', () => {
    const cert = certifySafety({ lower: 4, upper: 4 }, spec);
    expect(cert.status).toBe('proven-safe');
  });

  it('cita la definición y el teorema que lo respaldan', () => {
    const cert = certifySafety({ lower: 3, upper: 5 }, spec);
    expect(cert.justification).toContain('Def');
    expect(cert.justification).toContain('5.5');
    expect(cert.justification).toContain('Teorema 6.1');
    expect(cert.basis.some((b) => b.includes('5.5'))).toBe(true);
    expect(cert.basis.some((b) => b.includes('6.1'))).toBe(true);
  });

  it('declara las hipótesis H1–H3 de las que depende', () => {
    const cert = certifySafety({ lower: 3, upper: 5 }, spec);
    expect(cert.assumptions).toBe(THEOREM_6_1_HYPOTHESES);
    expect(cert.assumptions.length).toBe(3);
    expect(cert.assumptions[0]).toContain('H1');
    expect(cert.assumptions[1]).toContain('H2');
    expect(cert.assumptions[2]).toContain('H3');
    expect(cert.justification).toContain('H1–H3');
  });

  it('el certificado positivo afirma que ningún estado real puede ser inseguro', () => {
    const cert = certifySafety({ lower: 3, upper: 5 }, spec);
    expect(cert.justification).toMatch(/NINGÚN estado real/);
  });
});

describe('certifySafety — unsafe-possible', () => {
  it('reachable desborda por arriba', () => {
    const cert = certifySafety({ lower: 5, upper: 8 }, spec);
    expect(cert.status).toBe('unsafe-possible');
    expect(cert.witness).toEqual([{ lower: 6, upper: 8 }]);
  });

  it('reachable desborda por abajo', () => {
    const cert = certifySafety({ lower: 0, upper: 3 }, spec);
    expect(cert.status).toBe('unsafe-possible');
    expect(cert.witness).toEqual([{ lower: 0, upper: 2 }]);
  });

  it('reachable desborda por ambos lados: dos testigos', () => {
    const cert = certifySafety({ lower: 0, upper: 10 }, spec);
    expect(cert.status).toBe('unsafe-possible');
    expect(cert.witness).toEqual([
      { lower: 0, upper: 2 },
      { lower: 6, upper: 10 },
    ]);
  });

  it('reachable enteramente fuera de la región segura', () => {
    const cert = certifySafety({ lower: 20, upper: 30 }, spec);
    expect(cert.status).toBe('unsafe-possible');
    expect(cert.witness).toEqual([{ lower: 20, upper: 30 }]);
  });

  it('un rebase minúsculo basta: el veredicto es existencial, no de magnitud', () => {
    const cert = certifySafety({ lower: 2, upper: 6.000001 }, spec);
    expect(cert.status).toBe('unsafe-possible');
    // Y no se emite en función de cuánto rebasa: 0.0000004 de severidad.
    expect(severityScore({ lower: 2, upper: 6.000001 }, spec)).toBeLessThan(1e-6);
  });

  it('advierte de que unsafe-possible NO demuestra un estado real inseguro', () => {
    const cert = certifySafety({ lower: 5, upper: 8 }, spec);
    expect(cert.justification).toMatch(/NO demuestra/);
    expect(cert.justification).toContain('sobre-aproximación');
    expect(cert.justification).toContain('5.5');
  });
});

describe('certifySafety — frontera exacta', () => {
  it('reachable == región segura ⇒ proven-safe (la región es cerrada)', () => {
    const cert = certifySafety({ lower: 2, upper: 6 }, spec);
    expect(cert.status).toBe('proven-safe');
    expect(cert.witness).toEqual([]);
  });

  it('tocar la frontera desde dentro es seguro en ambos extremos', () => {
    expect(certifySafety({ lower: 2, upper: 4 }, spec).status).toBe('proven-safe');
    expect(certifySafety({ lower: 4, upper: 6 }, spec).status).toBe('proven-safe');
  });

  it('un punto exactamente en la frontera es seguro', () => {
    expect(certifySafety({ lower: 6, upper: 6 }, spec).status).toBe('proven-safe');
    expect(certifySafety({ lower: 2, upper: 2 }, spec).status).toBe('proven-safe');
  });

  it('rebasar la frontera en el menor ε representable ya es inseguro', () => {
    const justOver = { lower: 2, upper: 6 + Number.EPSILON * 8 };
    expect(justOver.upper).toBeGreaterThan(6);
    expect(certifySafety(justOver, spec).status).toBe('unsafe-possible');

    const justUnder = { lower: 2 - Number.EPSILON * 4, upper: 6 };
    expect(justUnder.lower).toBeLessThan(2);
    expect(certifySafety(justUnder, spec).status).toBe('unsafe-possible');
  });

  it('no se aplica tolerancia numérica: no hay zona gris', () => {
    // Cualquier ε > 0, por pequeño que sea, cae del lado inseguro.
    for (const eps of [1e-15, 1e-12, 1e-9, 1e-6]) {
      expect(certifySafety({ lower: 2, upper: 6 + eps }, spec).status).toBe('unsafe-possible');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// severityScore — heurística, explícitamente no formal
// ─────────────────────────────────────────────────────────────────────────

describe('severityScore', () => {
  it('vale 0 dentro de la región segura', () => {
    expect(severityScore({ lower: 3, upper: 5 }, spec)).toBe(0);
  });

  it('vale 1 cuando el reachable set está enteramente fuera', () => {
    expect(severityScore({ lower: 10, upper: 20 }, spec)).toBe(1);
  });

  it('mide fracción de LONGITUD, no probabilidad', () => {
    // [4, 8]: longitud 4, solapamiento [4, 6] = 2 ⇒ 1 - 2/4 = 0.5
    expect(severityScore({ lower: 4, upper: 8 }, spec)).toBeCloseTo(0.5, 12);
  });

  it('un punto alcanzable fuera de la región tiene severidad 1, no 0', () => {
    // Regresión: la fracción de longitud es 0/0 para un reachable degenerado.
    // La versión anterior devolvía 0, haciendo parecer inocuo un estado
    // alcanzable puntual situado fuera de la región segura.
    expect(severityScore({ lower: 100, upper: 100 }, spec)).toBe(1);
    expect(severityScore({ lower: 4, upper: 4 }, spec)).toBe(0);
  });

  it('está desacoplada del veredicto formal', () => {
    // Severidad casi nula pero formalmente inseguro...
    const barely = { lower: 2, upper: 6.0001 };
    expect(severityScore(barely, spec)).toBeLessThan(0.001);
    expect(certifySafety(barely, spec).status).toBe('unsafe-possible');

    // ...y severidad 0 con veredicto seguro. La heurística nunca decide.
    const inside = { lower: 2, upper: 6 };
    expect(severityScore(inside, spec)).toBe(0);
    expect(certifySafety(inside, spec).status).toBe('proven-safe');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// synthesizeDecision — composición de ambas capas
// ─────────────────────────────────────────────────────────────────────────

describe('synthesizeDecision', () => {
  it('proven-safe ⇒ status "safe"', () => {
    const d = synthesizeDecision({ lower: 3, upper: 5 }, spec);
    expect(d.certificate.status).toBe('proven-safe');
    expect(d.status).toBe('safe');
    expect(d.severity).toBe(0);
  });

  it('unsafe-possible con severidad alta ⇒ "critical"', () => {
    const d = synthesizeDecision({ lower: 5, upper: 20 }, spec);
    expect(d.certificate.status).toBe('unsafe-possible');
    expect(d.severity).toBeGreaterThanOrEqual(spec.riskThreshold);
    expect(d.status).toBe('critical');
  });

  it('unsafe-possible con severidad baja ⇒ "warning", nunca "safe"', () => {
    const d = synthesizeDecision({ lower: 2, upper: 6.5 }, spec);
    expect(d.certificate.status).toBe('unsafe-possible');
    expect(d.severity).toBeLessThan(spec.riskThreshold);
    expect(d.status).toBe('warning');
  });

  it('la severidad nunca convierte un caso inseguro en seguro', () => {
    // Umbral 1.0: ni la severidad máxima lo alcanza estrictamente por debajo,
    // pero el estado operativo sigue siendo de alarma en todos los casos.
    const strictSpec: SafetySpec = { ...spec, riskThreshold: 1.0 };
    for (const reach of [
      { lower: 2, upper: 6.0001 },
      { lower: 0, upper: 4 },
      { lower: 10, upper: 12 },
    ]) {
      const d = synthesizeDecision(reach, strictSpec);
      expect(d.certificate.status).toBe('unsafe-possible');
      expect(d.status).not.toBe('safe');
    }
  });

  it('"unknown" es inalcanzable: la certificación es total', () => {
    const cases = [
      { lower: 3, upper: 5 },
      { lower: 2, upper: 6 },
      { lower: 0, upper: 10 },
      { lower: 100, upper: 100 },
      { lower: 4, upper: 4 },
      { lower: -50, upper: -40 },
    ];
    for (const reach of cases) {
      expect(synthesizeDecision(reach, spec).status).not.toBe('unknown');
    }
  });

  it('violationFraction se conserva como alias deprecado de severity', () => {
    const d = synthesizeDecision({ lower: 4, upper: 8 }, spec);
    expect(d.violationFraction).toBe(d.severity);
  });

  it('la justificación de la decisión es la del certificado', () => {
    const d = synthesizeDecision({ lower: 5, upper: 8 }, spec);
    expect(d.justification).toBe(d.certificate.justification);
  });

  it('el certificado es función pura de (reachable, spec): reproducible', () => {
    const a = certifySafety({ lower: 5, upper: 8 }, spec);
    const b = certifySafety({ lower: 5, upper: 8 }, spec);
    expect(a).toEqual(b);
  });
});
