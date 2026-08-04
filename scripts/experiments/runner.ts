/**
 * AURA v2 — Runner común de experimentos
 *
 * Contrato ÚNICO para todo experimento del repositorio (cobertura Monte Carlo,
 * comparación con baselines, hindcast…). Ver scripts/experiments/README.md.
 *
 * Lo que impone, y por qué:
 *
 *  · SEMILLA OBLIGATORIA POR CLI. Sin `--seed`, el runner LANZA. No hay valor
 *    por defecto a propósito: un experimento cuya semilla se elige sola produce
 *    un número que nadie puede reproducir, y ese número acaba en un paper.
 *  · SALIDA ESTÁNDAR en `out/experiments/<nombre>/`, siempre los mismos tres
 *    ficheros: `config.json` (qué se ejecutó), `results.json` (qué salió) y
 *    `results.csv` (lo mismo, tabulado). Quien audite un experimento sabe dónde
 *    mirar sin leer su código. Un experimento puede añadir artefactos propios
 *    —figuras, tablas secundarias— por {@link ExperimentOutput.artifacts}, pero
 *    NUNCA escribiendo por su cuenta: el runner es el único que toca el disco.
 *  · SERIALIZACIÓN CANÓNICA, la misma de `npm run repro`: claves ordenadas,
 *    12 cifras significativas, sin reloj. Los resultados entran así en
 *    `snapshots/` y cualquier deriva se ve en el diff.
 *
 * Lo que NO impone: qué computa el experimento. El runner recibe una función y
 * le entrega el PRNG sembrado y los flags parseados.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { Rng, makeRng } from '@/lib/prng';
import { canonicalJson, toCsv } from '../lib/canonical';

export const EXPERIMENTS_DIR = path.resolve('out', 'experiments');

/** Flags de línea de comandos ya parseados. */
export interface Flags {
  /** Semilla del PRNG. Obligatoria. */
  seed: number;
  /**
   * Resto de flags sin interpretar. `true` marca un flag presente sin valor
   * (`--verbose`); nunca aparece `false`, porque un flag ausente simplemente no
   * está en el objeto — distinguir «ausente» de «puesto a false» es lo que
   * permite que los defaults de `number`/`string` funcionen.
   */
  raw: Record<string, string | true>;
  /** `--clave` como número, con valor por defecto. @throws si no es numérico. */
  number(key: string, fallback: number): number;
  /** `--clave` como cadena, con valor por defecto. */
  string(key: string, fallback: string): string;
  /** `--clave` como booleano (presente sin valor = `true`). */
  boolean(key: string, fallback?: boolean): boolean;
}

/**
 * Parsea `--clave=valor`, `--clave valor` y `--flag`.
 *
 * @throws si falta `--seed` o si no es un entero positivo. El mensaje incluye la
 *         invocación correcta: es el error que más se va a ver.
 */
export function parseFlags(argv: readonly string[]): Flags {
  const raw: Record<string, string | true> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;

    const eq = arg.indexOf('=');
    if (eq !== -1) {
      raw[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }

    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      raw[key] = next;
      i++;
    } else {
      raw[key] = true;
    }
  }

  const seedRaw = raw['seed'];
  if (seedRaw === undefined || seedRaw === true) {
    throw new Error(
      'experimento sin semilla. La semilla es OBLIGATORIA: un resultado cuya ' +
        'semilla se elige sola no es reproducible y no debe citarse.\n' +
        '  uso: npx tsx scripts/experiments/<nombre>.ts --seed 20260804 [--flag valor]'
    );
  }

  const seed = Number(seedRaw);
  if (!Number.isInteger(seed) || seed <= 0) {
    throw new Error(`--seed debe ser un entero positivo; recibido '${String(seedRaw)}'.`);
  }

  const asString = (key: string): string | undefined => {
    const v = raw[key];
    return v === undefined || v === true ? undefined : v;
  };

  return {
    seed,
    raw,
    number(key, fallback) {
      const v = asString(key);
      if (v === undefined) return fallback;
      const num = Number(v);
      if (!Number.isFinite(num)) throw new Error(`--${key} debe ser numérico; recibido '${v}'.`);
      return num;
    },
    string(key, fallback) {
      return asString(key) ?? fallback;
    },
    boolean(key, fallback = false) {
      const v = raw[key];
      if (v === undefined) return fallback;
      if (v === true) return true;
      return v === 'true' || v === '1';
    },
  };
}

