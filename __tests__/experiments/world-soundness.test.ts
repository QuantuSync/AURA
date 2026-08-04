/**
 * AURA v2 — Invariantes del mundo sintético y de los estimadores comparados
 *
 * Bloquea las propiedades de las que depende la LECTURA de los tres
 * experimentos de cobertura (`scripts/experiments/`). No son tests del motor —
 * eso lo hacen `__tests__/core/` y las properties—, son tests del banco de
 * pruebas: si el banco se rompe, sus números dejan de significar lo que dicen
 * significar y nadie se entera, porque un experimento siempre devuelve un
 * número.
 *
 * La comprobación central es la de soundness:
 *
 *   H0 se cumple en TODOS los mundos por construcción (P* se sortea en
 *   [0, 120] y el marco declara P_máx = 500), de modo que el Lema 6.1 obliga al
 *   intervalo credal de la Ec. (10) a contener P*. Una sola excepción sería un
 *   fallo de soundness del Puente 1→2, no un resultado del experimento.
 */

import { describe, expect, it } from 'vitest';

import { makeRng } from '@/lib/prng';
import { PRECIPITATION_FRAME } from '@/lib/constants';
import { CONFLICT_RULE_IDS } from '@/core/dempster-shafer/conflict-rules';
import { DEFAULT_FUSION_CONFIG } from '@/core/dempster-shafer/types';

import {
  contains,
  evaluate,
  METHOD_IDS,
  weightedMeanEstimate,
  kalmanEstimate,
} from '../../scripts/experiments/lib/methods';
import {
  DEFAULT_WORLD_CONFIG,
  DOMAIN,
  INTENSITY_BANDS,
  sampleWorld,
  SOURCES,
  WorldConfig,
} from '../../scripts/experiments/lib/world';
import { wilsonInterval } from '../../scripts/experiments/lib/stats';

/** Suficientes mundos para cubrir las tres condiciones sin encarecer la suite. */
const N = 2000;
const SEED = 20260804;

const CONFIGS: Record<string, WorldConfig> = {
  'mezcla por defecto': DEFAULT_WORLD_CONFIG,
  'solo virga': { ...DEFAULT_WORLD_CONFIG, virgaOnly: true, virgaProbability: 1 },
  'H1 violada al 50 %': { ...DEFAULT_WORLD_CONFIG, jointFailureProbability: 0.5 },
};

describe('mundo sintético', () => {
  it('sortea P* dentro del dominio declarado por H0, siempre', () => {
    const rng = makeRng(SEED);
    const maxBand = Math.max(...INTENSITY_BANDS.map((b) => b.upper));

    for (let i = 0; i < N; i++) {
      const w = sampleWorld(rng, DEFAULT_WORLD_CONFIG);
      expect(w.truth).toBeGreaterThanOrEqual(DOMAIN.lower);
      expect(w.truth).toBeLessThanOrEqual(maxBand);
      // El margen frente a P_máx es lo que permite leer un fallo de cobertura
      // existencial como bug y no como violación de H0.
      expect(maxBand).toBeLessThan(PRECIPITATION_FRAME.domainBound);
    }
  });

  it('mantiene toda medición dentro del marco', () => {
    const rng = makeRng(SEED);
    for (let i = 0; i < N; i++) {
      const w = sampleWorld(rng, DEFAULT_WORLD_CONFIG);
      for (const v of w.values) {
        expect(v).toBeGreaterThanOrEqual(DOMAIN.lower);
        expect(v).toBeLessThanOrEqual(DOMAIN.upper);
      }
    }
  });

  it('reparte la virga con al menos una fuente arriba y otra abajo', () => {
    const rng = makeRng(SEED);
    for (let i = 0; i < N; i++) {
      const w = sampleWorld(rng, CONFIGS['solo virga']);
      expect(w.virga).toBe(true);
      const down = w.attenuated.filter(Boolean).length;
      expect(down).toBeGreaterThanOrEqual(1);
      expect(down).toBeLessThanOrEqual(SOURCES.length - 1);
      expect(w.gamma).toBeGreaterThanOrEqual(0);
      expect(w.gamma).toBeLessThanOrEqual(1);
    }
  });

  it('es reproducible: misma semilla, mismos mundos', () => {
    const a = makeRng(SEED);
    const b = makeRng(SEED);
    for (let i = 0; i < 200; i++) {
      expect(sampleWorld(a, DEFAULT_WORLD_CONFIG)).toEqual(sampleWorld(b, DEFAULT_WORLD_CONFIG));
    }
  });
});

/**
 * REQUISITO INNEGOCIABLE (c) del experimento pre-registrado de `docs/ERRATA.md`
 * §9: la campaña de soundness se corre con LAS CUATRO reglas de conflicto, no
 * solo con la seleccionada. Una regla que pierda la cobertura existencial queda
 * descalificada por informativa que sea, y como las cuatro siguen disponibles
 * por configuración, la que no se seleccione tampoco puede quedar rota.
 *
 * 3 configuraciones de mundo × 4 reglas × 2.000 mundos = 24.000 pipelines
 * credales completos. Es el test más caro de la suite y lo vale: es el único
 * sitio donde la soundness se comprueba sobre el motor entero y no sobre una
 * pieza.
 */
