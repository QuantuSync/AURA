/**
 * Propiedad B8 — Soundness de la propagación por el DAG causal
 * papers/AURA_v2.pdf §4.4.2, Definición 4.3 / Ecuación (24) y Teorema 4.1
 *
 *   [V_i] = f_i([pa(V_i)]) ⊕ [−ε_i, ε_i]                                  (24)
 *
 *   Teorema 4.1: si (i) v*_j ∈ [V_j^(0)] para todo nodo raíz y (ii) |u_i| ≤ ε_i
 *   para todo i, entonces v*_i ∈ [V_i] para toda variable del DAG.
 *
 * Esta propiedad es el enunciado del teorema ejecutado: se generan DAGs
 * pequeños con ecuaciones suaves y ε_i arbitrarios, se muestrea un mundo real
 * completo —entradas dentro de sus intervalos y errores de modelo dentro de sus
 * bounds— y se comprueba la contención nodo a nodo.
 *
 * Que la comprobación sea posible es exactamente lo que cambió en esta
 * iteración: hasta ahora el ⊕[−ε_i, ε_i] lo aplicaba (o no) quien escribía la
 * ecuación, de modo que "el DAG propaga con bound ε_i" no era una propiedad del
 * sistema sino una convención del llamador.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { propagateIntervals } from '@/core/causal-dag/propagation';
import { validateDAG } from '@/core/causal-dag/dag';
import { CausalDAG, StructuralEquation } from '@/core/causal-dag/types';
import { add, subtract, multiply } from '@/core/intervals/arithmetic';
import { Interval } from '@/core/intervals/types';
import { fcParams, containedWithin, realArb, unitArb } from './_config';

// ─────────────────────────────────────────────────────────────────────────
// Generador de DAGs pequeños con ecuaciones suaves
// ─────────────────────────────────────────────────────────────────────────

/**
 * Operaciones admitidas. Cada una se da DOS VECES: como función real sobre ℝ y
 * como extensión intervalar natural (Definición 4.2). Todas son C^∞, de modo
 * que la hipótesis de regularidad no interfiere con lo que se está midiendo.
 */
type OpKind = 'affine' | 'square' | 'sum' | 'diff' | 'prod';

const UNARY_OPS: OpKind[] = ['affine', 'square'];
const BINARY_OPS: OpKind[] = ['sum', 'diff', 'prod'];

interface NodeSpec {
  parents: number[];
  op: OpKind;
  /** Coeficientes de la operación afín. */
  k: number;
  c: number;
  /** ε_i del nodo (≥ 0). */
  eps: number;
}

interface DagSpec {
  /** Intervalos de entrada de los nodos raíz, indexados por nodo. */
  roots: Map<number, Interval>;
  /** Especificación de los nodos no raíz, en orden topológico. */
  nodes: NodeSpec[];
  /** Número total de nodos. */
  n: number;
}

function evalReal(spec: NodeSpec, args: number[]): number {
  switch (spec.op) {
    case 'affine':
      return spec.k * args[0] + spec.c;
    case 'square':
      return args[0] * args[0];
    case 'sum':
      return args[0] + args[1];
    case 'diff':
      return args[0] - args[1];
    case 'prod':
      return args[0] * args[1];
  }
}

function evalInterval(spec: NodeSpec, args: Interval[]): Interval {
  switch (spec.op) {
    case 'affine':
      return add(multiply(args[0], { lower: spec.k, upper: spec.k }), {
        lower: spec.c,
        upper: spec.c,
      });
    case 'square':
      // multiply(a, a) sobre-aproxima (dependency problem, §4.4.2) pero es
      // sound, que es lo único que el Teorema 4.1 exige.
      return multiply(args[0], args[0]);
    case 'sum':
      return add(args[0], args[1]);
    case 'diff':
      return subtract(args[0], args[1]);
    case 'prod':
      return multiply(args[0], args[1]);
  }
}

const nodeId = (i: number) => `v${i}`;