/** Contexto que el runner entrega al cuerpo del experimento. */
export interface ExperimentContext {
  flags: Flags;
  /** PRNG sembrado con `flags.seed`. La ÚNICA aleatoriedad admitida. */
  rng: Rng;
  /** Traza de progreso; no forma parte de la salida versionada. */
  log(message: string): void;
}

/** Lo que un experimento devuelve. */
export interface ExperimentOutput {
  /** Resultado estructurado. Se serializa canónicamente a `results.json`. */
  results: unknown;
  /** Cabecera del CSV. */
  csvHeader: readonly string[];
  /** Filas del CSV, en orden. */
  csvRows: readonly (string | number)[][];
  /**
   * Parámetros efectivos del experimento (tras aplicar defaults), para
   * `config.json`. La semilla se añade sola.
   */
  config?: Record<string, unknown>;
  /**
   * Artefactos adicionales: ruta RELATIVA al directorio del experimento →
   * contenido ya serializado. Se escriben en orden alfabético de clave.
   *
   * Existe para que las figuras de un experimento salgan por el mismo camino
   * que sus números —mismo directorio, misma ejecución, mismo snapshot— en vez
   * de que cada script abra su propio `writeFile` y la convención de salida
   * deje de significar nada. El contenido debe ser DETERMINISTA (las figuras
   * SVG del repositorio lo son: ver scripts/lib/svg.ts).
   *
   * Las rutas se validan: relativas, sin `..` y sin raíz absoluta. Un
   * experimento no puede escribir fuera de su propio directorio.
   */
  artifacts?: Readonly<Record<string, string>>;
}

export interface ExperimentDefinition {
  /** Nombre en kebab-case. Determina `out/experiments/<nombre>/`. */
  name: string;
  /** Una línea sobre qué mide. Va a `config.json`. */
  description: string;
  run(ctx: ExperimentContext): ExperimentOutput | Promise<ExperimentOutput>;
}

/**
 * Ejecuta un experimento y escribe su salida estándar.
 *
 * `config.json` registra la semilla y los flags EFECTIVOS —no los que se
 * pasaron— para que reproducirlo no exija adivinar qué valores por defecto
 * estaban vigentes el día en que se ejecutó.
 */
export async function runExperiment(
  definition: ExperimentDefinition,
  argv: readonly string[] = process.argv.slice(2)
): Promise<void> {
  const flags = parseFlags(argv);
  const rng = makeRng(flags.seed);
  const log = (m: string) => process.stdout.write(`  [${definition.name}] ${m}\n`);

  const output = await definition.run({ flags, rng, log });

  const dir = path.join(EXPERIMENTS_DIR, definition.name);
  await mkdir(dir, { recursive: true });

  await writeFile(
    path.join(dir, 'config.json'),
    canonicalJson({
      experiment: definition.name,
      description: definition.description,
      seed: flags.seed,
      parameters: output.config ?? {},
    }),
    'utf8'
  );
  await writeFile(path.join(dir, 'results.json'), canonicalJson(output.results), 'utf8');
  await writeFile(path.join(dir, 'results.csv'), toCsv(output.csvHeader, output.csvRows), 'utf8');

  // Orden alfabético: el conjunto de ficheros no depende del orden en que el
  // experimento los fue construyendo.
  for (const rel of Object.keys(output.artifacts ?? {}).sort()) {
    const normalized = path.normalize(rel);
    if (path.isAbsolute(normalized) || normalized.split(path.sep).includes('..')) {
      throw new Error(
        `${definition.name}: el artefacto '${rel}' apunta fuera del directorio del ` +
          `experimento. Las rutas deben ser relativas y no contener '..'.`
      );
    }
    const dest = path.join(dir, normalized);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, output.artifacts![rel], 'utf8');
  }

  log(`escrito en ${dir}`);
}

/** Envoltorio de arranque: convierte un fallo en salida 1 con traza legible. */
export function main(definition: ExperimentDefinition): void {
  runExperiment(definition).catch((e) => {
    process.stderr.write(`\n${definition.name}: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
