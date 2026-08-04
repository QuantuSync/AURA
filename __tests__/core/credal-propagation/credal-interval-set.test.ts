import { describe, it, expect } from 'vitest';
import {
  createCredalIntervalSet,
  credalIntervalSetFromBPA,
  frameRefOf,
  hullOf,
  toCredalIntervalSet,
  totalMass,
} from '@/core/credal-propagation/credal-interval-set';
import { DEFAULT_CREDAL_PROPAGATION_CONFIG } from '@/core/credal-propagation/types';
import { createFrame } from '@/core/dempster-shafer/frame';
import { createBPAFromGaussian } from '@/core/dempster-shafer/bpa';
import { fuse } from '@/core/dempster-shafer/combination';
import { buildCredalSet } from '@/core/dempster-shafer/credal-set';
import { BPA, FrameOfDiscernment } from '@/core/dempster-shafer/types';

const frame: FrameOfDiscernment = createFrame({
  variable: 'X',
  unit: 'u',
  hypotheses: [
    { label: 'a', lower: 0, upper: 10 },
    { label: 'b', lower: 10, upper: 20 },
    { label: 'c', lower: 20, upper: 30 },
    { label: 'cola', lower: 30, upper: 100 },
  ],
  domainBound: 100,
});

const bpaOf = (focals: Array<{ indices: number[]; mass: number }>): BPA => ({
  frame,
  focalElements: focals,
  sourceId: 's',
  timestamp: 0,
});

describe('frameRefOf', () => {
  it('copia variable, unidad y domainBound (testigo de H0)', () => {
    expect(frameRefOf(frame)).toEqual({ variable: 'X', unit: 'u', domainBound: 100 });
  });
});

describe('createCredalIntervalSet — validación del invariante', () => {
  const ref = frameRefOf(frame);

  it('acepta un conjunto con Σ mass = 1', () => {
    const set = createCredalIntervalSet(
      [
        { mass: 0.7, interval: { lower: 0, upper: 10 } },
        { mass: 0.3, interval: { lower: 10, upper: 100 } },
      ],
      ref
    );
    expect(totalMass(set)).toBeCloseTo(1, 12);
    expect(set.elements).toHaveLength(2);
  });

  it('acepta una desviación dentro de la tolerancia de coma flotante', () => {
    expect(() =>
      createCredalIntervalSet([{ mass: 1 - 5e-10, interval: { lower: 0, upper: 1 } }], ref)
    ).not.toThrow();
  });

  it('LANZA si Σ mass se aparta de 1 más de la tolerancia', () => {
    expect(() =>
      createCredalIntervalSet([{ mass: 0.9, interval: { lower: 0, upper: 1 } }], ref)
    ).toThrow(/masa total/);
  });

  it('LANZA con el conjunto vacío', () => {
    expect(() => createCredalIntervalSet([], ref)).toThrow(/no tiene elementos focales/);
  });

  it('LANZA con masa negativa', () => {
    expect(() =>
      createCredalIntervalSet(
        [
          { mass: -0.1, interval: { lower: 0, upper: 1 } },
          { mass: 1.1, interval: { lower: 0, upper: 1 } },
        ],
        ref
      )
    ).toThrow(/masa inválida/);
  });

  it('LANZA con un intervalo no finito — la cola abierta no puede colarse', () => {
    expect(() =>
      createCredalIntervalSet([{ mass: 1, interval: { lower: 30, upper: Infinity } }], ref)
    ).toThrow(/no finito/);
  });

  it('LANZA con un intervalo invertido', () => {
    expect(() =>
      createCredalIntervalSet([{ mass: 1, interval: { lower: 10, upper: 5 } }], ref)
    ).toThrow(/invertido/);
  });

  it('LANZA al exceder maxFocalElements en vez de degradar', () => {
    const n = 5;
    const elements = Array.from({ length: n }, () => ({
      mass: 1 / n,
      interval: { lower: 0, upper: 1 },
    }));
    expect(() =>
      createCredalIntervalSet(elements, ref, { maxFocalElements: 4 })
    ).toThrow(/exceden el límite maxFocalElements/);
  });

  it('copia en profundidad: mutar la entrada no altera el conjunto', () => {
    const elements = [{ mass: 1, interval: { lower: 0, upper: 10 } }];
    const set = createCredalIntervalSet(elements, ref);
    elements[0].interval.upper = 999;
    elements[0].mass = 0;
    expect(set.elements[0].interval.upper).toBe(10);
    expect(set.elements[0].mass).toBe(1);
  });
});

