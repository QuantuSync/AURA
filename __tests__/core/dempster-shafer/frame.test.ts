import { describe, it, expect } from 'vitest';
import { createFrame, frameRange, hypothesisUpper, validateFrame } from '@/core/dempster-shafer/frame';
import { buildCredalSet } from '@/core/dempster-shafer/credal-set';
import { fuse } from '@/core/dempster-shafer/combination';
import { createBPAFromGaussian } from '@/core/dempster-shafer/bpa';
import { BeliefPlausibility, FrameOfDiscernment } from '@/core/dempster-shafer/types';
import { PRECIPITATION_DOMAIN_BOUND, PRECIPITATION_FRAME } from '@/lib/constants';

/** El marco de la Def. 3.1, con su cola cerrada por el bound declarado. */
const precipFrame = PRECIPITATION_FRAME;

/**
 * El MISMO marco tal como lo escribe literalmente la Def. 3.1: cola abierta
 * [60, ∞). Es sobre este sobre el que operaba el código anterior, y por tanto
 * el que hay que darle al reproductor del truncamiento para que el contraste
 * sea honesto.
 */
const openTailPrecipFrame: FrameOfDiscernment = {
  ...precipFrame,
  hypotheses: precipFrame.hypotheses.map((h, j) =>
    j === precipFrame.hypotheses.length - 1 ? { ...h, upper: Infinity } : h
  ),
};

// ─────────────────────────────────────────────────────────────────────────
// (a) Validación del marco — Def. 3.1 + H0 (soporte acotado declarado)
// ─────────────────────────────────────────────────────────────────────────

describe('createFrame — validación de domainBound', () => {
  const hypotheses = [
    { label: 'a', lower: 0, upper: 10 },
    { label: 'b', lower: 10, upper: 20 },
  ];

  it('acepta un domainBound finito y mayor que el inicio de la última hipótesis', () => {
    const f = createFrame({ variable: 'X', unit: 'u', hypotheses, domainBound: 20 });
    expect(f.domainBound).toBe(20);
  });

  it('LANZA con domainBound = Infinity: la cola abierta de la Def. 3.1 no vale', () => {
    expect(() =>
      createFrame({ variable: 'X', unit: 'u', hypotheses, domainBound: Infinity })
    ).toThrow(/finito/);
  });

  it('LANZA con domainBound = NaN', () => {
    expect(() =>
      createFrame({ variable: 'X', unit: 'u', hypotheses, domainBound: NaN })
    ).toThrow(/finito/);
  });

  it('LANZA si domainBound no supera el inicio de la última hipótesis', () => {
    for (const bad of [10, 9.99, 0, -5]) {
      expect(() =>
        createFrame({ variable: 'X', unit: 'u', hypotheses, domainBound: bad })
      ).toThrow(/estrictamente mayor/);
    }
  });

  it('LANZA si la última hipótesis declara un upper finito distinto del domainBound', () => {
    // Dos declaraciones del mismo hecho físico con valores distintos.
    expect(() =>
      createFrame({ variable: 'X', unit: 'u', hypotheses, domainBound: 50 })
    ).toThrow(/mismo hecho físico/);
  });

  it('acepta la cola escrita como [a, ∞) y la cierra en el domainBound', () => {
    const f = createFrame({
      variable: 'X',
      unit: 'u',
      hypotheses: [
        { label: 'a', lower: 0, upper: 10 },
        { label: 'cola', lower: 10, upper: Infinity },
      ],
      domainBound: 200,
    });
    expect(f.hypotheses[1].upper).toBe(200);
    expect(Number.isFinite(f.hypotheses[1].upper)).toBe(true);
  });

  it('LANZA con hipótesis no contiguas (Def. 3.1: exhaustivas y excluyentes)', () => {
    expect(() =>
      createFrame({
        variable: 'X',
        unit: 'u',
        hypotheses: [
          { label: 'a', lower: 0, upper: 10 },
          { label: 'b', lower: 12, upper: 20 },
        ],
        domainBound: 20,
      })
    ).toThrow(/contiguas/);
  });

  it('LANZA con un marco sin hipótesis', () => {
    expect(() =>
      createFrame({ variable: 'X', unit: 'u', hypotheses: [], domainBound: 10 })
    ).toThrow(/al menos una hipótesis/);
  });

  it('no muta la especificación del llamador', () => {
    const spec = {
      variable: 'X',
      unit: 'u',
      hypotheses: [{ label: 'cola', lower: 0, upper: Infinity }],
      domainBound: 100,
    };
    createFrame(spec);
    expect(spec.hypotheses[0].upper).toBe(Infinity);
  });
});

