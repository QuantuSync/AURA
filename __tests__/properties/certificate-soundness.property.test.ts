/**
 * Propiedad B7 — Definición 5.5 (decisión certificada)
 * papers/AURA_v2.pdf §5.5, Ecuación (31)
 *
 * La Def. 5.5 es EXISTENCIAL: la decisión protectora está certificada si
 * ∃x ∈ R(t*) que viola la especificación. Las dos direcciones que importan:
 *
 *   (a) 'proven-safe'    ⇒ NINGÚN punto alcanzable viola la spec
 *   (b) ∃ punto que viola ⇒ 'unsafe-possible'
 *
 * (a) es la garantía que hace útil el certificado positivo; (b) es la que
 * impide que el sistema se calle ante un escenario inseguro. Juntas dicen que
 * el veredicto es exactamente la contención de conjuntos, sin holgura.
 *
 * (c) La pureza del certificado es lo que lo hace auditable a posteriori:
 * reejecutarlo sobre los mismos argumentos debe dar el mismo objeto.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { certifySafety, severityScore, synthesizeDecision } from '@/core/decision/synthesis';
import { SafetySpec, THEOREM_6_1_HYPOTHESES } from '@/core/decision/types';
import { Interval } from '@/core/intervals/types';
import { fcParams, realArb, unitArb } from './_config';

/** Reachable set arbitrario (salida de la Capa 3). */
const reachableArb = (): fc.Arbitrary<Interval> =>
  fc
    .tuple(realArb(-100, 100), realArb(-100, 100))
    .map(([p, q]) => ({ lower: Math.min(p, q), upper: Math.max(p, q) }));

/** Especificación de seguridad arbitraria — Definición 5.4. */
const specArb = (): fc.Arbitrary<SafetySpec> =>
  fc
    .tuple(realArb(-100, 100), realArb(-100, 100), unitArb())
    .map(([p, q, threshold]) => ({
      variable: 'h_p',
      safeRegion: { lower: Math.min(p, q), upper: Math.max(p, q) },
      riskThreshold: threshold,
    }));

/**
 * Reachables que rozan la frontera de la spec. Sin este generador dirigido, un
 * muestreo uniforme casi nunca produce el caso límite, que es justo donde un
 * error de comparación (≤ frente a <) se manifestaría.
 */
const boundaryCase = (): fc.Arbitrary<{ reachable: Interval; spec: SafetySpec }> =>
  fc
    .tuple(specArb(), fc.integer({ min: 0, max: 5 }), fc.constantFrom(0, 1e-12, 1e-9, 1e-6, 1e-3))
    .map(([spec, mode, eps]) => {
      const { lower, upper } = spec.safeRegion;
      const variants: Interval[] = [
        { lower, upper }, // exactamente la región segura
        { lower, upper: upper + eps }, // rebasa por arriba
        { lower: lower - eps, upper }, // rebasa por abajo
        { lower: upper, upper }, // punto en la frontera superior
        { lower, upper: lower }, // punto en la frontera inferior
        { lower: lower + (upper - lower) / 4, upper: upper - (upper - lower) / 4 },
      ];
      return { reachable: variants[mode], spec };
    });

/** Muestrea puntos del reachable, incluidos siempre ambos extremos. */
function samplePointsOf(reachable: Interval, ts: number[]): number[] {
  const width = reachable.upper - reachable.lower;
  const inner = ts.map((t) => {
    const x = reachable.lower + t * width;
    return Math.min(reachable.upper, Math.max(reachable.lower, x));
  });
  return [reachable.lower, reachable.upper, ...inner];
}

const violates = (x: number, spec: SafetySpec): boolean =>
  x < spec.safeRegion.lower || x > spec.safeRegion.upper;

const tsArb = () => fc.array(unitArb(), { minLength: 8, maxLength: 24 });

