/**
 * AURA v2 — Modo offline: ingesta desde fixtures en lugar de red
 *
 * Existe por dos razones, y ambas son de reproducibilidad:
 *
 *  1. NINGÚN TEST DEBE TOCAR LA RED. Un test que depende de una API externa no
 *     falla por el código: falla por el tiempo que hace, por una cuota o por un
 *     cambio de esquema aguas arriba. Deja de ser una comprobación.
 *  2. TODO NÚMERO PUBLICADO DEBE SER REGENERABLE. El pipeline de `npm run repro`
 *     parte de respuestas de API FIJAS y versionadas (`fixtures/`), de modo que
 *     el resultado de hoy es byte a byte el de dentro de un año.
 *
 * EL MODO POR DEFECTO NO CAMBIA: sin `AURA_OFFLINE=1` ni `config.offline`, los
 * clientes hacen `fetch` exactamente como antes.
 *
 * Variables de entorno:
 *   AURA_OFFLINE          '1' para leer de fixtures en lugar de la red.
 *   AURA_FIXTURE_SCENARIO Escenario a leer (default 's1-normal').
 *   AURA_FIXTURES_DIR     Raíz de los fixtures (default '<cwd>/fixtures').
 *
 * La configuración explícita (`SourceFetchConfig`) tiene PRIORIDAD sobre el
 * entorno: un test que pide un escenario concreto no debe depender de cómo esté
 * el shell de quien lo ejecuta.
 */

/** Configuración de una llamada a un cliente de fuente. */
export interface SourceFetchConfig {
  /**
   * `true` → leer de fixtures; `false` → red; `undefined` → decide el entorno
   * (`AURA_OFFLINE === '1'`).
   */
  offline?: boolean;
  /** Escenario de `fixtures/` a leer. Por defecto, el del entorno. */
  scenario?: string;
  /** Raíz de los fixtures. Por defecto, la del entorno. */
  fixturesDir?: string;
}

export const DEFAULT_SCENARIO = 's1-normal';

export const FIXTURE_SCENARIOS = [
  's1-normal',
  's2-light-rain',
  's3-virga-conflict',
  's4-extreme',
] as const;

export type FixtureScenario = (typeof FIXTURE_SCENARIOS)[number];

/** Lectura del entorno, aislada para poder testearla sin tocar `process.env`. */
function envValue(key: string): string | undefined {
  return typeof process !== 'undefined' && process.env ? process.env[key] : undefined;
}

/** ¿Está activo el modo offline para esta llamada? */
export function isOffline(config?: SourceFetchConfig): boolean {
  if (config?.offline !== undefined) return config.offline;
  return envValue('AURA_OFFLINE') === '1';
}

export function resolveScenario(config?: SourceFetchConfig): string {
  return config?.scenario ?? envValue('AURA_FIXTURE_SCENARIO') ?? DEFAULT_SCENARIO;
}

export function resolveFixturesDir(config?: SourceFetchConfig): string {
  return config?.fixturesDir ?? envValue('AURA_FIXTURES_DIR') ?? 'fixtures';
}

/**
 * Carga un fichero de fixture del escenario activo.
 *
 * `node:fs` se importa DINÁMICAMENTE y solo dentro de esta rama: el módulo lo
 * consumen clientes que también se empaquetan para el navegador, y un `import`
 * estático de `fs` arrastraría un polyfill (o rompería el build) aunque el modo
 * offline no se use nunca.
 *
 * @throws con el escenario y la ruta absoluta si el fichero no existe — es el
 *         error que un usuario ve al pedir un escenario mal escrito, y sin la
 *         ruta es indepurable.
 */
export async function loadFixture<T>(fileName: string, config?: SourceFetchConfig): Promise<T> {
  const [{ readFile }, path] = await Promise.all([
    import('node:fs/promises'),
    import('node:path'),
  ]);

  const scenario = resolveScenario(config);
  const dir = resolveFixturesDir(config);
  const full = path.resolve(dir, scenario, fileName);

  let raw: string;
  try {
    raw = await readFile(full, 'utf8');
  } catch {
    throw new Error(
      `modo offline: no se encuentra el fixture '${fileName}' del escenario ` +
        `'${scenario}' (ruta esperada: ${full}). Escenarios disponibles: ` +
        `${FIXTURE_SCENARIOS.join(', ')}.`
    );
  }

  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    throw new Error(`modo offline: el fixture ${full} no es JSON válido (${String(e)}).`);
  }
}

/**
 * Parsea un instante ISO **como UTC**, venga o no con sufijo `Z`.
 *
 * Open-Meteo (`current.time`, con `timezone=GMT`) y AEMET (`fint`) devuelven la
 * marca sin zona. `Date.parse` interpreta entonces una fecha-hora sin zona como
 * hora LOCAL, de modo que el mismo fixture produciría timestamps distintos en
 * Madrid y en el runner de CI — y con ellos, resultados no reproducibles.
 */
export function parseUtcTimestamp(iso: string): number {
  const normalized = /[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  const t = Date.parse(normalized);
  if (!Number.isFinite(t)) {
    throw new Error(`instante no parseable: '${iso}'`);
  }
  return t;
}
