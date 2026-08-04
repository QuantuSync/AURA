/**
 * Invariantes del hindcast que no se ven en su salida.
 *
 * El `results.json` del hindcast enseña lo que el pipeline dice de dos eventos
 * reales. Lo que NO enseña es si la serie que entró estaba bien construida, y
 * ahí es donde viven los fallos silenciosos de un experimento sobre datos
 * ajenos: un desfase horario entre proveedores, una hora imputada, una ventana
 * de pico que se mueve con la regla de conflicto. Ninguno de los tres haría
 * fallar nada; los tres invalidarían todos los números.
 *
 * Esto los cierra.
 */

import { describe, it, expect } from 'vitest';

import { createBPAFromGaussian } from '@/core/dempster-shafer/bpa';
import { PRECIPITATION_FRAME } from '@/lib/constants';

import { wrapCaveat } from '../../scripts/experiments/lib/hindcast-figures';
import { pignisticMean } from '../../scripts/experiments/lib/methods';
import {
  HourRecord,
  assertPowerLstIsUtc,
  peakWindow,
} from '../../scripts/experiments/lib/hindcast-series';
import { EVENT_E1, EVENT_E2, HINDCAST_FEEDS, captureUrl, stripVolatileFields } from '../../scripts/lib/hindcast-events';

const hourAt = (index: number, precipitation: number[]): HourRecord => ({
  timestamp: Date.UTC(2024, 9, 28, index),
  iso: `2024-10-28T${String(index).padStart(2, '0')}:00Z`,
  precipitation,
  temperature: precipitation.map(() => 15),
});

describe('alineación temporal de NASA POWER', () => {
  it('acepta las longitudes de los dos eventos, donde LST ≡ UTC', () => {
    expect(() => assertPowerLstIsUtc(EVENT_E1.point.longitude, EVENT_E1.id)).not.toThrow();
    expect(() => assertPowerLstIsUtc(EVENT_E2.point.longitude, EVENT_E2.id)).not.toThrow();
  });

  it('LANZA en una longitud donde LST se separa de UTC', () => {
    // 20 °E → round(20/15) = 1 h de desfase. Sin la comprobación, la serie de
    // POWER entraría desplazada una hora y el conflicto medido sería el de
    // comparar instantes distintos, sin nada en la salida que lo delatara.
    expect(() => assertPowerLstIsUtc(20, 'evento-ficticio')).toThrow(/LST/);
    expect(() => assertPowerLstIsUtc(-100, 'evento-ficticio')).toThrow(/desplazada/);
  });

  it('el margen es real: hasta ±7,5 ° el redondeo sigue dando 0', () => {
    expect(() => assertPowerLstIsUtc(7.4, 'x')).not.toThrow();
    expect(() => assertPowerLstIsUtc(7.6, 'x')).toThrow();
  });
});

describe('ventana de pico del perfil verify', () => {
  const series = [
    hourAt(0, [0, 0, 0]),
    hourAt(1, [10, 10, 10]),
    hourAt(2, [10, 10, 10]),
    hourAt(3, [0, 0, 0]),
    hourAt(4, [1, 1, 1]),
  ];

  it('elige la ventana de mayor precipitación media de las fuentes', () => {
    expect(peakWindow(series, 2).map((h) => h.iso)).toEqual([
      '2024-10-28T01:00Z',
      '2024-10-28T02:00Z',
    ]);
  });

  it('los empates se resuelven a favor de la ventana más temprana', () => {
    const flat = [hourAt(0, [5, 5, 5]), hourAt(1, [5, 5, 5]), hourAt(2, [5, 5, 5])];
    expect(peakWindow(flat, 2)[0].iso).toBe('2024-10-28T00:00Z');
  });

  it('con menos horas que la ventana devuelve la serie entera', () => {
    expect(peakWindow(series, 99)).toHaveLength(series.length);
  });

  it('depende SOLO de la entrada, no de nada que el pipeline pueda cambiar', () => {
    // La firma no admite ni configuración de fusión ni caracterización: si la
    // ventana dependiera de la regla de conflicto, cambiar la regla movería el
    // snapshot por dos motivos a la vez y el diff dejaría de ser legible.
    expect(peakWindow.length).toBe(2);
  });
});

describe('resumen pignístico de una BPA', () => {
  it('una BPA concentrada en una hipótesis da el centro de esa hipótesis', () => {
    // σ diminuta y δ = 0: toda la masa cae en 'ligera' [5, 15), centro 10.
    const bpa = createBPAFromGaussian(PRECIPITATION_FRAME, 10, 0.01, 0, 'x', 0);
    expect(pignisticMean(bpa)).toBeCloseTo(10, 6);
  });

  it('es monótono al desplazar la medición hacia arriba', () => {
    const at = (v: number) =>
      pignisticMean(createBPAFromGaussian(PRECIPITATION_FRAME, v, 1, 0.02, 'x', 0));
    expect(at(2)).toBeLessThan(at(10));
    expect(at(10)).toBeLessThan(at(40));
  });
});

describe('el caveat obligatorio cabe en la franja de la figura', () => {
  it('el titular de E2 se reparte en líneas sin lanzar', () => {
    const lines = wrapCaveat(EVENT_E2.caveatHeadline!);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join(' ')).toBe(EVENT_E2.caveatHeadline!.replace(/\s+/g, ' '));
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(118);
  });

  it('LANZA si el titular no cabe, en vez de truncar una advertencia obligatoria', () => {
    expect(() => wrapCaveat('palabra '.repeat(200), 40, 2)).toThrow(/no cabe/);
  });

  it('E1 no tiene caveat y E2 tiene los dos campos, o ninguno', () => {
    expect(EVENT_E1.caveat).toBeNull();
    expect(EVENT_E1.caveatHeadline).toBeNull();
    expect(EVENT_E2.caveat).not.toBeNull();
    expect(EVENT_E2.caveatHeadline).not.toBeNull();
  });
});

describe('captura', () => {
  it('las URLs de Open-Meteo piden UTC explícitamente', () => {
    for (const feed of HINDCAST_FEEDS.filter((f) => f.provider === 'open-meteo')) {
      const url = captureUrl(feed, EVENT_E1);
      expect(url).toContain('timezone=GMT');
      expect(url).toContain(`models=${feed.model}`);
      expect(url).toContain('hourly=precipitation,temperature_2m');
    }
  });

  it('la URL de POWER usa el endpoint HORARIO y la ventana completa', () => {
    const feed = HINDCAST_FEEDS.find((f) => f.provider === 'nasa-power')!;
    const url = captureUrl(feed, EVENT_E2);
    expect(url).toContain('/temporal/hourly/point');
    expect(url).toContain('start=20210106');
    expect(url).toContain('end=20210112');
  });

  it('los campos de temporización se eliminan: el checksum debe medir el DATO', () => {
    const stripped = stripVolatileFields({
      generationtime_ms: 12.5,
      times: { data: 1, process: 2 },
      hourly: { time: ['2024-10-28T00:00'] },
    }) as Record<string, unknown>;
    expect(stripped['generationtime_ms']).toBeUndefined();
    expect(stripped['times']).toBeUndefined();
    expect(stripped['hourly']).toEqual({ time: ['2024-10-28T00:00'] });
  });
});
