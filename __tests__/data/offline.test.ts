/**
 * Modo offline y parseo de las tres APIs.
 *
 * Lo que este fichero protege es que NINGÚN test toque la red. La comprobación
 * no es cosmética: un test que sale a internet no falla por el código, falla por
 * el tiempo que haga ese día — y entonces deja de ser una comprobación. Aquí
 * `fetch` se sustituye por un espía que LANZA, de modo que cualquier ruta que se
 * escape al transporte real rompe el test en vez de pasar desapercibida.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'node:path';

import { fetchAEMET, nearestStation, parseAemet, AemetObservation } from '@/data/sources/aemet';
import { fetchOpenMeteo, parseOpenMeteo } from '@/data/sources/open-meteo';
import {
  fetchNASAPOWER,
  latestValidHour,
  MM_PER_DAY_TO_MM_PER_HOUR,
  NasaPowerResponse,
  previousDayStamp,
} from '@/data/sources/nasa-power';
import {
  FIXTURE_SCENARIOS,
  isOffline,
  loadFixture,
  parseUtcTimestamp,
  resolveScenario,
} from '@/data/sources/offline';
import { DEMO_LOCATION, ingestAll, SOURCE_ORDER } from '@/data/ingest';
import { SOURCE_CHARACTERIZATIONS } from '@/data/sources/characterization';

const FIXTURES = path.resolve('fixtures');
const offline = (scenario: string) => ({ offline: true as const, scenario, fixturesDir: FIXTURES });

const { latitude, longitude } = DEMO_LOCATION;

// ─────────────────────────────────────────────────────────────────────────
// Barrera de red
// ─────────────────────────────────────────────────────────────────────────

const realFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = vi.fn(() => {
    throw new Error('un test ha intentado salir a la red');
  }) as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

describe('la suite no toca la red', () => {
  it('todos los escenarios se ingieren con `fetch` inutilizado', async () => {
    for (const scenario of FIXTURE_SCENARIOS) {
      const measurements = await ingestAll({ ...offline(scenario) });
      expect(measurements).toHaveLength(3);
    }
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('el modo online sí llamaría a fetch — la barrera no es un falso positivo', async () => {
    await expect(fetchOpenMeteo(latitude, longitude, { offline: false })).rejects.toThrow(
      /intentado salir a la red/
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Resolución de la configuración
// ─────────────────────────────────────────────────────────────────────────

describe('configuración del modo offline', () => {
  it('el modo por defecto NO cambia: sin AURA_OFFLINE ni config, es online', () => {
    const previous = process.env.AURA_OFFLINE;
    delete process.env.AURA_OFFLINE;
    try {
      expect(isOffline()).toBe(false);
      expect(isOffline({})).toBe(false);
    } finally {
      if (previous !== undefined) process.env.AURA_OFFLINE = previous;
    }
  });

  it('AURA_OFFLINE=1 activa el modo offline', () => {
    const previous = process.env.AURA_OFFLINE;
    process.env.AURA_OFFLINE = '1';
    try {
      expect(isOffline()).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.AURA_OFFLINE;
      else process.env.AURA_OFFLINE = previous;
    }
  });

  it('la config explícita tiene prioridad sobre el entorno, en los dos sentidos', () => {
    const previous = process.env.AURA_OFFLINE;
    process.env.AURA_OFFLINE = '1';
    try {
      expect(isOffline({ offline: false })).toBe(false);
      process.env.AURA_OFFLINE = '0';
      expect(isOffline({ offline: true })).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.AURA_OFFLINE;
      else process.env.AURA_OFFLINE = previous;
    }
  });

  it('el escenario por defecto es s1-normal', () => {
    const previous = process.env.AURA_FIXTURE_SCENARIO;
    delete process.env.AURA_FIXTURE_SCENARIO;
    try {
      expect(resolveScenario()).toBe('s1-normal');
    } finally {
      if (previous !== undefined) process.env.AURA_FIXTURE_SCENARIO = previous;
    }
  });

  it('un escenario inexistente LANZA con la ruta y los escenarios disponibles', async () => {
    await expect(loadFixture('open-meteo.json', offline('s9-inventado'))).rejects.toThrow(
      /s9-inventado/
    );
    await expect(loadFixture('open-meteo.json', offline('s9-inventado'))).rejects.toThrow(
      /Escenarios disponibles/
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Instantes en UTC
// ─────────────────────────────────────────────────────────────────────────

describe('parseUtcTimestamp', () => {
  it('interpreta como UTC una marca sin zona — si no, el fixture daría resultados distintos por máquina', () => {
    expect(parseUtcTimestamp('2026-03-10T09:00')).toBe(Date.UTC(2026, 2, 10, 9, 0));
    expect(parseUtcTimestamp('2026-03-10T09:00:00')).toBe(Date.UTC(2026, 2, 10, 9, 0));
  });

  it('respeta la zona cuando viene declarada', () => {
    expect(parseUtcTimestamp('2026-03-10T09:00:00Z')).toBe(Date.UTC(2026, 2, 10, 9, 0));
    expect(parseUtcTimestamp('2026-03-10T10:00:00+01:00')).toBe(Date.UTC(2026, 2, 10, 9, 0));
  });

  it('LANZA ante una marca no parseable', () => {
    expect(() => parseUtcTimestamp('ayer por la tarde')).toThrow(/no parseable/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Parseo por fuente
// ─────────────────────────────────────────────────────────────────────────

describe('Open-Meteo', () => {
  it('lee la precipitación de current y el instante de la observación', async () => {
    const m = await fetchOpenMeteo(latitude, longitude, offline('s2-light-rain'));
    expect(m.sourceId).toBe('open-meteo');
    expect(m.precipitation).toBe(9.0);
    expect(m.timestamp).toBe(Date.UTC(2026, 2, 10, 9, 0));
  });

  it('una respuesta sin bloque current LANZA', () => {
    expect(() =>
      parseOpenMeteo({ latitude, longitude } as never, latitude, longitude)
    ).toThrow(/sin bloque 'current'/);
  });
});

describe('AEMET', () => {
  it('elige la estación más cercana al punto pedido', async () => {
    const stations = await loadFixture<AemetObservation[]>(
      'aemet-observacion.json',
      offline('s2-light-rain')
    );
    expect(nearestStation(stations, latitude, longitude).idema).toBe('3129');
  });

  it('desempata por idema, para que el resultado no dependa del orden de la respuesta', () => {
    const equidistant: AemetObservation[] = [
      { idema: 'B', lat: latitude + 0.1, lon: longitude, fint: '2026-03-10T09:00:00' },
      { idema: 'A', lat: latitude - 0.1, lon: longitude, fint: '2026-03-10T09:00:00' },
    ];
    expect(nearestStation(equidistant, latitude, longitude).idema).toBe('A');
    expect(nearestStation([...equidistant].reverse(), latitude, longitude).idema).toBe('A');
  });

  it('convierte la velocidad del viento de m/s a km/h', () => {
    const m = parseAemet(
      [{ idema: '1', lat: latitude, lon: longitude, fint: '2026-03-10T09:00:00', vv: 10 }],
      latitude,
      longitude
    );
    expect(m.windSpeed).toBeCloseTo(36, 12);
  });

  it('un sobre con estado distinto de 200 LANZA en lugar de intentar parsear', async () => {
    const stations: AemetObservation[] = [];
    expect(() => parseAemet(stations, latitude, longitude)).toThrow(/ninguna estación/);
  });

  it('lee los dos pasos del fixture y devuelve la precipitación de la estación elegida', async () => {
    const m = await fetchAEMET(latitude, longitude, '', offline('s2-light-rain'));
    expect(m.sourceId).toBe('aemet');
    expect(m.precipitation).toBe(8.0);
  });
});

describe('NASA POWER', () => {
  it('convierte PRECTOTCORR de mm/day a mm/h — el error de factor 24 de la versión anterior', async () => {
    const m = await fetchNASAPOWER(latitude, longitude, offline('s2-light-rain'));
    expect(MM_PER_DAY_TO_MM_PER_HOUR).toBe(24);
    // El fixture declara 180 mm/day en la última hora válida.
    expect(m.precipitation).toBeCloseTo(180 / 24, 12);
    expect(m.precipitation).toBe(7.5);
  });

  it('salta las horas marcadas con fill_value (−999) y toma la última válida', async () => {
    const raw = await loadFixture<NasaPowerResponse>(
      'nasa-power.json',
      offline('s3-virga-conflict')
    );
    // El fixture deja las dos últimas horas sin dato: el reanálisis tiene latencia.
    expect(raw.properties.parameter.PRECTOTCORR['2026071823']).toBe(-999);
    expect(latestValidHour(raw)).toBe('2026071821');

    const m = await fetchNASAPOWER(latitude, longitude, offline('s3-virga-conflict'));
    expect(m.precipitation).toBe(25);
    expect(m.timestamp).toBe(Date.UTC(2026, 6, 18, 21));
  });

  it('exige las tres variables válidas en la MISMA hora', () => {
    const partial: NasaPowerResponse = {
      properties: {
        parameter: {
          PRECTOTCORR: { '2026031022': 24, '2026031023': 48 },
          WS10M: { '2026031022': 3, '2026031023': -999 },
          T2M: { '2026031022': 12, '2026031023': 12 },
        },
      },
    };
    expect(latestValidHour(partial)).toBe('2026031022');
  });

  it('LANZA si ninguna hora tiene dato, en lugar de devolver −999 como medición', () => {
    const empty: NasaPowerResponse = {
      properties: {
        parameter: {
          PRECTOTCORR: { '2026031023': -999 },
          WS10M: { '2026031023': -999 },
          T2M: { '2026031023': -999 },
        },
      },
    };
    expect(() => latestValidHour(empty)).toThrow(/ninguna de las 1 horas/);
  });

  it('previousDayStamp devuelve el día anterior en UTC', () => {
    expect(previousDayStamp(Date.UTC(2026, 0, 1, 3))).toBe('20251231');
    expect(previousDayStamp(Date.UTC(2026, 2, 11, 0))).toBe('20260310');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Ingesta conjunta
// ─────────────────────────────────────────────────────────────────────────

describe('ingestAll', () => {
  it('devuelve las tres fuentes en el orden fijo declarado', async () => {
    const measurements = await ingestAll(offline('s2-light-rain'));
    expect(measurements.map((m) => m.sourceId)).toEqual([...SOURCE_ORDER]);
  });

  it('aplica la caracterización única de cada fuente (σ y δ)', async () => {
    const measurements = await ingestAll(offline('s2-light-rain'));
    for (const m of measurements) {
      const c = SOURCE_CHARACTERIZATIONS.find((x) => x.sourceId === m.sourceId)!;
      expect(m.precipitationStddev).toBe(c.precipitationStddev);
      expect(m.failureRate).toBe(c.failureRate);
    }
  });

  it('en modo online sin clave de AEMET LANZA antes de salir a la red', async () => {
    await expect(ingestAll({ offline: false })).rejects.toThrow(/AEMET OpenData exige API key/);
  });

  it('cada escenario produce las precipitaciones que declara su manifest', async () => {
    for (const scenario of FIXTURE_SCENARIOS) {
      const manifest = await loadFixture<{
        expectedPrecipitationMmH: Record<string, number>;
      }>('manifest.json', offline(scenario));
      const measurements = await ingestAll(offline(scenario));
      for (const m of measurements) {
        expect(m.precipitation).toBeCloseTo(manifest.expectedPrecipitationMmH[m.sourceId], 12);
      }
    }
  });
});
