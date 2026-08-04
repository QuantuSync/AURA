/**
 * Acuerdo entre la caracterización de las fuentes y el escenario de referencia.
 *
 * Estas dos declaraciones —`SOURCE_CHARACTERIZATIONS` (lo que la ingesta real
 * asume de cada fuente) y `DEMO_SOURCES_LIGHT_RAIN` / `DEMO_SOURCES_HEAVY_RAIN`
 * (lo que asume el escenario publicado)— hablan de las MISMAS tres fuentes.
 * Estuvieron en desacuerdo mientras fueron caminos separados; desde que
 * `npm run repro` alimenta la demo desde la ingesta, el desacuerdo se convierte
 * en un número del paper que no se reproduce.
 *
 * Este fichero convierte ese acuerdo en un invariante comprobado.
 */

import { describe, it, expect } from 'vitest';
import {
  DEMO_SOURCES_HEAVY_RAIN,
  DEMO_SOURCES_LIGHT_RAIN,
  DemoSource,
  runDemoPipeline,
} from '@/core/pipeline/demo-pipeline';
import { SOURCE_CHARACTERIZATIONS } from '@/data/sources/characterization';

const characterizationOf = (sourceId: string) => {
  const c = SOURCE_CHARACTERIZATIONS.find((x) => x.sourceId === sourceId);
  expect(c, `no hay caracterización para '${sourceId}'`).toBeDefined();
  return c!;
};

describe('la caracterización de las fuentes y el escenario de referencia coinciden', () => {
  it.each([
    ['lluvia ligera', DEMO_SOURCES_LIGHT_RAIN],
    ['lluvia intensa', DEMO_SOURCES_HEAVY_RAIN],
  ])('%s: σ y δ de cada fuente son los declarados en la ingesta', (_label, sources: DemoSource[]) => {
    for (const s of sources) {
      const c = characterizationOf(s.sourceId);
      expect(s.stddev).toBe(c.precipitationStddev);
      expect(s.failureRate).toBe(c.failureRate);
    }
  });

  it('cubre exactamente las tres fuentes de la demo, sin sobrantes ni ausencias', () => {
    expect(SOURCE_CHARACTERIZATIONS.map((c) => c.sourceId).sort()).toEqual([
      'aemet',
      'nasa-power',
      'open-meteo',
    ]);
  });

  it('toda δ está en [0, 1) y todo σ es positivo, como exige la Def. 3.4', () => {
    for (const c of SOURCE_CHARACTERIZATIONS) {
      expect(c.failureRate).toBeGreaterThanOrEqual(0);
      expect(c.failureRate).toBeLessThan(1);
      expect(c.precipitationStddev).toBeGreaterThan(0);
      expect(c.windSpeedStddev).toBeGreaterThan(0);
      expect(c.temperatureStddev).toBeGreaterThan(0);
    }
  });

  it('reconstruir el escenario de referencia desde la caracterización da el plUpper publicado', () => {
    // Es la comprobación que importa: si alguien cambia una σ o una δ en
    // cualquiera de los dos sitios, este número deja de salir.
    const sources: DemoSource[] = DEMO_SOURCES_LIGHT_RAIN.map((s) => {
      const c = characterizationOf(s.sourceId);
      return {
        sourceId: c.sourceId,
        value: s.value,
        stddev: c.precipitationStddev,
        failureRate: c.failureRate,
      };
    });

    const r = runDemoPipeline({ sources });
    expect(r.probabilityBounds.plUpper).toBeCloseTo(1.559438e-4, 9);
    expect(r.probabilityBounds.belLower).toBe(0);
  });
});
