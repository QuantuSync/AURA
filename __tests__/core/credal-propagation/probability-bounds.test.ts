import { describe, it, expect } from 'vitest';
import {
  probabilityBounds,
  probabilityIgnorance,
  unsafeProbabilityBounds,
} from '@/core/credal-propagation/probability-bounds';
import { createCredalIntervalSet } from '@/core/credal-propagation/credal-interval-set';
import { FrameRef } from '@/core/credal-propagation/types';
import { certifySafety } from '@/core/decision/synthesis';
import { SafetySpec } from '@/core/decision/types';

const ref: FrameRef = { variable: 'X', unit: 'u', domainBound: 100 };

const setOf = (elements: Array<[number, number, number]>) =>
  createCredalIntervalSet(
    elements.map(([mass, lower, upper]) => ({ mass, interval: { lower, upper } })),
    ref
  );

describe('probabilityBounds — Bel(E) y Pl(E) sobre un evento intervalar', () => {
  it('un focal ENTERAMENTE dentro cuenta para ambos bounds', () => {
    const set = setOf([
      [0.3, 60, 80],
      [0.7, 0, 10],
    ]);
    expect(probabilityBounds(set, { lower: 50, upper: 100 })).toEqual({
      belLower: 0.3,
      plUpper: 0.3,
    });
  });

  it('un focal que SOLO interseca cuenta para plUpper y no para belLower', () => {
    const set = setOf([
      [0.3, 40, 80], // desborda por abajo el evento [50,100]
      [0.7, 0, 10],
    ]);
    expect(probabilityBounds(set, { lower: 50, upper: 100 })).toEqual({
      belLower: 0,
      plUpper: 0.3,
    });
  });

  it('un focal DISJUNTO no cuenta para ninguno', () => {
    expect(probabilityBounds(setOf([[1, 0, 10]]), { lower: 50, upper: 100 })).toEqual({
      belLower: 0,
      plUpper: 0,
    });
  });

  it('los intervalos son CERRADOS: tocarse por un extremo cuenta como intersección', () => {
    const set = setOf([[1, 0, 50]]);
    expect(probabilityBounds(set, { lower: 50, upper: 100 })).toEqual({
      belLower: 0,
      plUpper: 1,
    });
  });

  it('evento que cubre todo el conjunto: Bel = Pl = 1', () => {
    const set = setOf([
      [0.5, 0, 10],
      [0.5, 20, 30],
    ]);
    expect(probabilityBounds(set, { lower: -1000, upper: 1000 })).toEqual({
      belLower: 1,
      plUpper: 1,
    });
  });

  it('suma varios focales contenidos', () => {
    const set = setOf([
      [0.2, 60, 70],
      [0.3, 80, 90],
      [0.5, 0, 10],
    ]);
    expect(probabilityBounds(set, { lower: 50, upper: 100 })).toEqual({
      belLower: 0.5,
      plUpper: 0.5,
    });
  });

  it('el ancho Pl − Bel mide la ignorancia sobre el evento', () => {
    const set = setOf([
      [0.4, 60, 70], // dentro
      [0.6, 40, 60], // solo interseca
    ]);
    const b = probabilityBounds(set, { lower: 50, upper: 100 });
    expect(b).toEqual({ belLower: 0.4, plUpper: 1 });
    expect(probabilityIgnorance(b)).toBeCloseTo(0.6, 12);
  });

  it('un focal degenerado (punto) dentro del evento cuenta para ambos', () => {
    expect(probabilityBounds(setOf([[1, 75, 75]]), { lower: 50, upper: 100 })).toEqual({
      belLower: 1,
      plUpper: 1,
    });
  });
});