/** Construye el CausalDAG correspondiente a una especificación generada. */
function buildDAG(spec: DagSpec, epsOverride?: (i: number, eps: number) => number): CausalDAG {
  const equations: StructuralEquation[] = [];
  const edges: CausalDAG['edges'] = [];

  for (let i = 0; i < spec.n; i++) {
    if (spec.roots.has(i)) continue;
    const node = spec.nodes[i];
    for (const p of node.parents) {
      edges.push({ from: nodeId(p), to: nodeId(i), weight: { lower: 1, upper: 1 } });
    }
    const parentIds = node.parents.map(nodeId);
    equations.push({
      nodeId: nodeId(i),
      compute: (parentValues) => evalInterval(node, parentIds.map((id) => parentValues.get(id)!)),
      modelErrorBound: epsOverride ? epsOverride(i, node.eps) : node.eps,
    });
  }

  return {
    nodes: Array.from({ length: spec.n }, (_, i) => ({
      id: nodeId(i),
      label: `V${i}`,
      unit: 'u',
    })),
    edges,
    equations,
  };
}

/**
 * Evalúa el "mundo real" en orden topológico: v*_i = f_i(padres reales) + u_i.
 *
 * @param uFactors - factor s_i ∈ [−1, 1] que escala ε_i para dar u_i = s_i·ε_i.
 * @param violate - multiplicador aplicado a u_i; > 1 rompe |u_i| ≤ ε_i (H2).
 */
function evalTrueValues(
  spec: DagSpec,
  rootFractions: number[],
  uFactors: number[],
  violate = 1
): number[] {
  const values: number[] = new Array(spec.n).fill(Number.NaN);
  let rootIdx = 0;

  for (let i = 0; i < spec.n; i++) {
    const rootInterval = spec.roots.get(i);
    if (rootInterval) {
      const t = rootFractions[rootIdx++ % rootFractions.length];
      const v = rootInterval.lower + t * (rootInterval.upper - rootInterval.lower);
      values[i] = Math.min(rootInterval.upper, Math.max(rootInterval.lower, v));
      continue;
    }
    const node = spec.nodes[i];
    const args = node.parents.map((p) => values[p]);
    const u = uFactors[i % uFactors.length] * node.eps * violate;
    values[i] = evalReal(node, args) + u;
  }

  return values;
}

/** DAG de 2 a 4 nodos: el primero siempre raíz, el resto con 1 o 2 padres. */
const dagSpecArb = (maxEps = 5): fc.Arbitrary<DagSpec> =>
  fc.integer({ min: 2, max: 4 }).chain((n) =>
    fc
      .tuple(
        // Para cada nodo i ≥ 1: ¿es raíz? Y su configuración si no lo es.
        fc.array(fc.boolean(), { minLength: n, maxLength: n }),
        fc.array(
          fc.tuple(
            fc.constantFrom(...UNARY_OPS, ...BINARY_OPS),
            realArb(-3, 3),
            realArb(-10, 10),
            fc.double({ min: 0, max: maxEps, noNaN: true, noDefaultInfinity: true }),
            unitArb(),
            unitArb()
          ),
          { minLength: n, maxLength: n }
        ),
        // Intervalos de entrada candidatos para los nodos raíz.
        fc.array(
          fc
            .tuple(realArb(-10, 10), realArb(-10, 10))
            .map(([p, q]) => ({ lower: Math.min(p, q), upper: Math.max(p, q) })),
          { minLength: n, maxLength: n }
        )
      )
      .map(([isRootFlags, configs, intervals]) => {
        const roots = new Map<number, Interval>();
        roots.set(0, intervals[0]); // el nodo 0 es raíz por construcción
        const nodes: NodeSpec[] = [];

        for (let i = 0; i < n; i++) {
          if (i > 0 && isRootFlags[i]) {
            roots.set(i, intervals[i]);
          }
          const [op, k, c, eps, s1, s2] = configs[i];
          // Padres: elegidos entre los nodos anteriores (garantiza aciclicidad
          // y orden topológico 0, 1, …, n−1).
          const available = Array.from({ length: i }, (_, j) => j);
          const arity = BINARY_OPS.includes(op) && available.length >= 2 ? 2 : 1;
          const parents: number[] = [];
          if (available.length > 0) {
            const first = available[Math.floor(s1 * available.length) % available.length];
            parents.push(first);
            if (arity === 2) {
              const rest = available.filter((j) => j !== first);
              parents.push(rest[Math.floor(s2 * rest.length) % rest.length]);
            }
          }
          const effectiveOp: OpKind = parents.length >= 2 ? op : UNARY_OPS.includes(op) ? op : 'affine';
          nodes.push({ parents, op: effectiveOp, k, c, eps });
          if (parents.length === 0) roots.set(i, intervals[i]);
        }

        return { roots, nodes, n };
      })
  );

