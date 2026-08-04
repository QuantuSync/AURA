/**
 * AURA v2 — Lanzador de la campaña de properties (`npm run test:properties`)
 *
 * Existe para que `FC_NUM_RUNS` sea un DEFAULT y no una imposición.
 *
 * El script anterior era `cross-env FC_NUM_RUNS=20000 vitest run …`, que fija la
 * variable ANTES de ejecutar y por tanto pisa cualquier valor del entorno. Con
 * él, `FC_NUM_RUNS=1000 npm run test:properties` seguía ejecutando 20.000 casos
 * — es decir, CI no podía tener un ciclo rápido sin duplicar el script.
 *
 * Aquí el valor del entorno MANDA y 20.000 es solo el valor por defecto, que es
 * el de la campaña de referencia del README.
 */

import { spawn } from 'node:child_process';

/** Casos por propiedad de la campaña de referencia. */
const DEFAULT_NUM_RUNS = '20000';

process.env.FC_NUM_RUNS ||= DEFAULT_NUM_RUNS;

process.stdout.write(
  `  campaña de properties: FC_NUM_RUNS=${process.env.FC_NUM_RUNS}` +
    `${process.env.FC_SEED ? `, FC_SEED=${process.env.FC_SEED}` : ''}\n`
);

const child = spawn(
  'npx',
  ['vitest', 'run', '--reporter=verbose', '--testTimeout=600000', '__tests__/properties'],
  { stdio: 'inherit', shell: true, env: process.env }
);

child.on('error', () => process.exit(1));
child.on('exit', (code) => process.exit(code ?? 1));
