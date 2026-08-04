/**
 * Bloqueo de la caracterización DECLARADA A PRIORI del hindcast.
 *
 * `src/data/sources/hindcast-characterization.ts` fija σ y δ de las tres fuentes
 * del hindcast ANTES de haber ejecutado el pipeline sobre un solo dato real. La
 * regla de esa iteración es explícita: si los resultados sugieren que la
 * caracterización es mala, **se reporta, no se retoca**.
 *
 * Una regla que solo vive en un comentario no es una regla. Este fichero la
 * convierte en un invariante comprobado: pinea los valores derivados uno a uno,
 * de modo que cualquier retoque —el legítimo incluido— rompe la suite y aparece
 * en el diff del pull request como una redeclaración deliberada de una hipótesis
 * del sistema, en vez de como un ajuste silencioso entre dos ejecuciones.
 *
 * Se pinean los valores DERIVADOS y no solo las constantes de las reglas: mover
 * `cellSizeKm` de una fuente tendría el mismo efecto que mover su σ a mano, y
 * pinear solo `SIGMA_P_PER_10KM` no lo detectaría.
 */

import { describe, it, expect } from 'vitest';
import {
  ECMWF_IFS_CHARACTERIZATION,
  ERA5_CHARACTERIZATION,
  HINDCAST_FAILURE_RATE,
  HINDCAST_SOURCES,
  NASA_POWER_MERRA2_CHARACTERIZATION,
  REFERENCE_CELL_KM,
  SIGMA_P_PER_10KM,
  SIGMA_T_AT_10KM,
  sigmaPrecipitation,
  sigmaTemperature,
} from '@/data/sources/hindcast-characterization';

describe('caracterización a priori del hindcast', () => {
  it('las constantes de las dos reglas de escalado son las declaradas', () => {
    expect(REFERENCE_CELL_KM).toBe(10);
    expect(SIGMA_P_PER_10KM).toBe(2.0);
    expect(SIGMA_T_AT_10KM).toBe(1.0);
    expect(HINDCAST_FAILURE_RATE).toBe(0.02);
  });

  it('σ_P es lineal en el lado de celda y σ_T va en su raíz', () => {
    // Duplicar el lado duplica σ_P y multiplica σ_T por √2. Es la diferencia
    // entre un campo intermitente y uno suave, y es lo único que las dos reglas
    // afirman.
    expect(sigmaPrecipitation(20)).toBeCloseTo(2 * sigmaPrecipitation(10), 12);
    expect(sigmaTemperature(20)).toBeCloseTo(Math.SQRT2 * sigmaTemperature(10), 12);
    expect(sigmaPrecipitation(REFERENCE_CELL_KM)).toBe(SIGMA_P_PER_10KM);
    expect(sigmaTemperature(REFERENCE_CELL_KM)).toBe(SIGMA_T_AT_10KM);
  });

  it.each([
    ['era5', ERA5_CHARACTERIZATION, 25, 5.0, 1.5811388300841898],
    ['ecmwf-ifs', ECMWF_IFS_CHARACTERIZATION, 9, 1.8, 0.9486832980505138],
    ['nasa-power', NASA_POWER_MERRA2_CHARACTERIZATION, 50, 10.0, 2.23606797749979],
  ])(
    '%s: tamaño de celda, σ_P, σ_T y δ son EXACTAMENTE los declarados a priori',
    (sourceId, c, cellSizeKm, sigmaP, sigmaT) => {
      expect(c.sourceId).toBe(sourceId);
      expect(c.cellSizeKm).toBe(cellSizeKm);
      expect(c.precipitationStddev).toBeCloseTo(sigmaP as number, 12);
      expect(c.temperatureStddev).toBeCloseTo(sigmaT as number, 12);
      expect(c.failureRate).toBe(HINDCAST_FAILURE_RATE);
    }
  );

  it('las tres δ son iguales: no hay base para ordenar los productos por fiabilidad', () => {
    const rates = new Set(HINDCAST_SOURCES.map((s) => s.failureRate));
    expect(rates.size).toBe(1);
  });

  it('σ crece con el tamaño de celda en las tres fuentes, sin empates', () => {
    const bySize = [...HINDCAST_SOURCES].sort((a, b) => a.cellSizeKm - b.cellSizeKm);
    expect(bySize.map((s) => s.sourceId)).toEqual(['ecmwf-ifs', 'era5', 'nasa-power']);
    for (let i = 1; i < bySize.length; i++) {
      expect(bySize[i].precipitationStddev).toBeGreaterThan(bySize[i - 1].precipitationStddev);
      expect(bySize[i].temperatureStddev).toBeGreaterThan(bySize[i - 1].temperatureStddev);
    }
  });

  it('toda δ está en [0, 1) y todo σ es positivo, como exige la Def. 3.4', () => {
    for (const c of HINDCAST_SOURCES) {
      expect(c.failureRate).toBeGreaterThanOrEqual(0);
      expect(c.failureRate).toBeLessThan(1);
      expect(c.precipitationStddev).toBeGreaterThan(0);
      expect(c.temperatureStddev).toBeGreaterThan(0);
    }
  });

  it('el orden de las fuentes es parte del contrato de los artefactos versionados', () => {
    expect(HINDCAST_SOURCES.map((s) => s.sourceId)).toEqual([
      'era5',
      'ecmwf-ifs',
      'nasa-power',
    ]);
  });
});