/** Entradas reales y errores de modelo para un DAG generado. */
const worldArb = (n: number) =>
  fc.tuple(
    fc.array(unitArb(), { minLength: n, maxLength: n }),
    fc.array(
      fc.double({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true }),
      { minLength: n, maxLength: n }
    )
  );

const scenarioArb = (maxEps = 5) =>
  dagSpecArb(maxEps).chain((spec) => fc.tuple(fc.constant(spec), worldArb(spec.n)));

const inputsOf = (spec: DagSpec): Map<string, Interval> =>
  new Map([...spec.roots].map(([i, iv]) => [nodeId(i), iv]));

/** ¿Son todos los valores del mundo real finitos? (descarta overflow) */
const allFinite = (xs: number[]) => xs.every((x) => Number.isFinite(x));

// ─────────────────────────────────────────────────────────────────────────

describe('B8 · Teorema 4.1 — soundness de la propagación intervalar por el DAG', () => {
  it('v*_i ∈ [V_i] para todo nodo, cuando |u_i| ≤ ε_i (H1 ∧ H2 ⇒ contención)', () => {
    fc.assert(
      fc.property(scenarioArb(), ([spec, [rootFractions, uFactors]]) => {
        const dag = buildDAG(spec);
        const propagated = propagateIntervals(dag, inputsOf(spec));
        const truth = evalTrueValues(spec, rootFractions, uFactors);
        if (!allFinite(truth)) return true; // overflow numérico, no un contraejemplo

        for (let i = 0; i < spec.n; i++) {
          const iv = propagated.get(nodeId(i));
          expect(iv).toBeDefined();
          if (!Number.isFinite(iv!.lower) || !Number.isFinite(iv!.upper)) continue;
          expect(
            containedWithin(truth[i], iv!.lower, iv!.upper),
            `v*_${i} = ${truth[i]} ∉ [${iv!.lower}, ${iv!.upper}]`
          ).toBe(true);
        }
        return true;
      }),
      fcParams
    );
  });

  it('el intervalo propagado es al menos tan ancho como el ⊕[−ε_i, ε_i] exige', () => {
    // Comprobación estructural de la Ecuación (24): el ancho de [V_i] no puede
    // ser menor que 2·ε_i, porque f_i([pa]) es un intervalo no vacío.
    fc.assert(
      fc.property(dagSpecArb(), (spec) => {
        const dag = buildDAG(spec);
        const propagated = propagateIntervals(dag, inputsOf(spec));
        for (let i = 0; i < spec.n; i++) {
          if (spec.roots.has(i)) continue;
          const iv = propagated.get(nodeId(i))!;
          if (!Number.isFinite(iv.lower) || !Number.isFinite(iv.upper)) continue;
          expect(iv.upper - iv.lower).toBeGreaterThanOrEqual(2 * spec.nodes[i].eps - 1e-9);
        }
        return true;
      }),
      fcParams
    );
  });

  it('monotonía en ε: aumentar cualquier ε_i solo puede ensanchar los intervalos', () => {
    fc.assert(
      fc.property(dagSpecArb(), (spec) => {
        const tight = propagateIntervals(buildDAG(spec, () => 0), inputsOf(spec));
        const loose = propagateIntervals(buildDAG(spec), inputsOf(spec));

        for (let i = 0; i < spec.n; i++) {
          const a = tight.get(nodeId(i))!;
          const b = loose.get(nodeId(i))!;
          if (!Number.isFinite(a.lower) || !Number.isFinite(b.lower)) continue;
          expect(b.lower).toBeLessThanOrEqual(a.lower + 1e-9);
          expect(b.upper).toBeGreaterThanOrEqual(a.upper - 1e-9);
        }
        return true;
      }),
      fcParams
    );
  });

  it('ningún ε_i negativo sobrevive a la validación del DAG', () => {
    fc.assert(
      fc.property(
        dagSpecArb(),
        fc.double({ min: 1e-12, max: 100, noNaN: true, noDefaultInfinity: true }),
        (spec, delta) => {
          const bad = buildDAG(spec, () => -delta);
          if (bad.equations.length === 0) return true; // DAG sin ecuaciones
          expect(() => validateDAG(bad)).toThrow(/must be ≥ 0/);
          expect(() => propagateIntervals(bad, inputsOf(spec))).toThrow(/must be ≥ 0/);
          return true;
        }
      ),
      fcParams
    );
  });
});