describe('unsafeProbabilityBounds — el evento de la Def. 5.5 es un COMPLEMENTO', () => {
  const safeRegion = { lower: 0, upper: 25 };

  it('focal dentro de la región segura: no cuenta para nada', () => {
    expect(unsafeProbabilityBounds(setOf([[1, 5, 20]]), safeRegion)).toEqual({
      belLower: 0,
      plUpper: 0,
    });
  });

  it('focal enteramente por encima: violación SEGURA', () => {
    expect(unsafeProbabilityBounds(setOf([[1, 30, 40]]), safeRegion)).toEqual({
      belLower: 1,
      plUpper: 1,
    });
  });

  it('focal enteramente por DEBAJO también es violación segura', () => {
    // El complemento tiene dos ramas; un bound que solo mirase la superior las
    // perdería, y con ellas la soundness de belLower.
    expect(unsafeProbabilityBounds(setOf([[1, -20, -5]]), safeRegion)).toEqual({
      belLower: 1,
      plUpper: 1,
    });
  });

  it('focal a caballo: violación POSIBLE, no segura', () => {
    expect(unsafeProbabilityBounds(setOf([[1, 20, 40]]), safeRegion)).toEqual({
      belLower: 0,
      plUpper: 1,
    });
  });

  it('tocar la frontera desde dentro NO es violación (región segura cerrada)', () => {
    expect(unsafeProbabilityBounds(setOf([[1, 25, 25]]), safeRegion)).toEqual({
      belLower: 0,
      plUpper: 0,
    });
  });

  it('rebasar la frontera en cualquier cantidad positiva SÍ lo es', () => {
    const b = unsafeProbabilityBounds(setOf([[1, 25, 25 + 1e-12]]), safeRegion);
    expect(b.plUpper).toBe(1);
    expect(b.belLower).toBe(0);
  });

  it('mezcla realista: masa mayoritaria segura, cola posible', () => {
    // Región segura de la demo: h ≤ 25, SIN cota inferior (acumulación negativa
    // es trivialmente segura). Con [0, 25] los focales que bajan de 0 contarían
    // como inseguros por el lado equivocado.
    const demoSafe = { lower: -Infinity, upper: 25 };
    const set = setOf([
      [0.99, -2, 22], // seguro
      [0.009, 18, 52], // posible
      [0.001, -12, 992], // posible
    ]);
    const b = unsafeProbabilityBounds(set, demoSafe);
    expect(b.belLower).toBe(0);
    expect(b.plUpper).toBeCloseTo(0.01, 12);
  });
});

describe('consistencia con el nivel existencial (Def. 5.5)', () => {
  const spec: SafetySpec = {
    variable: 'h',
    safeRegion: { lower: 0, upper: 25 },
    riskThreshold: 0.5,
  };

  const hull = (elements: Array<[number, number, number]>) => ({
    lower: Math.min(...elements.map(([, l]) => l)),
    upper: Math.max(...elements.map(([, , u]) => u)),
  });

  it('proven-safe ⇒ plUpper = 0', () => {
    const elements: Array<[number, number, number]> = [
      [0.6, 1, 10],
      [0.4, 12, 20],
    ];
    const bounds = unsafeProbabilityBounds(setOf(elements), spec.safeRegion);
    const cert = certifySafety(hull(elements), spec, [], bounds);
    expect(cert.status).toBe('proven-safe');
    expect(bounds.plUpper).toBe(0);
  });

  it('plUpper > 0 ⇒ unsafe-possible', () => {
    const elements: Array<[number, number, number]> = [
      [0.999, 1, 10],
      [0.001, 20, 40],
    ];
    const bounds = unsafeProbabilityBounds(setOf(elements), spec.safeRegion);
    expect(bounds.plUpper).toBeGreaterThan(0);
    expect(certifySafety(hull(elements), spec, [], bounds).status).toBe('unsafe-possible');
  });

  it('certifySafety LANZA con bounds incoherentes (proven-safe con plUpper > 0)', () => {
    expect(() =>
      certifySafety({ lower: 1, upper: 10 }, spec, [], { belLower: 0, plUpper: 0.3 })
    ).toThrow(/certificado incoherente/);
  });

  it('certifySafety LANZA con bounds fuera de [0,1] o invertidos', () => {
    expect(() =>
      certifySafety({ lower: 1, upper: 100 }, spec, [], { belLower: 0.9, plUpper: 0.3 })
    ).toThrow(/probabilityBounds inválidos/);
    expect(() =>
      certifySafety({ lower: 1, upper: 100 }, spec, [], { belLower: -0.1, plUpper: 0.3 })
    ).toThrow(/probabilityBounds inválidos/);
    expect(() =>
      certifySafety({ lower: 1, upper: 100 }, spec, [], { belLower: 0.1, plUpper: 1.3 })
    ).toThrow(/probabilityBounds inválidos/);
  });
});
