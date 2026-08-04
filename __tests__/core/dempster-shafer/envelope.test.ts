import { describe, it, expect } from 'vitest';
import { computeEnvelope, envelopeCombine, fuse } from '@/core/dempster-shafer/combination';
import { allBeliefPlausibility, createBPAFromGaussian } from '@/core/dempster-shafer/bpa';
import { buildCredalSet, verifyCoverage } from '@/core/dempster-shafer/credal-set';
import { BPA, FrameOfDiscernment } from '@/core/dempster-shafer/types';

const precipFrame: FrameOfDiscernment = {
  variable: 'precipitation',
  unit: 'mm/h',
  hypotheses: [
    { label: 'none', lower: 0, upper: 5 },
    { label: 'light', lower: 5, upper: 15 },
    { label: 'moderate', lower: 15, upper: 30 },
    { label: 'heavy', lower: 30, upper: 60 },
    { label: 'torrential', lower: 60, upper: Infinity },
  ],
};

/** Pl de la BPA sintética que devuelve `envelopeCombine`, por hipótesis. */
function syntheticPlausibilities(bpas: BPA[]): number[] {
  return allBeliefPlausibility(envelopeCombine(bpas)).map((bp) => bp.plausibility);
}

// ─────────────────────────────────────────────────────────────────────────
// (a) Cobertura — Definición 3.7
// ─────────────────────────────────────────────────────────────────────────

