/**
 * AURA v2 — Comparación de `out/` contra `snapshots/`
 *
 *   npm run snapshots:check    compara y falla ante cualquier divergencia
 *   npm run snapshots:update   regenera los snapshots DELIBERADAMENTE
 *
 * POR QUÉ LA ACTUALIZACIÓN NUNCA ES AUTOMÁTICA. Un snapshot que se regenera solo
 * al fallar no verifica nada: convierte cualquier cambio de resultado en un
 * cambio de expectativa, y el commit que altera un número publicado pasa
 * inadvertido. Actualizar es una decisión explícita, y el diff de `snapshots/`
 * en el pull request es la constancia de esa decisión.
 *
 * `out/` está en `.gitignore` y `snapshots/` no: lo versionado es la
 * EXPECTATIVA, y lo efímero es la ejecución.
 */

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT_DIR = path.resolve('out');
const SNAPSHOT_DIR = path.resolve('snapshots');

/** Líneas divergentes que se muestran por fichero antes de resumir el resto. */
const MAX_DIFF_LINES = 12;

/** Rutas relativas de todos los ficheros del árbol, ordenadas. */
async function walk(root: string, prefix = ''): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  } catch {
    return [];
  }

  const out: string[] = [];
  // Orden alfabético explícito: `readdir` no lo garantiza entre sistemas de
  // ficheros, y un informe de divergencias en orden variable es ilegible.
  for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await walk(root, rel)));
    else out.push(rel);
  }
  return out;
}

/** Primeras líneas en que dos ficheros difieren, en formato esperado/obtenido. */
function lineDiff(expected: string, actual: string): string[] {
  const a = expected.split('\n');
  const b = actual.split('\n');
  const lines: string[] = [];
  let differing = 0;

  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    differing++;
    if (lines.length < MAX_DIFF_LINES * 2) {
      lines.push(`      línea ${i + 1}`);
      lines.push(`        esperado: ${a[i] === undefined ? '<fin de fichero>' : a[i].trim()}`);
      lines.push(`        obtenido: ${b[i] === undefined ? '<fin de fichero>' : b[i].trim()}`);
    }
  }

  if (differing > MAX_DIFF_LINES) {
    lines.push(`      … y ${differing - MAX_DIFF_LINES} líneas divergentes más`);
  }
  return lines;
}

async function check(): Promise<number> {
  const expected = await walk(SNAPSHOT_DIR);
  const actual = await walk(OUT_DIR);

  if (expected.length === 0) {
    process.stderr.write(
      `\nsnapshots: '${SNAPSHOT_DIR}' está vacío o no existe. Genéralos con ` +
        `\`npm run snapshots:update\` y revísalos antes de commitear.\n`
    );
    return 1;
  }

  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);

  const missing = expected.filter((f) => !actualSet.has(f));
  const extra = actual.filter((f) => !expectedSet.has(f));
  const changed: { file: string; diff: string[] }[] = [];

  for (const file of expected) {
    if (!actualSet.has(file)) continue;
    const [exp, act] = await Promise.all([
      readFile(path.join(SNAPSHOT_DIR, file), 'utf8'),
      readFile(path.join(OUT_DIR, file), 'utf8'),
    ]);
    if (exp !== act) changed.push({ file, diff: lineDiff(exp, act) });
  }

  if (missing.length === 0 && extra.length === 0 && changed.length === 0) {
    process.stdout.write(`  ${expected.length} ficheros idénticos a snapshots/\n`);
    return 0;
  }

  process.stderr.write('\n  DIVERGENCIA entre out/ y snapshots/\n');

  for (const f of missing) {
    process.stderr.write(`\n    FALTA en out/: ${f}\n      (está en snapshots/ pero no se generó)\n`);
  }
  for (const f of extra) {
    process.stderr.write(
      `\n    SOBRA en out/: ${f}\n      (se generó pero no está en snapshots/)\n`
    );
  }
  for (const { file, diff } of changed) {
    process.stderr.write(`\n    DIFIERE: ${file}\n${diff.join('\n')}\n`);
  }

  process.stderr.write(
    `\n  ${missing.length} faltan, ${extra.length} sobran, ${changed.length} difieren.\n` +
      `  Si el cambio es INTENCIONADO, revisa el diff y ejecuta \`npm run snapshots:update\`.\n`
  );
  return 1;
}

async function update(): Promise<number> {
  const files = await walk(OUT_DIR);
  if (files.length === 0) {
    process.stderr.write(
      `\nsnapshots:update: '${OUT_DIR}' está vacío. Ejecuta \`npm run repro\` primero.\n`
    );
    return 1;
  }

  // Se borra el destino: si un escenario desaparece, su snapshot debe
  // desaparecer con él, y copiar por encima lo dejaría vivo para siempre.
  await rm(SNAPSHOT_DIR, { recursive: true, force: true });

  for (const file of files) {
    const dest = path.join(SNAPSHOT_DIR, file);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, await readFile(path.join(OUT_DIR, file), 'utf8'), 'utf8');
  }

  process.stdout.write(
    `  ${files.length} snapshots regenerados en ${SNAPSHOT_DIR}\n` +
      `  Revisa \`git diff snapshots/\` ANTES de commitear: cada línea que cambie es un\n` +
      `  resultado publicado que cambia.\n`
  );
  return 0;
}

const isUpdate = process.argv.slice(2).includes('--update');

(isUpdate ? update() : check())
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(`\nsnapshots: ${e instanceof Error ? e.stack : String(e)}\n`);
    process.exit(1);
  });
