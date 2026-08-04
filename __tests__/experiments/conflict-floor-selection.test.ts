/**
 * AURA v2 — El criterio de selección de la MEDIDA, aislado de sus números
 *
 * Hermano de `./conflict-rule-selection.test.ts` y con el mismo cometido:
 * `scripts/experiments/conflict-floor.ts` separa la producción de cifras de la
 * decisión que se toma con ellas ({@link selectMeasure}), y este fichero bloquea
 * la segunda — que el criterio se aplique en el orden lexicográfico declarado,
 * que descalifique donde debe y que sea TOTAL.
 *
 * Es lo que impide que un empate inesperado en una campaña futura se resuelva a
 * ojo, que es la puerta de atrás que el pre-registro cierra.
 */

import { describe, it, expect } from 'vitest';

import {
  FLOOR_CRITERION,
  MeasureScore,
  selectMeasure,
} from '../../scripts/experiments/lib/floor-selection';

const score = (
  over: Partial<MeasureScore> & Pick<MeasureScore, 'measure'>
): MeasureScore => ({
  gatePassed: true,
  existentialCoverage: 1,
  bandCoverage: 0.999,
  virgaNeitherFraction: 0.0004,
  hindcastSigmaDempsterFraction: 0.5,
  cleanDempsterFraction: 0.5,
  meanBandWidth: 300,
  ...over,
});