describe('credalIntervalSetFromBPA — hull de cada elemento focal', () => {
  it('un singleton se mapea a su propia hipótesis', () => {
    const set = credalIntervalSetFromBPA(bpaOf([{ indices: [1], mass: 1 }]));
    expect(set.elements[0].interval).toEqual({ lower: 10, upper: 20 });
  });

  it('Θ completo se mapea al rango del marco, cerrado en domainBound', () => {
    const set = credalIntervalSetFromBPA(bpaOf([{ indices: [0, 1, 2, 3], mass: 1 }]));
    expect(set.elements[0].interval).toEqual({ lower: 0, upper: 100 });
  });

  it('la hipótesis de cola usa domainBound como b_j (H0), no Infinity', () => {
    const set = credalIntervalSetFromBPA(bpaOf([{ indices: [3], mass: 1 }]));
    expect(set.elements[0].interval).toEqual({ lower: 30, upper: 100 });
  });

  it('un marco escrito con cola [a, ∞) tampoco reintroduce +∞', () => {
    // El marco literal de la Def. 3.1, sin pasar por `createFrame`.
    const openTail: FrameOfDiscernment = {
      ...frame,
      hypotheses: frame.hypotheses.map((h, j) =>
        j === frame.hypotheses.length - 1 ? { ...h, upper: Infinity } : h
      ),
    };
    const set = credalIntervalSetFromBPA({
      frame: openTail,
      focalElements: [{ indices: [3], mass: 1 }],
      sourceId: 's',
      timestamp: 0,
    });
    expect(set.elements[0].interval).toEqual({ lower: 30, upper: 100 });
  });

  it('un A NO CONTIGUO se mapea a su hull, que sobre-aproxima', () => {
    // {a, c} = [0,10) ∪ [20,30). El hull [0,30] incluye [10,20), que no está en
    // A. Es sobre-aproximación deliberada, y es la dirección conservadora.
    const set = credalIntervalSetFromBPA(bpaOf([{ indices: [0, 2], mass: 1 }]));
    expect(set.elements[0].interval).toEqual({ lower: 0, upper: 30 });
  });

  it('preserva las masas una a una y en orden', () => {
    const set = credalIntervalSetFromBPA(
      bpaOf([
        { indices: [0], mass: 0.25 },
        { indices: [1, 2], mass: 0.6 },
        { indices: [0, 1, 2, 3], mass: 0.15 },
      ])
    );
    expect(set.elements.map((e) => e.mass)).toEqual([0.25, 0.6, 0.15]);
    expect(set.elements.map((e) => e.interval)).toEqual([
      { lower: 0, upper: 10 },
      { lower: 10, upper: 30 },
      { lower: 0, upper: 100 },
    ]);
  });

  it('LANZA con un elemento focal vacío (Def. 3.2 exige m(∅) = 0)', () => {
    expect(() => credalIntervalSetFromBPA(bpaOf([{ indices: [], mass: 1 }]))).toThrow(
      /elemento focal vacío/
    );
  });

  it('LANZA con un índice de hipótesis fuera del marco', () => {
    expect(() => credalIntervalSetFromBPA(bpaOf([{ indices: [9], mass: 1 }]))).toThrow(
      /fuera del marco/
    );
  });
});

describe('toCredalIntervalSet — acepta FusionResult o BPA', () => {
  const sources = [
    createBPAFromGaussian(frame, 12, 2, 0.05, 's0', 0),
    createBPAFromGaussian(frame, 13, 2, 0.05, 's1', 0),
  ];

  it('desde un FusionResult usa la BPA fusionada', () => {
    const fusion = fuse(sources, [0.05, 0.05]);
    expect(toCredalIntervalSet(fusion)).toEqual(credalIntervalSetFromBPA(fusion.fused));
  });

  it('desde una BPA suelta da el mismo resultado', () => {
    expect(toCredalIntervalSet(sources[0])).toEqual(credalIntervalSetFromBPA(sources[0]));
  });

  it('la ruta de envolvente (alto conflicto) también produce un conjunto válido', () => {
    // Fuentes en extremos opuestos del marco → K alto → método 'envelope'.
    const conflicting = [
      createBPAFromGaussian(frame, 2, 0.5, 0.01, 'lo', 0),
      createBPAFromGaussian(frame, 90, 0.5, 0.01, 'hi', 0),
    ];
    const fusion = fuse(conflicting, [0.01, 0.01]);
    expect(fusion.method).toBe('envelope');

    const set = toCredalIntervalSet(fusion);
    expect(totalMass(set)).toBeCloseTo(1, 9);
    // La BPA sintética manda el sobrante a Θ, cuyo hull es el marco completo:
    // masa conservadora, que cuenta para plUpper y nunca para belLower.
    expect(set.elements.some((e) => e.interval.lower === 0 && e.interval.upper === 100)).toBe(true);
  });
});

describe('hullOf — coincide con el lifting de la Ecuación (10)', () => {
  it('sobre el escenario de la demo, hull = intervalo credal continuo', () => {
    const sources = [
      createBPAFromGaussian(frame, 12, 2, 0.05, 's0', 0),
      createBPAFromGaussian(frame, 13, 2, 0.05, 's1', 0),
      createBPAFromGaussian(frame, 11, 3, 0.05, 's2', 0),
    ];
    const fusion = fuse(sources, [0.05, 0.05, 0.05]);

    const ec10 = buildCredalSet(fusion).continuousInterval;
    const hull = hullOf(toCredalIntervalSet(fusion));

    expect(hull.lower).toBe(ec10.lower);
    expect(hull.upper).toBe(ec10.upper);
  });

  it('con un único singleton, el hull es esa hipótesis', () => {
    expect(hullOf(credalIntervalSetFromBPA(bpaOf([{ indices: [1], mass: 1 }])))).toEqual({
      lower: 10,
      upper: 20,
    });
  });

  it('el límite por defecto de elementos focales es 64', () => {
    expect(DEFAULT_CREDAL_PROPAGATION_CONFIG.maxFocalElements).toBe(64);
  });
});
