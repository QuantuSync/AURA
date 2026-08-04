/**
 * AURA v2 — Perfil de ejecución de un experimento
 *
 * Los tres experimentos de cobertura se ejecutan en DOS regímenes con el mismo
 * código y la misma semilla:
 *
 *   · `full`   — la campaña citable (N grande). Se lanza a mano con `npm run
 *                exp:<nombre>` y su resultado se registra en el README de
 *                `scripts/experiments/`. NO entra en `snapshots/`: son decenas
 *                de miles de mundos y su salida no es un artefacto que tenga
 *                sentido versionar en cada commit.
 *   · `verify` — la versión reducida (N = 200) que corre dentro de
 *                `npm run verify` y SÍ está en `snapshots/`, siguiendo el
 *                patrón de `exp:smoke`. Detecta cualquier deriva en el
 *                pipeline de un experimento sin pagar la campaña completa.
 *
 * POR QUÉ EL PERFIL CAMBIA EL NOMBRE DEL EXPERIMENTO. `npm run snapshots:check`
 * compara `out/` ENTERO contra `snapshots/`: un fichero de más en `out/` es una
 * divergencia. Si las dos versiones escribieran en el mismo
 * `out/experiments/coverage/`, la campaña completa dejaría allí un resultado
 * que no coincide con el snapshot reducido y `verify` fallaría por un motivo
 * que no es un error. Con nombres distintos —`coverage` y `coverage-verify`—
 * cada régimen tiene su directorio y su expectativa.
 *
 * (En la práctica `npm run repro`, primer paso versionado de `verify`, borra
 * `out/` al empezar, de modo que los restos de una campaña completa desaparecen
 * antes de la comparación. La separación de nombres es el cinturón; ese borrado
 * es los tirantes.)
 */

import {
  CONFLICT_RULE_IDS,
  ConflictRuleId,
} from '@/core/dempster-shafer/conflict-rules';
import { DEFAULT_FUSION_CONFIG, FusionConfig } from '@/core/dempster-shafer/types';

export type Profile = 'full' | 'verify';

/**
 * Lee `--profile` de `argv` SIN pasar por `parseFlags`.
 *
 * Hace falta antes de `main()`, que es donde se fija el nombre del experimento
 * y por tanto su directorio de salida; `parseFlags` no sirve ahí porque lanza
 * si falta `--seed`, y ese error debe verse como error del experimento (con su
 * mensaje de uso), no como una excepción durante la carga del módulo.
 *
 * @throws si el valor no es uno de los dos perfiles: un `--profile verfy` mal
 *         escrito escribiría en el directorio de la campaña completa y
 *         corrompería el snapshot sin decir nada.
 */
export function profileOf(argv: readonly string[] = process.argv.slice(2)): Profile {
  let value: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--profile') {
      value = argv[i + 1];
    } else if (arg.startsWith('--profile=')) {
      value = arg.slice('--profile='.length);
    }
  }

  if (value === undefined) return 'full';
  if (value === 'full' || value === 'verify') return value;

  throw new Error(
    `--profile debe ser 'full' o 'verify'; recibido '${value}'. ` +
      `El perfil determina el directorio de salida y con él el snapshot contra el ` +
      `que se compara.`
  );
}

/**
 * Lee `--rule` de `argv`, con la MISMA lógica pre-`parseFlags` que
 * {@link profileOf} y por el mismo motivo: la regla entra en el nombre del
 * experimento, y el nombre se fija antes de `main()`.
 *
 * Existe para poder reproducir con un flag los números publicados bajo una
 * regla de conflicto anterior —en particular los de C0, previos a la
 * corrección de `docs/ERRATA.md` §9— sin tocar el default del sistema.
 *
 * @throws si el identificador no es una de las reglas conocidas.
 */
export function ruleOverrideOf(
  argv: readonly string[] = process.argv.slice(2)
): ConflictRuleId | undefined {
  let value: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--rule') {
      value = argv[i + 1];
    } else if (arg.startsWith('--rule=')) {
      value = arg.slice('--rule='.length);
    }
  }

  if (value === undefined) return undefined;
  if ((CONFLICT_RULE_IDS as readonly string[]).includes(value)) return value as ConflictRuleId;

  throw new Error(
    `--rule debe ser una de {${CONFLICT_RULE_IDS.join(', ')}}; recibido '${value}'. ` +
      `La regla determina la estrategia de fusión y el directorio de salida.`
  );
}

/** Configuración de fusión efectiva para un override de regla. */
export function fusionConfigFor(rule: ConflictRuleId | undefined): FusionConfig {
  return rule === undefined ? DEFAULT_FUSION_CONFIG : { ...DEFAULT_FUSION_CONFIG, rule };
}

/**
 * Nombre del experimento: `coverage`, `coverage-verify`, `coverage-c0`…
 *
 * La regla solo entra en el nombre cuando NO es la del sistema, por el mismo
 * motivo que el perfil: `snapshots:check` compara `out/` entero, y una
 * ejecución de referencia con otra regla no debe pisar el directorio cuya
 * salida está versionada.
 */
export function nameFor(base: string, profile: Profile, rule?: ConflictRuleId): string {
  const withRule =
    rule === undefined || rule === DEFAULT_FUSION_CONFIG.rule ? base : `${base}-${rule.toLowerCase()}`;
  return profile === 'verify' ? `${withRule}-verify` : withRule;
}