describe('B7 · Definición 5.5 — soundness del certificado existencial', () => {
  it('(a) proven-safe ⇒ ningún punto muestreado del reachable viola la spec', () => {
    fc.assert(
      fc.property(reachableArb(), specArb(), tsArb(), (reachable, spec, ts) => {
        const cert = certifySafety(reachable, spec);
        if (cert.status !== 'proven-safe') return true;

        for (const x of samplePointsOf(reachable, ts)) {
          expect(violates(x, spec)).toBe(false);
        }
        expect(cert.witness).toEqual([]);
        return true;
      }),
      fcParams
    );
  });

  it('(a) proven-safe también en los casos frontera dirigidos', () => {
    fc.assert(
      fc.property(boundaryCase(), tsArb(), ({ reachable, spec }, ts) => {
        const cert = certifySafety(reachable, spec);
        if (cert.status !== 'proven-safe') return true;
        for (const x of samplePointsOf(reachable, ts)) {
          expect(violates(x, spec)).toBe(false);
        }
        return true;
      }),
      fcParams
    );
  });

  it('(b) existe un punto que viola ⇒ el certificado es unsafe-possible', () => {
    fc.assert(
      fc.property(reachableArb(), specArb(), tsArb(), (reachable, spec, ts) => {
        const anyViolation = samplePointsOf(reachable, ts).some((x) => violates(x, spec));
        if (!anyViolation) return true;

        const cert = certifySafety(reachable, spec);
        expect(cert.status).toBe('unsafe-possible');
        expect(cert.witness.length).toBeGreaterThan(0);
        return true;
      }),
      fcParams
    );
  });

  it('(b) también con los casos frontera dirigidos', () => {
    fc.assert(
      fc.property(boundaryCase(), tsArb(), ({ reachable, spec }, ts) => {
        const anyViolation = samplePointsOf(reachable, ts).some((x) => violates(x, spec));
        if (!anyViolation) return true;
        expect(certifySafety(reachable, spec).status).toBe('unsafe-possible');
        return true;
      }),
      fcParams
    );
  });

  it('el testigo señala realmente región insegura', () => {
    // Cada subintervalo del witness debe exhibir un punto alcanzable que viola
    // la spec: es la evidencia existencial que respalda el veredicto de la
    // Def. 5.5, no un adorno.
    //
    // Se comprueba sobre los EXTREMOS, no sobre el punto medio. El witness es
    // semiabierto por construcción (la región segura es cerrada, luego el
    // extremo que coincide con su frontera es seguro), y su punto medio no
    // tiene por qué violar nada: con anchos del orden del denormal más pequeño
    // el punto medio subdesborda hasta la propia frontera. El extremo que
    // procede del reachable set, en cambio, viola SIEMPRE por construcción de
    // las dos ramas de certifySafety.
    fc.assert(
      fc.property(reachableArb(), specArb(), (reachable, spec) => {
        const cert = certifySafety(reachable, spec);
        for (const w of cert.witness) {
          expect(w.lower).toBeLessThanOrEqual(w.upper);

          // Al menos un extremo del testigo está fuera de la región segura.
          expect(violates(w.lower, spec) || violates(w.upper, spec)).toBe(true);

          // El testigo está contenido en el reachable set.
          expect(w.lower).toBeGreaterThanOrEqual(reachable.lower - 1e-12);
          expect(w.upper).toBeLessThanOrEqual(reachable.upper + 1e-12);
        }
      }),
      fcParams
    );
  });

  it('(c) el certificado es función pura: dos llamadas dan resultado idéntico', () => {
    fc.assert(
      fc.property(reachableArb(), specArb(), (reachable, spec) => {
        expect(certifySafety(reachable, spec)).toEqual(certifySafety(reachable, spec));
      }),
      fcParams
    );
  });

  it('(c) la pureza se mantiene en los casos frontera', () => {
    fc.assert(
      fc.property(boundaryCase(), ({ reachable, spec }) => {
        expect(certifySafety(reachable, spec)).toEqual(certifySafety(reachable, spec));
      }),
      fcParams
    );
  });

  it('el veredicto es total y binario: nunca hay un tercer estado', () => {
    fc.assert(
      fc.property(reachableArb(), specArb(), (reachable, spec) => {
        const status = certifySafety(reachable, spec).status;
        expect(status === 'proven-safe' || status === 'unsafe-possible').toBe(true);
      }),
      fcParams
    );
  });

  it('todo certificado arrastra sus hipótesis H1–H3 y su base formal', () => {
    fc.assert(
      fc.property(reachableArb(), specArb(), (reachable, spec) => {
        const cert = certifySafety(reachable, spec);
        expect(cert.assumptions).toBe(THEOREM_6_1_HYPOTHESES);
        expect(cert.basis.some((b) => b.includes('5.5'))).toBe(true);
        expect(cert.basis.some((b) => b.includes('6.1'))).toBe(true);
        expect(cert.justification.length).toBeGreaterThan(0);
      }),
      fcParams
    );
  });

  // ───────────────────────────────────────────────────────────────────────
  // Separación entre la capa formal y la heurística
  // ───────────────────────────────────────────────────────────────────────

  it('la severidad heurística NUNCA decide la seguridad', () => {
    // Invariante central de la iteración anterior: severity solo modula el
    // triaje. Un certificado inseguro jamás produce status 'safe', sea cual sea
    // el riskThreshold.
    fc.assert(
      fc.property(reachableArb(), specArb(), (reachable, spec) => {
        const d = synthesizeDecision(reachable, spec);
        if (d.certificate.status === 'unsafe-possible') {
          expect(d.status).not.toBe('safe');
        } else {
          expect(d.status).toBe('safe');
        }
        expect(d.status).not.toBe('unknown');
      }),
      fcParams
    );
  });

  it('severityScore ∈ [0, 1] y vale 0 exactamente cuando es proven-safe', () => {
    fc.assert(
      fc.property(reachableArb(), specArb(), (reachable, spec) => {
        const s = severityScore(reachable, spec);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
        expect(Number.isNaN(s)).toBe(false);

        if (certifySafety(reachable, spec).status === 'proven-safe') {
          expect(s).toBeCloseTo(0, 12);
        }
      }),
      fcParams
    );
  });

  it('violationFraction sigue siendo alias exacto de severity', () => {
    fc.assert(
      fc.property(reachableArb(), specArb(), (reachable, spec) => {
        const d = synthesizeDecision(reachable, spec);
        expect(d.violationFraction).toBe(d.severity);
      }),
      fcParams
    );
  });
});
