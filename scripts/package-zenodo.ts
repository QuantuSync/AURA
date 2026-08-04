/**
 * AURA v2 — Empaquetado del artefacto de verificación para Zenodo
 *
 *   npm run package:zenodo
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ PRODUCE Y POR QUÉ ASÍ
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `dist/aura-verification-artifact-<version>.zip`: lo necesario para regenerar y
 * verificar las cifras del paper, y nada más. El paper NO viaja dentro — se
 * publica como PDF independiente en el mismo registro—, y `papers/` queda fuera
 * entero: el zip verifica al paper, no documenta su historia.
 *
 * Tres decisiones que hacen que el artefacto signifique algo:
 *
 *  · SE EMPAQUETA `git archive HEAD`, NUNCA EL WORKING TREE. Un artefacto
 *    construido desde ficheros sin commitear no es atribuible a ningún commit, y
 *    entonces «reproducible» no quiere decir nada. Por eso el script ABORTA si
 *    `git status` no está limpio, en lugar de empaquetar lo que haya.
 *
 *  · SE VALIDA EXTRAYENDO FUERA DEL REPOSITORIO. El zip se descomprime en un
 *    directorio temporal del sistema y allí se ejecutan `npm ci` y
 *    `npm run verify` completos. Es la única comprobación que descarta el fallo
 *    clásico del artefacto de reproducibilidad: que funcione solo porque
 *    encuentra al lado el repositorio del que salió. Si la validación falla, el
 *    zip NO se deja en `dist/`.
 *
 *  · SE FIJAN LAS MTIME AL COMMIT. `git archive` ya sella cada fichero con la
 *    fecha del commit; los dos ficheros generados aquí (`VERIFYING.md` y
 *    `SHA256SUMS.txt`) se sellan igual. Así dos empaquetados del mismo commit
 *    producen el mismo contenido bit a bit, y `SHA256SUMS.txt` es comparable
 *    entre ellos. (El SHA-256 del zip ENTERO puede variar con la herramienta de
 *    compresión; ver la nota de `VERIFYING.md`.)
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO = process.cwd();

/**
 * Rutas que NO entran en el artefacto, como pathspecs de `git archive`.
 *
 *  · `papers/` — el zip verifica al paper, que se publica aparte. Incluye el
 *    documento interno de fundamentos, que es referencia del CÓDIGO y no del
 *    artefacto.
 *  · `.github/` — CI de GitHub; no hace falta para ejecutar nada localmente.
 */
const EXCLUDED = ['papers', '.github'];

const log = (m: string) => process.stdout.write(`  [package:zenodo] ${m}\n`);
const fail = (m: string): never => {
  process.stderr.write(`\npackage:zenodo: ${m}\n`);
  process.exit(1);
};

const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const sha256 = (file: string): string =>
  createHash('sha256').update(readFileSync(file)).digest('hex');

/** Rutas relativas de todos los ficheros de un árbol, ordenadas. */
function walk(root: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(root, rel));
    else out.push(rel);
  }
  return out.sort();
}

const humanSize = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(2)} MiB`
    : `${(bytes / 1024).toFixed(1)} KiB`;

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

// ─────────────────────────────────────────────────────────────────────────────
// Compresión y extracción, con las herramientas que haya
// ─────────────────────────────────────────────────────────────────────────────

function available(cmd: string, args: string[]): boolean {
  const r = spawnSync(cmd, args, { stdio: 'ignore', shell: false });
  return r.status === 0;
}

/** `tar` capaz de escribir zip (bsdtar/libarchive). GNU tar NO lo es. */
function bsdtarPath(): string | null {
  const candidates = [
    ...(process.platform === 'win32' ? [path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')] : []),
    'bsdtar',
    'tar',
  ];
  for (const c of candidates) {
    const r = spawnSync(c, ['--version'], { encoding: 'utf8' });
    if (r.status === 0 && /bsdtar|libarchive/i.test(r.stdout ?? '')) return c;
  }
  return null;
}

function makeZip(contentDir: string, zipPath: string): string {
  const entries = readdirSync(contentDir).sort();
  rmSync(zipPath, { force: true });

  if (available('zip', ['-v'])) {
    execFileSync('zip', ['-r', '-q', '-X', zipPath, ...entries], { cwd: contentDir });
    return 'zip';
  }
  const bsdtar = bsdtarPath();
  if (bsdtar) {
    execFileSync(bsdtar, ['-a', '-c', '-f', zipPath, ...entries], { cwd: contentDir });
    return `bsdtar (${bsdtar})`;
  }
  if (process.platform === 'win32') {
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Compress-Archive -Path '${contentDir}\\*' -DestinationPath '${zipPath}' -Force`,
      ],
      { stdio: 'inherit' }
    );
    return 'PowerShell Compress-Archive';
  }
  return fail('no hay ninguna herramienta de compresión disponible (zip, bsdtar o PowerShell).');
}