describe('B8 · CASO NEGATIVO — con |u_i| > ε_i la contención puede fallar (H2 violada)', () => {
  /**
   * Esto NO es un bug: es H2 del Teorema 6.1 dejando de cumplirse.
   *
   * El teorema es un condicional. Si el error real de una ecuación excede el
   * bound declarado, su conclusión no aplica y el valor real puede quedar fuera
   * del intervalo propagado — y con él, fuera del reachable set y del
   * certificado que la Capa 3 emita. Por eso la Definición 4.4 insiste en que
   * ε debe cubrir el PEOR CASO observado más un margen, no el caso promedio, y
   * en que la garantía es determinista, no probabilística.
   *
   * Que la contención "pueda" fallar y no "deba" fallar es esencial: la
   * aritmética de intervalos sobre-aproxima (wrapping effect, §4.4.2), de modo
   * que un exceso pequeño suele quedar absorbido por el conservatismo. La
   * propiedad se enuncia por tanto de forma EXISTENCIAL sobre la campaña.
   */
  it('existe al menos un caso generado en que violar el bound rompe la contención', () => {
    let violations = 0;
    let evaluated = 0;

    fc.assert(
      fc.property(
        scenarioArb(2),
        fc.double({ min: 1.5, max: 20, noNaN: true, noDefaultInfinity: true }),
        ([spec, [rootFractions, uFactors]], excess) => {
          const dag = buildDAG(spec);
          const propagated = propagateIntervals(dag, inputsOf(spec));
          // u_i = s_i·ε_i·excess con excess > 1 ⇒ |u_i| > ε_i salvo s_i ≈ 0.
          const truth = evalTrueValues(spec, rootFractions, uFactors, excess);
          if (!allFinite(truth)) return true;

          for (let i = 0; i < spec.n; i++) {
            if (spec.roots.has(i)) continue;
            const iv = propagated.get(nodeId(i))!;
            if (!Number.isFinite(iv.lower) || !Number.isFinite(iv.upper)) continue;
            evaluated++;
            if (!containedWithin(truth[i], iv.lower, iv.upper)) violations++;
          }
          return true;
        }
      ),
      fcParams
    );

    expect(evaluated).toBeGreaterThan(0);
    expect(violations).toBeGreaterThan(0);
  });

  it('contraejemplo determinista: cadena exacta donde el exceso escapa siempre', () => {
    // Y = X (identidad exacta) con ε_Y = 1. Si el error real es u = 3 > ε_Y = 1,
    // el valor real 5 + 3 = 8 queda fuera de [V_Y] = [5, 5] ⊕ [−1, 1] = [4, 6].
    // No hay sobre-aproximación que lo absorba: f es la identidad y la entrada
    // es un punto.
    const dag: CausalDAG = {
      nodes: [
        { id: 'X', label: 'X', unit: 'u' },
        { id: 'Y', label: 'Y', unit: 'u' },
      ],
      edges: [{ from: 'X', to: 'Y', weight: { lower: 1, upper: 1 } }],
      equations: [{ nodeId: 'Y', compute: (p) => p.get('X')!, modelErrorBound: 1 }],
    };

    const propagated = propagateIntervals(dag, new Map([['X', { lower: 5, upper: 5 }]]));
    expect(propagated.get('Y')).toEqual({ lower: 4, upper: 6 });

    // |u| ≤ ε ⇒ contención (Teorema 4.1)
    expect(containedWithin(5 + 1, 4, 6)).toBe(true);
    expect(containedWithin(5 - 1, 4, 6)).toBe(true);
    // |u| > ε ⇒ H2 violada, el teorema no dice nada y la contención se rompe
    expect(containedWithin(5 + 3, 4, 6)).toBe(false);
  });
});
