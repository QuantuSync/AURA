/**
 * AURA v2 — El criterio de selección pre-registrado, aislado de sus números
 *
 * `scripts/experiments/conflict-rule.ts` separa a propósito la producción de
 * cifras (la campaña) de la decisión que se toma con ellas ({@link select}).
 * Este fichero bloquea la segunda: que el criterio se aplique en el orden
 * lexicográfico declarado, que descalifique donde debe y que sea TOTAL —que
 * siempre resuelva, sin desempates ad hoc.
 *
 * Es lo que impide que un empate inesperado en una campaña futura se resuelva
 * a ojo, que es exactamente la puerta de atrás que el pre-registro cierra.
 */

import { describe, it, expect } from 'vitest';

import { CandidateScore, CRITERION, select } from '../../scripts/experiments/lib/selection';

const score = (over: Partial<CandidateScore> & Pick<CandidateScore, 'rule'>): CandidateScore => ({
  gatePassed: true,
  existentialCoverage: 1,
  bandCoverage: 0.999,
  cleanDempsterFraction: 0.5,
  meanBandWidth: 300,
  ...over,
});

describe('criterio pre-registrado', () => {
  it('tiene los cinco pasos declarados, en orden', () => {
    expect(CRITERION).toHaveLength(5);
    expect(CRITERION[0]).toMatch(/requisito innegociable/);
    expect(CRITERION[4]).toMatch(/C1 > C2 > C3/);
  });

  it('paso 1 — un candidato que falla el requisito queda fuera por informativo que sea', () => {
    const r = select([
      score({ rule: 'C0', cleanDempsterFraction: 0.5 }),
      score({ rule: 'C1', cleanDempsterFraction: 0.99, gatePassed: false }),
    ]);
    expect(r.selected).toBe('C0');
    expect(r.disqualified).toEqual([
      { rule: 'C1', step: 1, reason: 'falla el requisito innegociable' },
    ]);
  });

  it('paso 2 — cobertura existencial < 100 % o banda-95 < 99,5 % descalifican', () => {
    const r = select([
      score({ rule: 'C0' }),
      score({ rule: 'C1', cleanDempsterFraction: 0.99, existentialCoverage: 0.9999 }),
      score({ rule: 'C2', cleanDempsterFraction: 0.98, bandCoverage: 0.994 }),
    ]);
    expect(r.selected).toBe('C0');
    expect(r.disqualified.map((d) => d.rule)).toEqual(['C1', 'C2']);
    expect(r.disqualified[0].reason).toMatch(/cobertura existencial/);
    expect(r.disqualified[1].reason).toMatch(/banda-95/);
    // 99,5 % exacto SÍ pasa: el criterio dice «≥».
    expect(select([score({ rule: 'C0', bandCoverage: 0.995 })]).disqualified).toHaveLength(0);
  });

  it('paso 3 — decide en solitario cuando la ventaja supera 1 punto porcentual', () => {
    const r = select([
      score({ rule: 'C0', cleanDempsterFraction: 0.54, meanBandWidth: 100 }),
      score({ rule: 'C1', cleanDempsterFraction: 0.58, meanBandWidth: 400 }),
    ]);
    expect(r.selected).toBe('C1');
    expect(r.decidedAtStep).toBe(3);
    // Y no se cuela la anchura: el paso 4 solo actúa si hay empate en el 3.
    expect(r.rationale).toMatch(/paso 3/);
  });

  it('paso 4 — dentro de 1 punto porcentual manda la anchura media de la banda', () => {
    const r = select([
      score({ rule: 'C1', cleanDempsterFraction: 0.58, meanBandWidth: 300 }),
      score({ rule: 'C2', cleanDempsterFraction: 0.575, meanBandWidth: 280 }),
      score({ rule: 'C3', cleanDempsterFraction: 0.55, meanBandWidth: 10 }),
    ]);
    // C3 tiene la banda más estrecha con diferencia, pero queda a 3 puntos en
    // el paso 3 y ni siquiera entra en el desempate.
    expect(r.selected).toBe('C2');
    expect(r.decidedAtStep).toBe(4);
  });

  it('paso 5 — empate en 3 y 4: gana el más simple, C1 > C2 > C3', () => {
    const r = select([
      score({ rule: 'C3', cleanDempsterFraction: 0.576, meanBandWidth: 280.667 }),
      score({ rule: 'C2', cleanDempsterFraction: 0.576, meanBandWidth: 280.667 }),
      score({ rule: 'C1', cleanDempsterFraction: 0.576, meanBandWidth: 280.667 }),
    ]);
    expect(r.selected).toBe('C1');
    expect(r.decidedAtStep).toBe(5);
    // El orden en que llegan los candidatos no puede influir en la decisión.
    expect(select([score({ rule: 'C2' }), score({ rule: 'C3' })]).selected).toBe('C2');
  });

  it('paso 5 — C0 va al final: conservar el defecto no es «lo más simple»', () => {
    const r = select([score({ rule: 'C0' }), score({ rule: 'C3' })]);
    expect(r.selected).toBe('C3');
  });

  it('si nadie supera los pasos 1-2, LANZA en vez de relajar el criterio', () => {
    expect(() =>
      select([
        score({ rule: 'C0', gatePassed: false }),
        score({ rule: 'C1', bandCoverage: 0.5 }),
      ])
    ).toThrow(/no se relaja a posteriori/i);
  });
});