describe('soundness del nivel existencial (Lema 6.1)', () => {
  for (const rule of CONFLICT_RULE_IDS) {
    const fusionConfig = { ...DEFAULT_FUSION_CONFIG, rule };

    for (const [label, config] of Object.entries(CONFIGS)) {
      it(`contiene P* en todos los mundos — regla ${rule}, ${label}`, () => {
        const rng = makeRng(SEED);
        const misses: { truth: number; interval: unknown; values: number[] }[] = [];

        for (let i = 0; i < N; i++) {
          const w = sampleWorld(rng, config);
          const iv = evaluate(w, fusionConfig).intervals['aura-existencial'];
          if (!contains(iv, w.truth)) {
            misses.push({ truth: w.truth, interval: iv, values: w.values });
          }
        }

        // El mensaje lleva el testigo: un fallo aquí exige depurar el Puente
        // 1→2, no reejecutar con otra semilla.
        expect(
          misses,
          `regla ${rule} · testigos de violación de la Ec. (10): ${JSON.stringify(misses.slice(0, 3))}`
        ).toHaveLength(0);
      });
    }
  }

  it('la banda de evidencia nunca excede al nivel existencial, bajo ninguna regla', () => {
    // La banda es el nivel informativo y no lleva garantía, pero sí lleva esta
    // relación estructural: es un subconjunto del hull credal. Si una regla la
    // rompiera, los números de informatividad del experimento dejarían de ser
    // comparables entre reglas.
    for (const rule of CONFLICT_RULE_IDS) {
      const fusionConfig = { ...DEFAULT_FUSION_CONFIG, rule };
      const rng = makeRng(SEED);
      for (let i = 0; i < 500; i++) {
        const w = sampleWorld(rng, DEFAULT_WORLD_CONFIG);
        const ev = evaluate(w, fusionConfig);
        expect(ev.intervals['aura-banda-95'].lower).toBeGreaterThanOrEqual(
          ev.intervals['aura-existencial'].lower
        );
        expect(ev.intervals['aura-banda-95'].upper).toBeLessThanOrEqual(
          ev.intervals['aura-existencial'].upper
        );
        expect(ev.aura.rule).toBe(rule);
      }
    }
  });
});

describe('estimadores comparados', () => {
  it('devuelven intervalos bien formados y no vacíos', () => {
    const rng = makeRng(SEED);
    for (let i = 0; i < N; i++) {
      const w = sampleWorld(rng, DEFAULT_WORLD_CONFIG);
      const ev = evaluate(w);
      for (const id of METHOD_IDS) {
        const iv = ev.intervals[id];
        expect(Number.isFinite(iv.lower)).toBe(true);
        expect(Number.isFinite(iv.upper)).toBe(true);
        expect(iv.upper).toBeGreaterThan(iv.lower);
        expect(iv.width).toBeCloseTo(iv.upper - iv.lower, 12);
      }
    }
  });

  it('la banda de evidencia nunca excede al nivel existencial', () => {
    const rng = makeRng(SEED);
    for (let i = 0; i < N; i++) {
      const w = sampleWorld(rng, DEFAULT_WORLD_CONFIG);
      const ev = evaluate(w);
      const band = ev.intervals['aura-banda-95'];
      const hull = ev.intervals['aura-existencial'];
      expect(band.lower).toBeGreaterThanOrEqual(hull.lower);
      expect(band.upper).toBeLessThanOrEqual(hull.upper);
    }
  });

  it('Kalman es más estrecho que la media ponderada: suma de precisiones', () => {
    const world = {
      truth: 10,
      band: 'ligera',
      condition: 'clean' as const,
      values: [10, 10, 10],
      failed: [false, false, false],
      virga: false,
      gamma: 0,
      attenuated: [false, false, false],
    };
    expect(kalmanEstimate(world).width).toBeLessThan(weightedMeanEstimate(world).width);
  });

  it('los dos baselines centran en la media ponderada de sus pesos', () => {
    const world = {
      truth: 20,
      band: 'moderada',
      condition: 'clean' as const,
      values: [18, 20, 24],
      failed: [false, false, false],
      virga: false,
      gamma: 0,
      attenuated: [false, false, false],
    };

    const w = SOURCES.map((c) => 1 - c.failureRate);
    const sw = w.reduce((s, x) => s + x, 0);
    const expected = w.reduce((s, x, i) => s + (x / sw) * world.values[i], 0);
    const wm = weightedMeanEstimate(world);
    expect((wm.lower + wm.upper) / 2).toBeCloseTo(expected, 10);

    const p = SOURCES.map((c) => 1 / c.precipitationStddev ** 2);
    const sp = p.reduce((s, x) => s + x, 0);
    const expectedK = p.reduce((s, x, i) => s + (x / sp) * world.values[i], 0);
    const km = kalmanEstimate(world);
    expect((km.lower + km.upper) / 2).toBeCloseTo(expectedK, 10);
  });
});

describe('intervalo de Wilson', () => {
  it('no colapsa a anchura cero con proporción 1', () => {
    const ci = wilsonInterval(10000, 10000);
    // El upper de Wilson con p̂ = 1 vale exactamente 1 en ℝ; en coma flotante
    // sale a un ulp por debajo, y no se corrige a mano: forzarlo a 1 escondería
    // el día en que la fórmula deje de dar 1 por un motivo real.
    expect(ci.upper).toBeCloseTo(1, 12);
    expect(ci.lower).toBeLessThan(1);
    expect(ci.lower).toBeGreaterThan(0.999);
  });

  it('es simétrico bajo p ↔ 1 − p', () => {
    const a = wilsonInterval(300, 1000);
    const b = wilsonInterval(700, 1000);
    expect(a.lower).toBeCloseTo(1 - b.upper, 12);
    expect(a.upper).toBeCloseTo(1 - b.lower, 12);
  });

  it('se estrecha al crecer n', () => {
    const small = wilsonInterval(95, 100);
    const large = wilsonInterval(9500, 10000);
    expect(large.upper - large.lower).toBeLessThan(small.upper - small.lower);
  });
});