describe('hypothesisUpper — b_j efectivo de la Ecuación (10)', () => {
  it('devuelve el upper declarado cuando es finito', () => {
    expect(hypothesisUpper(precipFrame, 0)).toBe(5);
    expect(hypothesisUpper(precipFrame, 3)).toBe(60);
  });

  it('devuelve domainBound para una cola abierta escrita como literal', () => {
    // Un literal satisface el tipo sin pasar por createFrame: `hypothesisUpper`
    // impide que ese `Infinity` reentre en el lifting por la puerta de atrás.
    const literal: FrameOfDiscernment = {
      variable: 'X',
      unit: 'u',
      hypotheses: [{ label: 'cola', lower: 0, upper: Infinity }],
      domainBound: 77,
    };
    expect(hypothesisUpper(literal, 0)).toBe(77);
  });

  it('frameRange es [a₀, domainBound]', () => {
    expect(frameRange(precipFrame)).toEqual({ lower: 0, upper: PRECIPITATION_DOMAIN_BOUND });
  });

  it('validateFrame acepta el marco de precipitación de la demo', () => {
    expect(() => validateFrame(precipFrame)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// (b) REGRESIÓN — el truncamiento a_j·2 excluía el valor real
//     docs/ERRATA.md §5 · Lema 6.1 · H1 del Teorema 6.1
// ─────────────────────────────────────────────────────────────────────────

/**
 * Reproduce EXACTAMENTE el algoritmo que `buildCredalSet` aplicaba antes de
 * esta iteración cuando la Ecuación (10) daba `+∞`:
 *
 *   1. filtrar las hipótesis con plausibilidad > 0,01;
 *   2. tomar la última superviviente;
 *   3. si su intervalo es abierto, usar `lower · 2` como upper "práctico".
 *
 * Está aquí, en el test y no en el código, para que el contraste entre el
 * comportamiento viejo y el nuevo sea comprobable y no una nota de changelog.
 */
function legacyTruncatedUpper(
  frame: FrameOfDiscernment,
  bounds: BeliefPlausibility[]
): number {
  const significant = bounds.filter((b) => b.plausibility > 0.01);
  if (significant.length > 0) {
    const last = significant[significant.length - 1];
    const h = frame.hypotheses[last.hypothesis];
    return isFinite(h.upper) ? h.upper : h.lower * 2;
  }
  return frame.hypotheses[frame.hypotheses.length - 1].lower * 2;
}

describe('regresión: truncamiento del intervalo credal (ERRATA §5)', () => {
  /**
   * Escenario: dos sensores concuerdan en un evento torrencial extremo de
   * ~200 mm/h. El valor real cae en la última hipótesis, MUY por encima del
   * antiguo corte `a_j · 2` = 60 · 2 = 120 mm/h.
   *
   * Es un valor físicamente plausible: hay registros de intensidades horarias
   * de ese orden en eventos convectivos extremos. Lo relevante no es su
   * frecuencia sino su estatus formal — el Lema 6.1 no admite excepciones por
   * improbabilidad.
   */
  const REAL_VALUE = 200;
  const OLD_CUTOFF = 120; // 60 · 2, el `a_j · 2` de la versión anterior

  const sources = [
    createBPAFromGaussian(precipFrame, 195, 15, 0.05, 'radar'),
    createBPAFromGaussian(precipFrame, 205, 20, 0.05, 'pluviometro'),
  ];
  const credalSet = buildCredalSet(fuse(sources, [0.05, 0.05]));

  it('el comportamiento ANTIGUO truncaba en 120 mm/h y EXCLUÍA el valor real', () => {
    const legacyUpper = legacyTruncatedUpper(openTailPrecipFrame, credalSet.bounds);
    expect(legacyUpper).toBe(OLD_CUTOFF);
    // 200 > 120: el valor real quedaba fuera del intervalo credal, y todo
    // certificado emitido aguas abajo era inválido sin señal alguna.
    expect(REAL_VALUE).toBeGreaterThan(legacyUpper);
  });

  it('el comportamiento NUEVO contiene el valor real (Lema 6.1 bajo H0)', () => {
    expect(credalSet.continuousInterval.upper).toBeGreaterThanOrEqual(REAL_VALUE);
    expect(credalSet.continuousInterval.lower).toBeLessThanOrEqual(REAL_VALUE);
  });

  it('el bound superior es exactamente el domainBound declarado, no un valor inventado', () => {
    // La cota ya no se deriva de los datos: es la hipótesis H0 del marco.
    expect(credalSet.continuousInterval.upper).toBe(PRECIPITATION_DOMAIN_BOUND);
    expect(Number.isFinite(credalSet.continuousInterval.upper)).toBe(true);
  });

  it('ninguna hipótesis con Pl > 1e-10 queda excluida (el filtro 0,01 ya no existe)', () => {
    // El filtro 0,01 era el "filtro semántico" que el propio módulo prohíbe
    // para el umbral 1e-10 de la Def. 3.9. Cualquier hipótesis plausible por
    // encima de la tolerancia de coma flotante debe estar en el intervalo.
    for (const b of credalSet.bounds) {
      if (b.plausibility > 1e-10) {
        const h = precipFrame.hypotheses[b.hypothesis];
        expect(credalSet.continuousInterval.lower).toBeLessThanOrEqual(h.lower);
        expect(credalSet.continuousInterval.upper).toBeGreaterThanOrEqual(
          hypothesisUpper(precipFrame, b.hypothesis)
        );
      }
    }
  });

  it('una hipótesis con 1e-10 < Pl ≤ 0,01 seguía cayendo del lado excluido', () => {
    // Dos sensores concordantes en lluvia ligera: la cola torrencial conserva
    // plausibilidad minúscula pero NO nula (la masa sobre Θ interseca a todas
    // las hipótesis). El viejo filtro la descartaba; la Def. 3.9 no lo permite.
    const light = buildCredalSet(
      fuse(
        [
          createBPAFromGaussian(precipFrame, 8, 2, 0.02, 's1'),
          createBPAFromGaussian(precipFrame, 9, 2, 0.02, 's2'),
        ],
        [0.02, 0.02]
      )
    );
    const tail = light.bounds[light.bounds.length - 1];
    expect(tail.plausibility).toBeGreaterThan(1e-10);
    expect(tail.plausibility).toBeLessThanOrEqual(0.01);
    // Nuevo: la cola está dentro. Viejo: se filtraba y el upper caía a 30.
    expect(light.continuousInterval.upper).toBe(PRECIPITATION_DOMAIN_BOUND);
    expect(legacyTruncatedUpper(openTailPrecipFrame, light.bounds)).toBeLessThan(
      PRECIPITATION_DOMAIN_BOUND
    );
  });

  it('el nuevo intervalo nunca es más estrecho que el que truncaba', () => {
    // La corrección solo puede ENSANCHAR: es lo que la hace sound.
    expect(credalSet.continuousInterval.upper).toBeGreaterThanOrEqual(
      legacyTruncatedUpper(openTailPrecipFrame, credalSet.bounds)
    );
  });
});

describe('buildCredalSet — marco sin cola cerrada', () => {
  it('LANZA en vez de truncar si el lifting sale no acotado', () => {
    // Marco escrito como literal, sin pasar por createFrame, con la cola
    // abierta Y un domainBound también infinito: no hay bound que aplicar.
    const broken: FrameOfDiscernment = {
      variable: 'X',
      unit: 'u',
      hypotheses: [
        { label: 'a', lower: 0, upper: 10 },
        { label: 'cola', lower: 10, upper: Infinity },
      ],
      domainBound: Infinity,
    };
    const bpa = createBPAFromGaussian(broken, 5, 3, 0.1, 's1');
    expect(() => buildCredalSet(fuse([bpa, bpa], [0.1, 0.1]))).toThrow(/no es finito/);
  });
});