describe('criterio pre-registrado de la medida', () => {
  it('tiene los siete pasos declarados, en orden', () => {
    expect(FLOOR_CRITERION).toHaveLength(7);
    expect(FLOOR_CRITERION[0]).toMatch(/requisito innegociable/);
    expect(FLOOR_CRITERION[1]).toMatch(/99,5/);
    expect(FLOOR_CRITERION[2]).toMatch(/virga/);
    expect(FLOOR_CRITERION[3]).toMatch(/σ del hindcast/);
    expect(FLOOR_CRITERION[6]).toMatch(/D1 > D2/);
  });

  it('paso 1 — el requisito y la cobertura existencial descalifican por informativa que sea', () => {
    const r = selectMeasure([
      score({ measure: 'D0' }),
      score({ measure: 'D1', hindcastSigmaDempsterFraction: 0.99, gatePassed: false }),
      score({ measure: 'D2', hindcastSigmaDempsterFraction: 0.98, existentialCoverage: 0.9999 }),
    ]);
    expect(r.selected).toBe('D0');
    expect(r.disqualified.map((d) => d.measure)).toEqual(['D1', 'D2']);
    expect(r.disqualified[0].reason).toMatch(/requisito innegociable/);
    expect(r.disqualified[1].reason).toMatch(/cobertura existencial/);
  });

  it('paso 2 — banda-95 < 99,5 % descalifica, y 99,5 % exacto pasa', () => {
    const r = selectMeasure([
      score({ measure: 'D0' }),
      score({ measure: 'D1', hindcastSigmaDempsterFraction: 0.99, bandCoverage: 0.994 }),
    ]);
    expect(r.selected).toBe('D0');
    expect(r.disqualified[0]).toMatchObject({ measure: 'D1', step: 2 });
    expect(selectMeasure([score({ measure: 'D0', bandCoverage: 0.995 })]).disqualified).toHaveLength(
      0
    );
  });

  it('paso 3 — la propiedad estrella no puede empeorar más allá del 0,10 %', () => {
    const r = selectMeasure([
      score({ measure: 'D0' }),
      score({ measure: 'D1', hindcastSigmaDempsterFraction: 0.99, virgaNeitherFraction: 0.0011 }),
    ]);
    expect(r.selected).toBe('D0');
    expect(r.disqualified[0]).toMatchObject({ measure: 'D1', step: 3 });
    expect(r.disqualified[0].reason).toMatch(/virga/);
    // El techo es «≤»: 0,10 % exacto pasa.
    expect(
      selectMeasure([score({ measure: 'D0', virgaNeitherFraction: 0.001 })]).disqualified
    ).toHaveLength(0);
  });

  it('paso 4 — decide en solitario cuando la ventaja en el suelo supera 1 punto', () => {
    const r = selectMeasure([
      score({ measure: 'D0', hindcastSigmaDempsterFraction: 0.0, cleanDempsterFraction: 0.99 }),
      score({ measure: 'D1', hindcastSigmaDempsterFraction: 0.95, cleanDempsterFraction: 0.1 }),
    ]);
    expect(r.selected).toBe('D1');
    expect(r.decidedAtStep).toBe(4);
    expect(r.rationale).toMatch(/paso 4/);
    // Y no se cuela el paso 5: D0 gana en limpios→Dempster y aun así pierde.
    expect(r.survivors.find((s) => s.step === 4)!.measures).toEqual(['D1']);
  });

  it('paso 5 — dentro de 1 punto en el suelo manda la informatividad estándar', () => {
    const r = selectMeasure([
      score({ measure: 'D1', hindcastSigmaDempsterFraction: 0.95, cleanDempsterFraction: 0.55 }),
      score({ measure: 'D2', hindcastSigmaDempsterFraction: 0.945, cleanDempsterFraction: 0.62 }),
      score({ measure: 'D0', hindcastSigmaDempsterFraction: 0.2, cleanDempsterFraction: 0.99 }),
    ]);
    // D0 tiene la mejor informatividad estándar con diferencia, pero queda a 75
    // puntos en el paso 4 y ni siquiera entra en el desempate.
    expect(r.selected).toBe('D2');
    expect(r.decidedAtStep).toBe(5);
  });

  it('paso 6 — empate en 4 y 5: manda la anchura media de la banda', () => {
    const r = selectMeasure([
      score({
        measure: 'D1',
        hindcastSigmaDempsterFraction: 0.95,
        cleanDempsterFraction: 0.6,
        meanBandWidth: 300,
      }),
      score({
        measure: 'D2',
        hindcastSigmaDempsterFraction: 0.945,
        cleanDempsterFraction: 0.598,
        meanBandWidth: 280,
      }),
    ]);
    expect(r.selected).toBe('D2');
    expect(r.decidedAtStep).toBe(6);
  });

  it('paso 7 — empate total: gana el más simple, D1 > D2', () => {
    const r = selectMeasure([score({ measure: 'D2' }), score({ measure: 'D1' })]);
    expect(r.selected).toBe('D1');
    expect(r.decidedAtStep).toBe(7);
    // El orden en que llegan los candidatos no puede influir en la decisión.
    expect(selectMeasure([score({ measure: 'D1' }), score({ measure: 'D2' })]).selected).toBe('D1');
  });

  it('paso 7 — D0 va al final: conservar el defecto no es «lo más simple»', () => {
    expect(selectMeasure([score({ measure: 'D0' }), score({ measure: 'D2' })]).selected).toBe('D2');
    // Pero si D0 es la única superviviente, se selecciona: «ninguna medida
    // nueva mejora nada» es un resultado legítimo, no un error.
    const r = selectMeasure([
      score({ measure: 'D0' }),
      score({ measure: 'D1', gatePassed: false }),
      score({ measure: 'D2', gatePassed: false }),
    ]);
    expect(r.selected).toBe('D0');
  });

  it('si nadie supera los pasos 1-3, LANZA en vez de relajar el criterio', () => {
    expect(() =>
      selectMeasure([
        score({ measure: 'D0', gatePassed: false }),
        score({ measure: 'D1', bandCoverage: 0.5 }),
        score({ measure: 'D2', virgaNeitherFraction: 0.5 }),
      ])
    ).toThrow(/no se relaja a posteriori/i);
  });

  it('deja la traza completa de supervivientes por paso', () => {
    const r = selectMeasure([
      score({ measure: 'D0', hindcastSigmaDempsterFraction: 0.1 }),
      score({ measure: 'D1', hindcastSigmaDempsterFraction: 0.9 }),
      score({ measure: 'D2', gatePassed: false }),
    ]);
    expect(r.survivors.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(r.survivors[0].measures).toEqual(['D0', 'D1']);
    expect(r.survivors[6].measures).toEqual([r.selected]);
  });
});
