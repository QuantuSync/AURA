/**
 * AURA v2 — Verificación completa (`npm run verify`)
 *
 * La puerta única: lo que pasa aquí es lo que puede publicarse. Ejecuta, EN
 * ORDEN y parando en el primer fallo:
 *
 *   1. npx tsc --noEmit       tipos
 *   2. npm run test:run       suite completa
 *   3. npm run test:properties campaña de property-based testing
 *   4. npm run repro          regeneración de todos los resultados
 *   5. npm run exp:smoke      experimento de ejemplo (contrato del runner)
 *   6. npm run snapshots:check comparación byte a byte contra snapshots/
 *
 * EL ORDEN NO ES ARBITRARIO: va de lo barato y general a lo caro y específico.
 * Un error de tipos invalida todo lo demás, así que se detecta en segundos en
 * lugar de después de una campaña de properties de minuto y medio.
 *
 * FC_NUM_RUNS se propaga al paso 3: CI lo fija en 1.000 para el ciclo rápido y
 * el job manual en 20.000. Sin él, `test:properties` usa su valor por defecto
 * (20.000), que es el de la campaña de referencia.
 */

import { spawn } from 'node:child_process';

interface Step {
  name: string;
  command: string;
  args: string[];
}

const STEPS: Step[] = [
  { name: 'tipos (tsc --noEmit)', command: 'npx', args: ['tsc', '--noEmit'] },
  { name: 'tests', command: 'npm', args: ['run', 'test:run'] },
  { name: 'properties', command: 'npm', args: ['run', 'test:properties'] },
  { name: 'repro', command: 'npm', args: ['run', 'repro'] },
  { name: 'experimento smoke', command: 'npm', args: ['run', 'exp:smoke'] },
  { name: 'snapshots', command: 'npm', args: ['run', 'snapshots:check'] },
];

function run(step: Step): Promise<number> {
  return new Promise((resolve) => {
    // `shell: true` es necesario en Windows, donde `npm` y `npx` son .cmd y no
    // ejecutables que `spawn` pueda lanzar directamente.
    const child = spawn(step.command, step.args, {
      stdio: 'inherit',
      shell: true,
      env: process.env,
    });
    child.on('error', () => resolve(1));
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

async function main(): Promise<void> {
  const started = Date.now();
  const timings: { name: string; ms: number }[] = [];

  for (const [i, step] of STEPS.entries()) {
    process.stdout.write(`\n──── ${i + 1}/${STEPS.length} · ${step.name}\n\n`);

    const t0 = Date.now();
    const code = await run(step);
    const ms = Date.now() - t0;
    timings.push({ name: step.name, ms });

    if (code !== 0) {
      process.stderr.write(
        `\n  FALLO en '${step.name}' (código ${code}, ${seconds(ms)}).\n` +
          `  Los pasos posteriores NO se han ejecutado.\n`
      );
      process.exit(code);
    }
    process.stdout.write(`\n  ✓ ${step.name} — ${seconds(ms)}\n`);
  }

  process.stdout.write('\n──── verify OK\n\n');
  for (const t of timings) {
    process.stdout.write(`  ${t.name.padEnd(24)} ${seconds(t.ms).padStart(9)}\n`);
  }
  process.stdout.write(`  ${'TOTAL'.padEnd(24)} ${seconds(Date.now() - started).padStart(9)}\n\n`);
}

void main();