function extractZip(zipPath: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  if (available('unzip', ['-v'])) {
    execFileSync('unzip', ['-q', zipPath, '-d', destDir]);
    return;
  }
  const bsdtar = bsdtarPath();
  if (bsdtar) {
    execFileSync(bsdtar, ['-x', '-f', zipPath, '-C', destDir]);
    return;
  }
  fail('no hay ninguna herramienta de extracción disponible (unzip o bsdtar).');
}

// ─────────────────────────────────────────────────────────────────────────────
// VERIFYING.md — el mapa paper → comando
// ─────────────────────────────────────────────────────────────────────────────

function verifyingDoc(version: string, commit: string, commitIso: string): string {
  return `# VERIFYING — cómo regenerar cada cifra del paper

Artefacto de verificación de **AURA v${version}**.
Commit empaquetado: \`${commit}\` (${commitIso}).

Este zip contiene el código, los tests, los experimentos, los fixtures y los
snapshots necesarios para **regenerar desde cero** cada número que el paper
afirma. El paper se publica como PDF independiente en el mismo registro de
Zenodo; \`papers/\` no viaja aquí.

---

## 1 · Requisitos y puesta en marcha

| | |
|---|---|
| Node.js | **≥ 20.11.0** (declarado en \`package.json\`). Verificado en **v22.20.0**; CI usa Node 22. |
| Gestor | \`npm\` (usa \`npm ci\`, que instala EXACTAMENTE lo que fija \`package-lock.json\`) |
| Red | Solo para \`npm ci\`. Ningún experimento sale a la red: todos leen \`fixtures/\`. |
| Sistema | Sin dependencias nativas. Probado en Windows; el motor es TypeScript puro. |

\`\`\`bash
npm ci          # instalación reproducible desde package-lock.json  (~30-60 s)
npm run verify  # la puerta única: tipos, tests, properties, repro, snapshots
\`\`\`

**\`npm run verify\` es la comprobación que resume a todas las demás** (~120 s).
Ejecuta en orden y para en el primer fallo: \`tsc --noEmit\` → suite completa
(546 tests / 37 ficheros) → campaña de properties (133 tests × 20.000 casos) →
\`repro\` → \`exp:smoke\` → los tres experimentos de cobertura reducidos a N = 200
→ el hindcast reducido a 24 h → comparación byte a byte contra \`snapshots/\`.

Si \`verify\` pasa, el árbol está en el estado exacto en que se produjeron las
cifras de abajo.

---

## 2 · Semillas canónicas

Ningún experimento tiene semilla por defecto: el runner **lanza** si falta
\`--seed\`. Las tres semillas que aparecen en el paper son distintas a propósito.

| Semilla | Dónde se usa | Por qué esa |
|---|---|---|
| **20260804** | Todas las cifras publicadas (cobertura, H1, virga, hindcast, escenarios, properties) | Semilla canónica de publicación |
| **20260311** | \`exp:conflict-rule\` (selección de la REGLA, ERRATA §9 Fase A) | Distinta de la canónica **a propósito**: la regla elegida no puede quedar ajustada a la realización del PRNG que luego se cita |
| **20261007** | \`exp:conflict-floor\` (selección de la MEDIDA, ERRATA §9 capa 3) | Mismo motivo |

Las properties usan \`FC_SEED\` (por defecto 20260804) y \`FC_NUM_RUNS\` (por
defecto 20.000 en \`test:properties\`, 1.000 en \`test:run\`).

---

## 3 · Mapa cifra → comando → fichero

Los tiempos son de una máquina de escritorio corriente e incluyen el arranque de
\`tsx\`. Todas las salidas caen bajo \`out/\`, que se regenera entero.

### 3.1 · Cobertura, anchura y baselines

\`\`\`bash
npm run exp:coverage      # ~2 s · semilla 20260804 · 10.000 mundos
\`\`\`

→ \`out/experiments/coverage/results.json\` · \`results.csv\` · \`config.json\`
→ figuras \`out/experiments/coverage/figures/f1-coverage-by-condition.svg\`, \`f2-width-vs-coverage.svg\`

| Cifra del paper | Dónde aparece exactamente |
|---|---|
| Cobertura existencial **100,00 %**, anchura **500,00** | \`byMethod["aura-existencial"].global.coverage\` / \`.meanWidth\` |
| Sin fallos de soundness: \`existentialMisses\` = 0, \`h0Violations\` = 0 | \`soundness\` |
| Banda-95 global **99,72 %**, anchura **250,18** | \`byMethod["aura-banda-95"].global\` |
| Banda-95 por estrato (sin fallo 99,75 % / fallo δ 99,87 % / virga 99,36 %) | \`byMethod["aura-banda-95"].byCondition\` |
| Baselines global **76,20 %** y **76,68 %** | \`byMethod["media-ponderada"|"kalman-estatico"].global.coverage\` |
| Baselines bajo fallo δ **2,01 %** y **2,34 %** | \`…byCondition["delta-failure"].coverage\` |
| Anchura constante de baselines **4,60** y **4,24** en TODOS los estratos | \`…byCondition[*].meanWidth\` — idéntica en los tres |
| Reparto de estrategias D/C/E por condición | \`fusionByCondition\` |

> La cobertura existencial del 100 % debe leerse **junto a su anchura**: el
> intervalo existencial es \`[0, 500]\` —el marco entero— en todos los estratos.
> Es la vacuidad que documenta \`docs/ERRATA.md\` §8, no robustez del motor.

### 3.2 · Barrido de violación de H1

\`\`\`bash
npm run exp:h1            # ~2 s · semilla 20260804 · 11 puntos × 2.000 mundos
\`\`\`

→ \`out/experiments/h1-violation/results.json\` · figura \`figures/f3-h1-degradation.svg\`

| Cifra | Dónde |
|---|---|
| Existencial **100,00 % en los 11 puntos**, incluidos los mundos violados | \`points["<fracción>"].byMethod["aura-existencial"].all|violated|intact\` |
| Degradación de la banda-95 (99,8 % → 84,0 % → 67,6 %) | \`…["aura-banda-95"].all.coverage\` |
| La banda cae solo DENTRO de los violados (~34-37 %) y no fuera (~99,8 %) | \`…["aura-banda-95"].violated\` vs \`.intact\` |

### 3.3 · Virga (Ejemplo 3.1)

\`\`\`bash
npm run exp:virga         # ~2 s · semilla 20260804 · 5.000 mundos solo-virga
\`\`\`

→ \`out/experiments/virga/results.json\`

| Cifra | Dónde |
|---|---|
| Existencial «ni P\\* ni γP\\*» **0,00 %** | \`byMethod["aura-existencial"].allWorlds.neitherFraction\` |
| Banda-95 «ni P\\* ni γP\\*» **0,06 %** (3 de 5.000) | \`byMethod["aura-banda-95"].allWorlds.neither\` |
| Baselines **43,12 %** y **41,58 %** | \`byMethod["media-ponderada"|"kalman-estatico"].allWorlds.neitherFraction\` |
| Reparto D/C/E 35,24 / 20,16 / 44,60 % | \`fusion\` |

Los tres de golpe: \`npm run exp:all\` (~6 s).

### 3.4 · Selección de la REGLA de decisión — Fase A histórica (ERRATA §9)

\`\`\`bash
npx tsx scripts/experiments/conflict-rule.ts \\
  --seed 20260311 --worlds 10000 --virga-worlds 5000 --measure D0    # ~3 s
\`\`\`

→ \`out/experiments/conflict-rule-**d0**/results.json\`

Reproduce **exactamente** la tabla histórica publicada, bajo la medida D0 que
era la vigente cuando se produjo:

| candidato | limpios → Dempster | anchura banda-95 | cobertura banda-95 |
|---|---:|---:|---:|
| C0 | 53,49 % | 296,99 | 99,910 % |
| **C1** | **57,62 %** | **280,67** | **99,840 %** |
| C2 / C3 | 57,62 % | 280,67 | 99,840 % |

Selección de **C1 en el paso 5** (empate con C2 y C3, desempate por
simplicidad) → \`selection.selected\` / \`selection.decidedAtStep\`.
Cobertura existencial 100,00 % en los cuatro → \`byRule[*].calibration.existential.coverage\`.

\`\`\`bash
npm run exp:conflict-rule                                            # ~3 s
\`\`\`

→ \`out/experiments/conflict-rule/results.json\` — la misma Fase A **a los
defaults de hoy** (medida D2). C1 pasa a **64,95 % / 252,77 / 99,710 %** y sigue
ganando, ahora **decidido en el paso 3**. Que las dos ejecuciones difieran solo
en la fila de C1 es lo que confirma que C0, C2 y C3 están congeladas sobre el K
crudo. La medida usada consta en \`config.json\` (\`parameters.measure\` y
\`parameters.candidates[].measure\`).

### 3.5 · Selección de la MEDIDA de conflicto (ERRATA §9, capa 3)

\`\`\`bash
npm run exp:conflict-floor    # ~3 s · semilla 20261007 · 10.000 + 5.000 + 5.000 mundos
\`\`\`

→ \`out/experiments/conflict-floor/results.json\`

| Cifra | Dónde |
|---|---|
| **D1 DESCALIFICADA en el paso 2**: banda-95 **99,4800 %** < piso 99,5 % | \`selection.disqualified\` |
| **D2 gana el paso 4** con **59,66 %** frente al 9,90 % de D0 | \`selection.decidedAtStep\` / \`byMeasure[*].sigmaHindcast\` |
| Suelo con acuerdo perfecto: D0 **0,3651** > κ₁, D2 **0,2727** < κ₁ | \`floorTable\` |
| Las tres pasan el requisito innegociable | \`byMeasure[*].gate.passed\` |

### 3.6 · Hindcast sobre eventos reales

\`\`\`bash
npm run exp:hindcast      # ~3 s · semilla 20260804 · E1 (96 h) + E2 (168 h)
\`\`\`

→ \`out/experiments/hindcast-e1/results.json\`, \`hindcast-e2/results.json\`
→ 4 figuras por evento en \`figures/\`

| Cifra | Dónde |
|---|---|
| E1 reparto D/C/E **76,0 / 21,9 / 2,1 %** (73/21/2 de 96 h) | \`analysis.fusionDuringPeak.wholeEvent.shares\` |
| E1 **19 h critical**, plUpper máx **0,963** | \`analysis.escalation.criticalHours\` / \`.maxPlUpper\` |
| E2 reparto **99,4 / 0,6 / 0 %** (167/1/0 de 168 h), **0 h critical** | ídem en \`hindcast-e2\` |
| Suelo estructural a 0 mm/h: **0,3651** crudo, **0,2727** con d_J | \`analysis.conflictProfile.floorAtZeroPrecipitation\` |

> ⚠ El hindcast es **descripción, no validación**: los resultados bajo D0 ya se
> conocían cuando se eligió la medida, y la selección fue solo sintética. Consta
> en el propio \`results.json\` (\`selectionDisclosure\`).

Comparación bajo la medida anterior: \`npm run exp:hindcast:d0\`.

### 3.7 · Ratio de conservatismo (Definición 5.6)

\`\`\`bash
npm run test:properties   # ~110 s · 102 propiedades × 20.000 casos · FC_SEED 20260804
\`\`\`

→ **salida por consola**, no fichero: tabla impresa por
\`__tests__/properties/nonlinear-propagation.property.test.ts\`
(«reporta el conservatismo por familia de funciones»).

| Familia | Mediciones | ρ̂ mediana | ρ̂ p95 |
|---|---:|---:|---:|
| \`k·√(x+c)\` (hidráulica, Ec. 11) | 6.646 | **1,26** | **4,15** |
| \`sin\` y composiciones | 4.654 | 2,38 | 13,10 |
| Polinomios de grado ≤ 3 | 2.641 | 4,03 | 50,49 |
| **Todas** | **13.941** | **1,55** | 13,57 |

ρ̂ ≥ 1 en las 13.941 mediciones (mínimo 1,000), como exige la soundness.

> Precisión necesaria si se cita: son las mediciones **con ρ̂ definido**. La
> campaña descarta además **9.203** mediciones degeneradas (anchura empírica
> ≤ 1e-12·escala), donde el cociente sería 0/0 — es decir, 13.941 de 23.144. La
> CONTENCIÓN sí se comprueba sobre todas, y hay una propiedad dedicada a
> zonotopes casi degenerados.

### 3.8 · Los cuatro escenarios del caso de uso

\`\`\`bash
npm run repro             # ~2 s · determinista, sin semilla: lee fixtures/
\`\`\`

→ \`out/s1-normal/\`, \`out/s2-light-rain/\`, \`out/s3-virga-conflict/\`,
\`out/s4-extreme/\` (\`result.json\`, \`summary.csv\`, 2 figuras) y \`out/summary.csv\`

| Cifra | Dónde |
|---|---|
| s2 \`plUpper\` = **1,559438e-4** | \`out/s2-light-rain/result.json\` → \`probabilityBounds.plUpper\` |
| s4 \`belLower\` ≥ **0,999** (0,99988) | \`out/s4-extreme/result.json\` → \`probabilityBounds.belLower\` |
| Severidad **idéntica 0,963147** en los cuatro | \`decision.severity\` — es la vacuidad del nivel existencial |
| Reachable \`[−12, 992]\` idéntico en los cuatro | \`reachableInterval\` |
| s3 activa la guardia κ_deg (K_global = 0,9512) | \`fusion.degeneracyGuard\` |

\`npm run repro\` es además el paso 4 de \`verify\`, y sus salidas se comparan
contra \`snapshots/\` byte a byte.

### 3.9 · Barrido continuo

\`\`\`bash
npm run exp:smoke         # ~2 s · 200 escenarios concordantes · semilla 20260804
\`\`\`
→ \`out/experiments/smoke/results.json\`. Reparto 138/52/10 (D/C/E), decisiones 181/19.

---

## 4 · Determinismo

Toda cifra de arriba es **bit a bit reproducible**: mismo comando y misma
semilla ⇒ mismos ficheros. Comprobado ejecutando dos veces y diffeando:

\`\`\`bash
npm run exp:all && cp -r out/experiments /tmp/pass1
npm run exp:all && diff -r /tmp/pass1 out/experiments     # vacío
\`\`\`

Verificado así para \`exp:all\`, \`exp:conflict-rule\`, \`exp:conflict-floor\` y
\`exp:hindcast\`. La serialización es canónica (claves ordenadas, 12 cifras
significativas, sin reloj), que es lo que lo hace posible.

---

## 5 · Integridad

\`SHA256SUMS.txt\` (raíz del zip) lleva el SHA-256 de **cada fichero** del
artefacto, con rutas relativas y ordenadas. Para comprobarlo tras extraer:

\`\`\`bash
sha256sum -c SHA256SUMS.txt      # GNU coreutils
\`\`\`

\`SHA256SUMS.txt\` no se lista a sí mismo. Los ficheros llevan la mtime del
commit empaquetado, de modo que dos empaquetados del mismo commit dan los mismos
hashes por fichero. El SHA-256 del **zip entero** puede variar según la
herramienta de compresión del sistema; el manifiesto por fichero es la
comprobación estable.

---

## 6 · Qué NO está en este zip

| Excluido | Por qué |
|---|---|
| \`papers/\` | El paper se publica aparte en el mismo registro. \`papers/AURA_v2.pdf\` es el documento interno de fundamentos y referencia del código, no del artefacto. |
| \`.github/\` | CI de GitHub; no hace falta para ejecutar nada localmente. |
| \`node_modules/\`, \`out/\`, \`dist/\`, \`.git/\` | Se regeneran (\`npm ci\`, los comandos de arriba) o no pertenecen al artefacto. |

Las limitaciones conocidas del motor —lo que **no** demuestra— están en
\`CHANGELOG.md\` («Known limitations») y en \`docs/ERRATA.md\`, que sí viajan aquí.
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Programa
// ─────────────────────────────────────────────────────────────────────────────

function main(): void {
  const started = Date.now();

  // ── 1. El árbol debe estar limpio ──────────────────────────────────────────
  const status = git('status', '--porcelain').trim();
  if (status !== '') {
    fail(
      `el árbol de trabajo NO está limpio. El artefacto se construye desde ` +
        `\`git archive HEAD\`, de modo que empaquetar ahora produciría un zip que no ` +
        `corresponde a ningún commit.\n\n${status}\n\n` +
        `Commitea o descarta los cambios y vuelve a ejecutar.`
    );
  }

  const pkg = JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8')) as {
    version: string;
  };
  const version = pkg.version;
  const commit = git('rev-parse', 'HEAD').trim();
  const commitIso = git('show', '-s', '--format=%cI', 'HEAD').trim();
  const commitEpoch = Number(git('show', '-s', '--format=%ct', 'HEAD').trim());

  log(`versión ${version} · commit ${commit.slice(0, 12)} · árbol limpio`);

  const zipName = `aura-verification-artifact-${version}.zip`;
  const distDir = path.join(REPO, 'dist');
  const zipPath = path.join(distDir, zipName);

  const staging = mkdtempSync(path.join(os.tmpdir(), 'aura-pkg-'));
  const content = path.join(staging, 'content');
  mkdirSync(content, { recursive: true });

  try {
    // ── 2. Contenido: git archive HEAD, menos las exclusiones ────────────────
    const tarPath = path.join(staging, 'head.tar');
    git(
      'archive',
      '--format=tar',
      '-o',
      tarPath,
      'HEAD',
      '--',
      '.',
      ...EXCLUDED.map((p) => `:(exclude)${p}`)
    );
    execFileSync('tar', ['-xf', tarPath, '-C', content]);
    log(`git archive extraído (${walk(content).length} ficheros tras excluir ${EXCLUDED.join(', ')})`);

    for (const excluded of EXCLUDED) {
      if (existsSync(path.join(content, excluded))) {
        fail(`la exclusión de '${excluded}' no se aplicó: sigue en el contenido.`);
      }
    }

    // ── 3. VERIFYING.md ──────────────────────────────────────────────────────
    const verifyingPath = path.join(content, 'VERIFYING.md');
    writeFileSync(verifyingPath, verifyingDoc(version, commit, commitIso), 'utf8');

    // ── 4. SHA256SUMS.txt ────────────────────────────────────────────────────
    const sumsPath = path.join(content, 'SHA256SUMS.txt');
    const files = walk(content).filter((f) => f !== 'SHA256SUMS.txt');
    const header =
      `# AURA v${version} — artefacto de verificación\n` +
      `# commit ${commit}\n` +
      `# SHA-256 de cada fichero del zip, salvo este propio fichero.\n` +
      `# Comprobar con:  sha256sum -c SHA256SUMS.txt\n`;
    writeFileSync(
      sumsPath,
      header + files.map((f) => `${sha256(path.join(content, f))}  ${f}`).join('\n') + '\n',
      'utf8'
    );
    log(`SHA256SUMS.txt con ${files.length} ficheros`);

    // Sellar los dos generados con la fecha del commit: mismo commit ⇒ mismo
    // contenido, y `SHA256SUMS.txt` comparable entre empaquetados.
    for (const f of [verifyingPath, sumsPath]) utimesSync(f, commitEpoch, commitEpoch);

    // ── 5. Zip ───────────────────────────────────────────────────────────────
    mkdirSync(distDir, { recursive: true });
    const tool = makeZip(content, zipPath);
    log(`zip creado con ${tool}`);

    // ── 6. VALIDACIÓN AUTOSUFICIENTE, fuera del repositorio ──────────────────
    const sandbox = mkdtempSync(path.join(os.tmpdir(), 'aura-validate-'));
    log(`validando en ${sandbox} (fuera del repositorio)`);
    extractZip(zipPath, sandbox);

    // El manifiesto debe describir lo que realmente hay dentro.
    const extracted = walk(sandbox).filter((f) => f !== 'SHA256SUMS.txt');
    const manifest = new Map(
      readFileSync(path.join(sandbox, 'SHA256SUMS.txt'), 'utf8')
        .split('\n')
        .filter((l) => l && !l.startsWith('#'))
        .map((l) => {
          const [h, ...rest] = l.split('  ');
          return [rest.join('  '), h] as const;
        })
    );
    const mismatches: string[] = [];
    for (const f of extracted) {
      const expected = manifest.get(f);
      if (expected === undefined) mismatches.push(`${f}: no está en el manifiesto`);
      else if (expected !== sha256(path.join(sandbox, f))) mismatches.push(`${f}: hash distinto`);
    }
    for (const f of manifest.keys()) {
      if (!extracted.includes(f)) mismatches.push(`${f}: en el manifiesto pero no en el zip`);
    }
    if (mismatches.length > 0) {
      rmSync(zipPath, { force: true });
      fail(`SHA256SUMS.txt no describe el contenido del zip:\n  ${mismatches.join('\n  ')}`);
    }
    log(`manifiesto verificado: ${extracted.length} ficheros, todos con su hash`);

    const steps: { name: string; ms: number }[] = [];
    for (const [name, args] of [
      ['npm ci', ['ci']],
      ['npm run verify', ['run', 'verify']],
    ] as const) {
      log(`ejecutando '${name}' en el sandbox…`);
      const t0 = Date.now();
      const r = spawnSync('npm', [...args], {
        cwd: sandbox,
        stdio: 'inherit',
        shell: true,
        // Entorno limpio de cualquier rastro del repositorio.
        env: { ...process.env, INIT_CWD: sandbox, npm_config_prefix: undefined },
      });
      const ms = Date.now() - t0;
      steps.push({ name, ms });
      if (r.status !== 0) {
        rmSync(zipPath, { force: true });
        fail(
          `la validación autosuficiente FALLÓ en '${name}' (código ${r.status}) tras ` +
            `${seconds(ms)}.\nEl zip NO se ha dejado en dist/. Sandbox conservado para ` +
            `diagnóstico: ${sandbox}`
        );
      }
      log(`'${name}' OK — ${seconds(ms)}`);
    }

    rmSync(sandbox, { recursive: true, force: true });

    // ── 7. Resumen ───────────────────────────────────────────────────────────
    const size = statSync(zipPath).size;
    const digest = sha256(zipPath);

    process.stdout.write('\n──── artefacto de verificación listo\n\n');
    process.stdout.write(`  ruta      ${zipPath}\n`);
    process.stdout.write(`  tamaño    ${humanSize(size)} (${size} bytes)\n`);
    process.stdout.write(`  ficheros  ${extracted.length + 1} (incluido SHA256SUMS.txt)\n`);
    process.stdout.write(`  commit    ${commit}\n`);
    process.stdout.write(`  SHA-256   ${digest}\n\n`);
    process.stdout.write('  validación autosuficiente (extraído fuera del repositorio):\n');
    process.stdout.write(`    manifiesto SHA-256   ${extracted.length} ficheros, 0 divergencias\n`);
    for (const s of steps) {
      process.stdout.write(`    ${s.name.padEnd(20)} OK — ${seconds(s.ms)}\n`);
    }
    process.stdout.write(`\n  total ${seconds(Date.now() - started)}\n\n`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

main();