describe('computeEnvelope — cobertura (Definición 3.7)', () => {
  it('contiene el [Bel, Pl] de cada fuente individual', () => {
    const sources = [
      createBPAFromGaussian(precipFrame, 3, 2, 0.05, 'satellite'),
      createBPAFromGaussian(precipFrame, 25, 3, 0.1, 'gauge'),
      createBPAFromGaussian(precipFrame, 12, 4, 0.2, 'radar'),
    ];
    const envelope = computeEnvelope(sources);

    for (const bpa of sources) {
      const bp = allBeliefPlausibility(bpa);
      for (let j = 0; j < precipFrame.hypotheses.length; j++) {
        expect(envelope.bounds[j].lower).toBeLessThanOrEqual(bp[j].belief + 1e-12);
        expect(envelope.bounds[j].upper).toBeGreaterThanOrEqual(bp[j].plausibility - 1e-12);
      }
    }
  });

  it('lower = min Bel_i y upper = max Pl_i exactamente', () => {
    const sources = [
      createBPAFromGaussian(precipFrame, 8, 2, 0.1, 's1'),
      createBPAFromGaussian(precipFrame, 40, 5, 0.15, 's2'),
    ];
    const envelope = computeEnvelope(sources);
    const perSource = sources.map((b) => allBeliefPlausibility(b));

    for (let j = 0; j < precipFrame.hypotheses.length; j++) {
      expect(envelope.bounds[j].lower).toBeCloseTo(
        Math.min(...perSource.map((bp) => bp[j].belief)),
        12
      );
      expect(envelope.bounds[j].upper).toBeCloseTo(
        Math.max(...perSource.map((bp) => bp[j].plausibility)),
        12
      );
    }
  });

  it('mantiene lower ≤ upper en toda hipótesis', () => {
    const sources = [
      createBPAFromGaussian(precipFrame, 2, 1, 0, 's1'),
      createBPAFromGaussian(precipFrame, 70, 8, 0.3, 's2'),
    ];
    for (const b of computeEnvelope(sources).bounds) {
      expect(b.lower).toBeLessThanOrEqual(b.upper);
    }
  });

  it('con una sola fuente reproduce su propio [Bel, Pl]', () => {
    const bpa = createBPAFromGaussian(precipFrame, 20, 4, 0.1, 'solo');
    const envelope = computeEnvelope([bpa]);
    const bp = allBeliefPlausibility(bpa);
    for (let j = 0; j < precipFrame.hypotheses.length; j++) {
      expect(envelope.bounds[j].lower).toBeCloseTo(bp[j].belief, 12);
      expect(envelope.bounds[j].upper).toBeCloseTo(bp[j].plausibility, 12);
    }
  });

  it('lanza si no hay fuentes', () => {
    expect(() => computeEnvelope([])).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// (b) Tightness — la envolvente exacta no es más ancha que la BPA sintética
// ─────────────────────────────────────────────────────────────────────────

describe('computeEnvelope — tightness frente a la BPA sintética', () => {
  it('upper del Envelope ≤ Pl de la BPA sintética en toda hipótesis', () => {
    const scenarios: [number, number][] = [
      [3, 25],
      [10, 45],
      [2, 70],
      [20, 22],
    ];

    for (const [v1, v2] of scenarios) {
      const sources = [
        createBPAFromGaussian(precipFrame, v1, 3, 0.05, 's1'),
        createBPAFromGaussian(precipFrame, v2, 3, 0.05, 's2'),
      ];
      const envelope = computeEnvelope(sources);
      const syntheticPl = syntheticPlausibilities(sources);

      for (let j = 0; j < precipFrame.hypotheses.length; j++) {
        expect(envelope.bounds[j].upper).toBeLessThanOrEqual(syntheticPl[j] + 1e-12);
      }
    }
  });

  it('la desigualdad es ESTRICTA en un caso construido', () => {
    // Dos fuentes concentradas en hipótesis disjuntas: 'heavy' y 'torrential'
    // no reciben masa de ninguna, luego su max Pl_i ≈ 0. La BPA sintética, en
    // cambio, les asigna toda la masa de Θ y les da Pl ≫ 0.
    const sources = [
      createBPAFromGaussian(precipFrame, 2, 0.5, 0, 'satellite'),
      createBPAFromGaussian(precipFrame, 10, 0.5, 0, 'gauge'),
    ];
    const envelope = computeEnvelope(sources);
    const syntheticPl = syntheticPlausibilities(sources);

    const heavy = 3;
    expect(envelope.bounds[heavy].upper).toBeLessThan(syntheticPl[heavy] - 1e-6);
    expect(envelope.bounds[heavy].upper).toBeLessThan(0.01);
    expect(syntheticPl[heavy]).toBeGreaterThan(0.4);

    // Y hay al menos una hipótesis con separación estricta, que es lo que
    // significa "la sintética sobre-aproxima".
    const strictlyTighter = envelope.bounds.filter(
      (b, j) => b.upper < syntheticPl[j] - 1e-9
    ).length;
    expect(strictlyTighter).toBeGreaterThan(0);
  });

  it('el lower coincide: la sobre-aproximación está solo en el upper', () => {
    const sources = [
      createBPAFromGaussian(precipFrame, 3, 2, 0, 's1'),
      createBPAFromGaussian(precipFrame, 25, 2, 0, 's2'),
    ];
    const envelope = computeEnvelope(sources);
    const syntheticBel = allBeliefPlausibility(envelopeCombine(sources)).map((bp) => bp.belief);

    for (let j = 0; j < precipFrame.hypotheses.length; j++) {
      expect(envelope.bounds[j].lower).toBeCloseTo(syntheticBel[j], 9);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Integración: fuse + lifting a intervalo continuo (Definición 3.9)
// ─────────────────────────────────────────────────────────────────────────

describe('fuse expone la envolvente exacta y el lifting la usa', () => {
  it('envelope solo está presente cuando method === "envelope"', () => {
    const agree = fuse(
      [
        createBPAFromGaussian(precipFrame, 20, 5, 0.05, 's1'),
        createBPAFromGaussian(precipFrame, 22, 4, 0.05, 's2'),
      ],
      [0.05, 0.05]
    );
    expect(agree.method).toBe('dempster');
    expect(agree.envelope).toBeUndefined();

    const contradict = fuse(
      [
        createBPAFromGaussian(precipFrame, 3, 2, 0, 's1'),
        createBPAFromGaussian(precipFrame, 50, 2, 0, 's2'),
      ],
      [0, 0]
    );
    expect(contradict.method).toBe('envelope');
    expect(contradict.envelope).toBeDefined();
    expect(contradict.envelope!.bounds.length).toBe(precipFrame.hypotheses.length);
  });

  it('el CredalSet toma sus bounds de la envolvente exacta', () => {
    const sources = [
      createBPAFromGaussian(precipFrame, 3, 1, 0, 'satellite'),
      createBPAFromGaussian(precipFrame, 10, 1, 0, 'gauge'),
    ];
    const result = fuse(sources, [0, 0]);
    expect(result.method).toBe('envelope');

    const cs = buildCredalSet(result);
    const envelope = result.envelope!;
    for (let j = 0; j < precipFrame.hypotheses.length; j++) {
      expect(cs.bounds[j].belief).toBeCloseTo(envelope.bounds[j].lower, 12);
      expect(cs.bounds[j].plausibility).toBeCloseTo(envelope.bounds[j].upper, 12);
    }
    expect(verifyCoverage(cs)).toBe(true);
  });

  it('el intervalo continuo (Def 3.9) es más informativo con la envolvente exacta', () => {
    const sources = [
      createBPAFromGaussian(precipFrame, 3, 0.5, 0, 'satellite'),
      createBPAFromGaussian(precipFrame, 10, 0.5, 0, 'gauge'),
    ];
    const result = fuse(sources, [0, 0]);

    const exact = buildCredalSet(result);
    // Mismo resultado de fusión, pero forzando la ruta antigua (BPA sintética).
    const overApprox = buildCredalSet({ ...result, envelope: undefined });

    const width = (cs: typeof exact) =>
      cs.continuousInterval.upper - cs.continuousInterval.lower;

    expect(width(exact)).toBeLessThan(width(overApprox));
    // La sobre-aproximación arrastra hipótesis que ninguna fuente cree posibles.
    expect(overApprox.continuousInterval.upper).toBeGreaterThan(30);
    expect(exact.continuousInterval.upper).toBeLessThanOrEqual(15);

    // Aun siendo más estrecho, sigue cubriendo ambas mediciones.
    expect(exact.continuousInterval.lower).toBeLessThanOrEqual(3);
    expect(exact.continuousInterval.upper).toBeGreaterThanOrEqual(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// (c) Caso virga del paper: satélite 25 mm/h vs pluviómetro 3 mm/h
// ─────────────────────────────────────────────────────────────────────────

describe('caso virga (satélite 25 mm/h, pluviómetro 3 mm/h)', () => {
  // Virga: el satélite ve precipitación en altura que se evapora antes de
  // llegar al suelo, donde mide el pluviómetro. Ambos sensores funcionan
  // correctamente y aun así se contradicen — el caso que motiva no fusionar.
  const satellite = createBPAFromGaussian(precipFrame, 25, 3, 0.05, 'satellite');
  const gauge = createBPAFromGaussian(precipFrame, 3, 1, 0.02, 'rain-gauge');

  it('el conflicto es alto y dispara la envolvente', () => {
    const result = fuse([satellite, gauge], [0.05, 0.02]);
    expect(result.maxConflict).toBeGreaterThan(0.7);
    expect(result.method).toBe('envelope');
    expect(result.envelope).toBeDefined();
  });

  it('la envolvente cubre a ambos sensores sin descartar ninguno', () => {
    const envelope = computeEnvelope([satellite, gauge]);

    for (const bpa of [satellite, gauge]) {
      const bp = allBeliefPlausibility(bpa);
      for (let j = 0; j < precipFrame.hypotheses.length; j++) {
        expect(envelope.bounds[j].lower).toBeLessThanOrEqual(bp[j].belief + 1e-12);
        expect(envelope.bounds[j].upper).toBeGreaterThanOrEqual(bp[j].plausibility - 1e-12);
      }
    }

    // 'none' (pluviómetro) y 'moderate' (satélite) siguen siendo plausibles:
    // la envolvente no elige ganador.
    expect(envelope.bounds[0].upper).toBeGreaterThan(0.5);
    expect(envelope.bounds[2].upper).toBeGreaterThan(0.5);
  });

  it('ninguna hipótesis queda con creencia forzada: min Bel es bajo en todas', () => {
    // Cada fuente asigna Bel≈0 a la hipótesis que la otra defiende, luego el
    // mínimo es ~0 en ambas. La envolvente es ancha porque el desacuerdo es real.
    const envelope = computeEnvelope([satellite, gauge]);
    expect(envelope.bounds[0].lower).toBeLessThan(0.01); // 'none'
    expect(envelope.bounds[2].lower).toBeLessThan(0.01); // 'moderate'
  });

  it('el intervalo continuo abarca ambas lecturas (3 y 25 mm/h)', () => {
    const cs = buildCredalSet(fuse([satellite, gauge], [0.05, 0.02]));
    expect(cs.continuousInterval.lower).toBeLessThanOrEqual(3);
    expect(cs.continuousInterval.upper).toBeGreaterThanOrEqual(25);
    expect(isFinite(cs.continuousInterval.upper)).toBe(true);
  });
});
