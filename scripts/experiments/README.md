# Experimentos

Contrato de todo experimento de AURA. Si un número va a aparecer en el paper,
sale de aquí o de `npm run repro` — de ningún otro sitio.

## Por qué hay un contrato

Un experimento que no se puede repetir no es evidencia. Los tres fallos que este
runner cierra por construcción:

1. **Semilla implícita.** Un experimento que elige su propia semilla produce un
   número que nadie —ni su autor, seis meses después— puede regenerar.
   `runner.ts` **lanza** si falta `--seed`. No hay valor por defecto a propósito.
2. **Aleatoriedad no sembrada.** `Math.random()` no admite semilla. El runner
   entrega un PRNG ya sembrado (`ctx.rng`) y ningún experimento debe usar otro.
   Es literalmente el mismo generador que usan las properties
   (`src/lib/prng.ts`, reexportado por `__tests__/properties/_config.ts`): la
   semilla 20260804 significa lo mismo en los dos sitios.
3. **Salida en cualquier parte.** Sin convención, auditar un experimento exige
   leer su código para saber dónde escribió. Aquí siempre son los mismos tres
   ficheros en el mismo sitio.

## Cómo se escribe uno

```ts
// scripts/experiments/mi-experimento.ts
import { ExperimentContext, ExperimentOutput, main } from './runner';

function run(ctx: ExperimentContext): ExperimentOutput {
  const n = ctx.flags.number('samples', 1000);   // --samples 5000
  // ... usar SOLO ctx.rng como fuente de aleatoriedad ...
  return {
    config: { samples: n },        // parámetros EFECTIVOS, tras los defaults
    results: { /* ... */ },        // → results.json (canónico)
    csvHeader: ['i', 'valor'],
    csvRows: [[0, 1.5]],           // → results.csv
  };
}

main({ name: 'mi-experimento', description: 'Qué mide, en una línea.', run });
```

```bash
npx tsx scripts/experiments/mi-experimento.ts --seed 20260804 --samples 5000
```

`scripts/experiments/smoke.ts` es el ejemplo mínimo completo.

## Convenciones

| Regla | Motivo |
|---|---|
| `--seed` obligatorio, entero positivo | Sin él no hay reproducibilidad |
| Los parámetros del sistema que afecten al resultado van en `config.json` | Un `results.json` que no dice bajo qué regla de conflicto se midió no es auditable |
| Aleatoriedad solo desde `ctx.rng` | Semilla compartida con las properties |
| Sin red, sin reloj, sin estado global | El resultado debe depender solo de (código, semilla, flags) |
| Salida en `out/experiments/<nombre>/` | `config.json` + `results.json` + `results.csv`, siempre |
| `config.json` registra los parámetros **efectivos** | Reproducir no debe exigir adivinar qué defaults regían |
| Serialización canónica (`scripts/lib/canonical.ts`) | Claves ordenadas, 12 cifras significativas → diff legible |
| Nombre en kebab-case | Es el nombre del directorio de salida |

### Artefactos adicionales

`ExperimentOutput.artifacts` mapea *ruta relativa → contenido ya serializado* y
el runner los escribe dentro del directorio del experimento. Es la vía por la
que salen las figuras: un experimento **nunca** abre su propio `writeFile`, o la
convención de salida dejaría de significar nada. El contenido debe ser
determinista (las figuras SVG lo son: ver `scripts/lib/svg.ts`).

### Perfiles `full` y `verify`

Los experimentos de cobertura se ejecutan en dos regímenes con el mismo código y
la misma semilla, seleccionados con `--profile`:

| Perfil | N | Salida | En `snapshots/` |
|---|---|---|---|
| `full` (por defecto) | la campaña citable | `out/experiments/<nombre>/` | no |
| `verify` | 200 mundos | `out/experiments/<nombre>-verify/` | sí |

Los nombres tienen que ser distintos porque `npm run snapshots:check` compara
`out/` **entero**: si los dos regímenes escribieran en el mismo directorio, una
campaña completa dejaría allí un resultado que no coincide con el snapshot
reducido y `verify` fallaría sin que nada estuviera roto. Ver
`scripts/experiments/lib/profile.ts`.

`--rule` y `--measure` siguen exactamente la misma convención por el mismo
motivo: una ejecución con una regla o una medida de conflicto que no son las del
sistema escribe en `out/experiments/<nombre>-c0/` o `<nombre>-d0/` y no puede
pisar el directorio versionado.

## Cuándo entra en `npm run verify`

Un experimento entra en la verificación cuando su salida es **determinista y
barata**: se añade su script a `package.json` y su paso a `scripts/verify.ts`, y
su salida pasa a `snapshots/` con `npm run snapshots:update`. A partir de ahí,
cualquier deriva en sus números aparece como diff en el pull request.

Los experimentos **caros** (campañas Monte Carlo largas, hindcast sobre series
históricas) no entran en `verify`: se lanzan a mano y su resultado se registra en
el README o en `docs/`, citando semilla y flags.

---

# La campaña de cobertura

Cinco experimentos sobre un **mundo sintético con ground truth conocido**, que
es lo que permite medir cobertura: la verdad se sortea primero y las mediciones
se derivan de ella, de modo que «el intervalo contiene P*» tiene respuesta
exacta.

```bash
npm run exp:all           # los tres primeros, semilla canónica 20260804  (~3 s)
npm run exp:coverage      # experimento 1, N = 10.000
npm run exp:h1            # experimento 2, 11 puntos × N = 2.000
npm run exp:virga         # experimento 3, N = 5.000
npm run exp:conflict-rule  # experimento 4, semilla PROPIA 20260311 (pre-registrado)
npm run exp:conflict-floor # experimento 5, semilla PROPIA 20261007 (pre-registrado)
npm run exp:verify         # los tres primeros reducidos a N = 200 (los que ve `verify`)
npm run exp:all:c0         # los tres primeros con la REGLA de conflicto anterior
npm run exp:all:d0         # los tres primeros con la MEDIDA de conflicto anterior
```

Los tres primeros usan la **regla y la medida de conflicto del sistema**;
`--rule` y `--measure` las sustituyen y escriben en su propio directorio
(`out/experiments/coverage-c0/`, `coverage-d0/`…), que es como se regeneran los
números publicados antes de cada capa de `docs/ERRATA.md` §9. Los experimentos 4
y 5 son los pre-registrados que eligieron esa regla y esa medida, y corren con
semillas distintas a propósito.

## El mundo (`lib/world.ts`)

1. **P\*** se sortea de una mezcla de cinco tramos de intensidad —seco [0, 2),
   ligera [2, 15), moderada [15, 30), intensa [30, 60), extrema [60, 120) mm/h—
   con pesos `0,30 / 0,35 / 0,20 / 0,12 / 0,03`, configurables con
   `--band-weights`. El techo de 120 mm/h está muy por debajo del
   `domainBound = 500` del marco: **H0 se cumple en todos los mundos por
   construcción**, y esto es lo que permite leer un fallo de cobertura
   existencial como bug y no como violación de hipótesis.
2. Cada fuente mide `P* + sesgo + N(0, σ_i)`, recortado al marco. Con
   probabilidad **δ_i** la fuente FALLA y devuelve un valor uniforme en
   [0, 500] sin relación con P\*.
3. Con probabilidad `--virga-prob` (0,15) el mundo tiene **conflicto físico tipo
   virga**: γ ~ U(0, 1), un subconjunto propio no vacío de fuentes mide γ·P\* y
   el resto mide P\*. Ninguna miente: miden a alturas distintas.

**σ_i y δ_i salen de `src/data/sources/characterization.ts` sin tocar**, y δ_i
es además la probabilidad REAL de fallo del mundo: AURA opera aquí *bien
especificado*. Lo único DECLARADO por el experimento —y por tanto discutible— es
el sesgo por fuente (`aemet −0,20`, `open-meteo +0,30`, `nasa-power +0,50` mm/h,
escalable con `--bias-scale`), que no existe en `characterization.ts` porque
nadie lo ha calibrado. Ningún método lo conoce; los cuatro lo sufren igual.

## Los cuatro estimadores (`lib/methods.ts`)

| id | qué es | garantía |
|---|---|---|
| `aura-existencial` | intervalo credal continuo, Def. 3.9 / Ec. (10) | **sí** — Lema 6.1 bajo H0-H2 |
| `aura-banda-95` | hull de los focales que acumulan ≥ 95 % de la masa credal | no |
| `media-ponderada` | `w_i ∝ (1−δ_i)`, `x̂ ± 1,96·(Σ w_i²σ_i²)^½` | no |
| `kalman-estatico` | `w_i ∝ σ_i^{−2}`, `x̂ ± 1,96·(Σ σ_i^{−2})^{−½}` | no |

Los dos niveles de AURA se cuentan por separado porque prometen cosas
distintas. El existencial **no** compite con un intervalo al 95 %: promete
contener x\* casi siempre y lo paga en anchura. El comparable es la banda de
evidencia, que tiene el mismo nivel nominal que los baselines y **ninguna
garantía formal detrás**. Los baselines ignoran el conflicto por diseño: eso es
lo que se mide, no un hombre de paja.

---

## Experimento 1 — cobertura y anchura globales

`coverage.ts` · N = 10.000 · semilla 20260804 · figuras f1, f2.

> **Los números de esta sección son los de la regla C1 con la medida D2**, las
> seleccionadas por los dos experimentos pre-registrados de `docs/ERRATA.md` §9
> (experimentos 4 y 5 de este fichero). Los publicados bajo la regla anterior se
> regeneran con `npm run exp:all:c0` y los publicados bajo la medida anterior
> con `npm run exp:all:d0`; las comparaciones completas están en §9.

| método | condición | n | cobertura | IC Wilson 95 % | anchura media | mediana |
|---|---|---:|---:|---|---:|---:|
| `aura-existencial` | global | 10.000 | **100,00 %** | [99,96 · 100,00] | 500,00 | 500,00 |
| | sin fallo | 7.258 | 100,00 % | [99,95 · 100,00] | 500,00 | 500,00 |
| | fallo δ | 1.495 | 100,00 % | [99,74 · 100,00] | 500,00 | 500,00 |
| | virga | 1.247 | 100,00 % | [99,69 · 100,00] | 500,00 | 500,00 |
| `aura-banda-95` | global | 10.000 | **99,72 %** | [99,60 · 99,81] | 250,18 | 30,00 |
| | sin fallo | 7.258 | 99,75 % | [99,61 · 99,84] | 191,25 | 15,00 |
| | fallo δ | 1.495 | 99,87 % | [99,51 · 99,96] | 492,02 | 500,00 |
| | virga | 1.247 | 99,36 % | [98,74 · 99,67] | 303,22 | 500,00 |
| `media-ponderada` | global | 10.000 | **76,20 %** | [75,36 · 77,02] | 4,60 | 4,60 |
| | sin fallo | 7.258 | 94,81 % | [94,27 · 95,29] | 4,60 | 4,60 |
| | fallo δ | 1.495 | **2,01 %** | [1,41 · 2,85] | 4,60 | 4,60 |
| | virga | 1.247 | 56,86 % | [54,09 · 59,58] | 4,60 | 4,60 |
| `kalman-estatico` | global | 10.000 | **76,68 %** | [75,84 · 77,50] | 4,24 | 4,24 |
| | sin fallo | 7.258 | 95,34 % | [94,83 · 95,80] | 4,24 | 4,24 |
| | fallo δ | 1.495 | **2,34 %** | [1,69 · 3,24] | 4,24 | 4,24 |
| | virga | 1.247 | 57,18 % | [54,41 · 59,90] | 4,24 | 4,24 |

Por tramo de intensidad (cobertura), los baselines caen de 82 % en *seco* a
69 % en *extrema*; el nivel existencial de AURA se mantiene en 100 % en los cinco
tramos, y la banda solo baja en los dos intermedios (99,37 % en *ligera* y
99,71 % en *moderada*). Tabla completa en `results.csv`.

**Lo que dicen estos números.**

- Los baselines están **correctamente calibrados cuando su modelo se cumple**:
  94,8 % y 95,3 % en mundos sin fallo ni conflicto, contra un 95 % nominal. No
  son estimadores mal implementados; son estimadores cuyo modelo no incluye el
  fallo de fuente.
- Ese modelo se rompe de golpe: con **una sola** fuente caída, la cobertura pasa
  de ~95 % a ~2 %. El intervalo no se entera: su anchura es constante (4,60 y
  4,24 mm/h en todos los estratos), porque δ_i entra en el peso y no en la
  varianza. Es el fallo silencioso completo.
- El nivel existencial de AURA cubre el 100 % de los 10.000 mundos y mide
  siempre 500 mm/h: el marco entero. **Ese es su contenido informativo, y es
  poco**. La cifra que hay que citar junto a la cobertura es la anchura.
- La banda de evidencia al 95 % da 99,72 % de cobertura con 250 mm/h de anchura
  media pero **15 mm/h de mediana en mundos limpios**: la media está dominada
  por la cola de mundos en que la fusión escala a envolvente (ver abajo). Esa
  mediana se ha reducido a la mitad con la medida D2 —era 30 mm/h con D0—, que
  es el efecto directo de descontar el suelo de discretización.

## Experimento 2 — degradación bajo violación de H1

`h1-violation.ts` · 11 puntos × N = 2.000 · figura f3.

Barrido de la fracción de mundos en que **las tres fuentes fallan a la vez**
(violación directa de H1 del Teorema 6.1). Cobertura sobre todos los mundos del
punto:

| violación | `aura-existencial` | `aura-banda-95` | `media-ponderada` | `kalman-estatico` |
|---:|---:|---:|---:|---:|
| 0 % | 100,00 % | 99,75 % | 80,35 % | 80,35 % |
| 25 % | 100,00 % | 84,00 % | 61,55 % | 61,80 % |
| 50 % | 100,00 % | 67,60 % | 39,80 % | 39,90 % |

Desglosado por si el mundo estaba violado o no (al 50 %):

| método | mundos violados | mundos intactos |
|---|---:|---:|
| `aura-existencial` | 100,00 % | 100,00 % |
| `aura-banda-95` | 37,27 % | 99,49 % |
| `media-ponderada` | 0,00 % | 81,64 % |
| `kalman-estatico` | 0,10 % | 81,74 % |

**La predicción teórica se cumple a medias, y la mitad que falla lo hace a
favor de AURA.**

- *«AURA-existencial degrada solo en los mundos violados, cobertura ≈ 1 −
  fracción»*: **falso, y por un motivo instructivo**. No degrada en absoluto:
  100 % también DENTRO de los mundos violados. La causa es la válvula de
  seguridad δ_i de la Def. 3.4: la masa sobre Θ sobrevive a la fusión, mantiene
  Pl > 0 sobre todas las hipótesis y el lifting de la Ec. (10) devuelve el marco
  completo pase lo que pase con la evidencia. El nivel existencial es inmune a
  la violación de H1 **porque es vacuo**, no porque la resista. Es la
  formulación empírica más nítida de la tesis de `docs/ERRATA.md` §8.
- La estructura predicha sí aparece, pero en el nivel informativo: la banda de
  evidencia mantiene **99,5-100 % en los mundos intactos en los once puntos** y
  cae a ~34 % dentro de los violados. Degrada exactamente donde la hipótesis se
  rompe y en ningún otro sitio.
- *«los baselines degradan también fuera de los mundos violados»*: **no en
  función de la fracción**. Su cobertura restringida a mundos intactos es
  ~80 % y plana en todo el barrido (como debe ser: esos mundos se sortean
  igual en todos los puntos). Pero ese 80 % ya está contaminado —contra el 95 %
  nominal— por los fallos δ_i **independientes**, que es el mismo mecanismo que
  el enunciado nombra, actuando antes de que el barrido empiece.

## Experimento 3 — el caso virga cuantificado (Ejemplo 3.1)

`virga.ts` · N = 5.000 mundos solo-virga, γ ~ U(0, 1).

Métrica: fracción de mundos en que el intervalo **no contiene ni P\* ni γ·P\***
— el fallo que §3.4 atribuye a la media («no representa ni lo que ocurre arriba
ni lo que ocurre abajo»). Es simétrica a propósito: en un mundo de virga hay dos
verdades y elegir una decidiría el resultado antes de medirlo.

| método | ni P\* ni γ·P\* (todos) | IC Wilson | ni P\* ni γ·P\* (sin fallo δ) | cob. P\* | cob. γ·P\* | anchura |
|---|---:|---|---:|---:|---:|---:|
| `aura-existencial` | **0,00 %** | [0,00 · 0,08] | 0,00 % | 100,0 % | 100,0 % | 500,00 |
| `aura-banda-95` | **0,06 %** | [0,02 · 0,18] | 0,05 % | 99,6 % | 99,2 % | 330,60 |
| `media-ponderada` | **43,12 %** | [41,75 · 44,50] | 33,71 % | 49,9 % | 44,4 % | 4,60 |
| `kalman-estatico` | **41,58 %** | [40,22 · 42,95] | 32,04 % | 49,2 % | 46,0 % | 4,24 |

La afirmación del paper queda cuantificada: **uno de cada tres mundos de virga
pura** (y uno de cada 2,3 contando fallos δ) produce una media que no representa
ninguna de las dos realidades físicas.

Por tramo de γ, la métrica es monótona en el conflicto, y la estrategia de
fusión de AURA lo sigue:

| γ | n | `media-ponderada` | `kalman-estatico` | fusión AURA (D / C / E) |
|---|---:|---:|---:|---|
| 0,0-0,1 | 506 | 58,9 % | 57,7 % | 25 % / 13 % / **62 %** |
| 0,2-0,3 | 516 | 57,0 % | 54,1 % | 23 % / 14 % / **64 %** |
| 0,4-0,5 | 497 | 45,3 % | 44,1 % | 33 % / 22 % / 45 % |
| 0,6-0,7 | 498 | 37,3 % | 37,1 % | 31 % / 31 % / 37 % |
| 0,8-0,9 | 490 | 24,3 % | 23,9 % | 46 % / 32 % / 22 % |
| 0,9-1,0 | 476 | 19,7 % | 18,3 % | 47 % / 32 % / 21 % |

Reparto global de estrategias (Def. 3.6 con la regla C1 y la medida D2):
**dempster 35,24 % · cautelosa 20,16 % · envolvente 44,60 %**.

## Experimento 4 — qué magnitud decide la Definición 3.6

`conflict-rule.ts` · N = 10.000 + 5.000 virga · **semilla 20260311**.

Es el experimento **pre-registrado** que corrigió `docs/ERRATA.md` §9. Se
ejecuta con una semilla distinta de la canónica a propósito: la regla que sale
de aquí no debe quedar ajustada a la realización del PRNG con la que después se
publican los números de los experimentos 1-3.

```bash
npm run exp:conflict-rule
```

Corre los cuatro candidatos —C0 (la regla anterior), C1, C2 y C3, definidos en
`src/core/dempster-shafer/conflict-rules.ts`— sobre **los mismos** 15.000
mundos, comprueba el requisito innegociable ANTES de comparar nada y aplica el
criterio de selección de `lib/selection.ts`, que está escrito antes de la
ejecución y probado aparte de las cifras que consume.

| candidato | requisito | cob. existencial | cob. banda-95 | limpios → Dempster | anchura banda-95 |
|---|---|---:|---:|---:|---:|
| C0 | ✅ | 100,00 % | 99,910 % | 53,49 % | 296,99 mm/h |
| **C1** *(seleccionado)* | ✅ | 100,00 % | 99,840 % | **57,62 %** | **280,67 mm/h** |
| C2 | ✅ | 100,00 % | 99,840 % | **57,62 %** | **280,67 mm/h** |
| C3 | ✅ | 100,00 % | 99,840 % | **57,62 %** | **280,67 mm/h** |

Ninguno fue descalificado; C1, C2 y C3 eligen la misma estrategia en los 15.000
mundos y decide el paso 5 del criterio (simplicidad). El razonamiento completo,
las identidades que lo sostienen y lo que se paga por la corrección están en
[`docs/ERRATA.md`](../../docs/ERRATA.md) §9, Capa 1.

---

## Experimento 5 — con qué se puntúa el desacuerdo de un par

`conflict-floor.ts` · N = 10.000 + 5.000 virga + 5.000 «σ del hindcast» ·
**semilla 20261007**.

El segundo experimento **pre-registrado**, y el que corrigió el suelo estructural
que el hindcast midió (ver más abajo). El experimento 4 decidió *qué magnitud* se
compara con κ₁/κ₂; éste decide *con qué se puntúa un par*, que es un eje
ortogonal.

```bash
npm run exp:conflict-floor
```

> ### ⚠ Aviso de honestidad: esto NO se validó con el hindcast
>
> **Los resultados del hindcast ya eran conocidos** cuando se diseñó este
> experimento — están ejecutados, commiteados y descritos en este mismo fichero,
> y es de ahí de donde sale el problema. Elegir la medida mirándolos sería
> retro-ajuste. Por eso:
>
> - la selección se hizo **exclusivamente sobre mundos sintéticos con ground
>   truth**;
> - el bloque «σ del hindcast» usa **solo las σ y δ declaradas a priori** (5,0 /
>   1,8 / 10,0 mm/h, δ = 0,02) sobre mundos sintéticos **nuevos**, generados con
>   la semilla de este experimento — no lee ni un byte de `fixtures/hindcast/`;
> - el hindcast se re-ejecutó **después y solo como descripción**. No es una
>   validación ciega, y así consta en su `results.json`.

Corre las tres candidatas —D0 (el K crudo, la medida anterior), D1 (exceso
normalizado sobre el suelo) y D2 (distancia de Jousselme), definidas en
`src/core/dempster-shafer/conflict-measures.ts`— sobre **los mismos** 20.000
mundos, con la regla C1 fija en las tres, y aplica el criterio de siete pasos de
`lib/floor-selection.ts`.

| candidata | requisito | banda-95 | virga ni-ni | σ-hindcast → Dempster | limpios → Dempster | anchura |
|---|---|---:|---:|---:|---:|---:|
| D0 | ✅ | 99,870 % | 0,000 % | 9,90 % | 58,97 % | 280,66 mm/h |
| D1 | ✅ | **99,480 %** ❌ paso 2 | 0,080 % | *(100,00 %)* | *(81,00 %)* | *(197,49)* |
| **D2** *(seleccionada)* | ✅ | 99,720 % | 0,000 % | **59,66 %** | 65,98 % | 254,32 mm/h |

**D1 quedó descalificada en el paso 2** —cobertura de banda-95 por debajo del
piso pre-registrado del 99,5 %— pese a ser la que mejor resuelve el problema
declarado: anula el suelo de forma exacta y lleva el 100 % de los mundos
concordantes a Dempster. El criterio **no se relajó**, y D2 ganó el paso 4 en
solitario. Detalle completo, lo que se paga y las propiedades demostradas de cada
medida en [`docs/ERRATA.md`](../../docs/ERRATA.md) §9, Capa 3.

---

## Hallazgo colateral, y su corrección: los fixtures son más concordantes que el ruido real

Reparto de estrategias de fusión en el experimento 1 (`results.json`,
`fusionByCondition`), en las tres configuraciones por las que ha pasado el
sistema (`npm run exp:all:c0` y `npm run exp:all:d0` regeneran las dos primeras):

| condición | n | C0+D0 *(original)* | C1+D0 *(tras el exp. 4)* | **C1+D2 *(vigente)*** |
|---|---:|---|---|---|
| global | 10.000 | 44,1 / 24,9 / 31,0 % | 47,9 / 30,1 / 22,0 % | **53,5 / 23,6 / 22,9 %** |
| **sin fallo ni virga** | 7.258 | 54,1 / 30,3 / **15,6 %** | 58,8 / 36,6 / 4,6 % | **65,9 / 28,4 / 5,8 %** |
| fallo δ | 1.495 | 3,9 / 1,1 / 95,1 % | 3,9 / 1,7 / 94,4 % | 3,9 / 1,5 / 94,6 % |
| virga | 1.247 | 34,2 / 21,8 / 43,9 % | 37,4 / 26,2 / 36,4 % | 40,7 / 22,5 / 36,8 % |

**El hallazgo original.** Con C0, en casi la mitad de los mundos donde no pasa
nada —ni fallo de fuente ni conflicto físico— el sistema ya no aplicaba la regla
de Dempster, y el 15,6 % escalaba a envolvente. Los cuatro escenarios de
`fixtures/` dan K_global = 0,027 / 0,184 / 0,951 / 3,3e-9, es decir dempster en
tres de cuatro, y sugerían lo contrario.

La diferencia no era un error de ninguno de los dos: los fixtures fijan
mediciones que concuerdan dentro de ±0,75 mm/h, mientras que tres fuentes con
σ = 1,5 / 2,0 / 2,5 mm/h midiendo la MISMA verdad se separan típicamente varios
mm/h, y sobre un marco de cinco hipótesis anchas eso basta para que sus soportes
dejen de solaparse. K_global crece muy deprisa con la dispersión porque es
`1 − Σ_j Π_i m_i(θ_j)` salvo los términos de Θ: sin una hipótesis en la que las
tres fuentes concentren masa a la vez, el conflicto n-ario es alto **aunque no
haya ningún desacuerdo físico**.

**Qué se hizo con él, en dos pasos.** La segunda mitad de ese diagnóstico —que la
magnitud comparada no distingue conflicto de dispersión de discretización— se
corrigió por partes:

- el **experimento 4** atacó la *aridad*: la regla C1 devuelve κ₁/κ₂ a la escala
  del par para la que fueron elegidos y deja a K_global haciendo solo de guardia.
  La envolvente en mundos limpios cae del 15,6 % al 4,6 %;
- el **experimento 5** atacó la *escala del propio par*: la medida D2 descuenta
  el suelo que la heterogeneidad de σ produce sin desacuerdo alguno. Dempster en
  mundos limpios sube del 58,8 % al **65,9 %**, y la mediana de la banda en esos
  mundos baja de 30 a **15 mm/h** (media: de 225 a 191).

**Lo que NO cambia.** La primera mitad sigue en pie: los cuatro fixtures son más
concordantes que el ruido instrumental declarado de las propias fuentes, y no
deben leerse como el caso medio. Con la configuración vigente el sistema todavía
abandona la regla de Dempster en el **34 %** de los mundos limpios (28,4 %
cautelosa + 5,8 % envolvente), frente a la impresión de «tres de cuatro a
Dempster» que dan los fixtures. La brecha se ha estrechado; no ha desaparecido.

---

# El hindcast sobre dos eventos reales

`hindcast.ts` · E1 = 96 h · E2 = 168 h · figuras f1-f4 · **sin aleatoriedad**.

```bash
npm run hindcast:capture      # UNA VEZ: descarga y versiona fixtures/hindcast/
npm run exp:hindcast          # los dos eventos            (~1,5 s)
npm run exp:hindcast:e1       # DANA de Valencia, 28-31 oct 2024
npm run exp:hindcast:e2       # Filomena, Madrid, 6-12 ene 2021
npm run exp:hindcast:verify   # 24 h del pico de E1, lo que ve `verify`
```

> ### ⚠ EJERCICIO ILUSTRATIVO, NO VALIDACIÓN OPERATIVA
>
> Enseña **el comportamiento del pipeline** cuando la entrada deja de ser un
> mundo sintético: cuánto conflicto ve entre tres reanálisis, qué estrategia de
> fusión elige, cómo se mueve el conjunto credal y qué dicen los dos niveles del
> certificado. **No** enseña que AURA «habría evitado» ni «habría predicho»
> nada, y ninguna cifra de esta sección puede redactarse así. Tres razones
> independientes, cada una suficiente:
>
> 1. **No hay ground truth.** Los tres productos son mallas de reanálisis, no el
>    valor en el punto. Sin verdad no hay acierto que medir — para eso está la
>    campaña de mundos sintéticos de arriba.
> 2. **El DAG es el de juguete de la demo** (Ec. 34): acumulación menos un
>    drenaje constante, con parámetros declarados. No es la hidrología de ninguna
>    cuenca real.
> 3. **Las fuentes no son independientes** (H3): las tres asimilan el mismo pool
>    de observaciones globales.

## Los datos

| fuente | producto | resolución | licencia | en el pipeline |
|---|---|---|---|---|
| `era5` | ERA5, Open-Meteo Archive | 0,25° ≈ **25 km** | CC BY 4.0 | sí |
| `ecmwf-ifs` | análisis operativo IFS, Open-Meteo Archive | ≈ **9 km** | CC BY 4.0 | sí |
| `nasa-power` | MERRA-2, POWER horario | 0,5°×0,625° ≈ **50 km** | dominio público | sí |
| `era5-land` | ERA5-Land, Open-Meteo Archive | 0,1° ≈ 9 km | CC BY 4.0 | **no** — ver abajo |

**Dos cosas que la captura descubrió, y las dos están en el manifest.**

*ERA5-Land no sirve precipitación.* Era la segunda fuente prevista. Open-Meteo la
expone en su Archive API, pero devuelve `null` en las 96 + 168 horas de los dos
eventos, y también para `rain` y `snowfall`; solo la temperatura tiene datos. El
fichero se versiona igualmente para que la ausencia sea verificable sin volver a
la red. Su sustituto es el **análisis operativo del IFS**: misma clase de
resolución (~9 km) y producto genuinamente distinto de ERA5, que es lo que la
segunda fuente debía aportar.

*`PRECTOTCORR` horario de POWER está en mm/day, no en mm/h.* La captura no se fía
del comentario: descarga también el endpoint **diario** de la misma ventana y
comprueba día a día que la **media** de las 24 horas coincide con el valor diario
(21,864 frente a 21,86 el 29 de octubre). La razón suma/diario vale 24,00 en los
cuatro días. Si la comprobación fallara, la captura **aborta**.

*AEMET queda fuera* porque su OpenData exige API key, y un experimento que
dependa de una credencial no lo puede reproducir quien no la tenga. La
consecuencia está asumida: **sin AEMET no hay ninguna fuente de observación
directa**, las tres son productos de asimilación, y por eso (a) se esperaba
conflicto bajo, (b) H3 no se cumple en sentido estricto y (c) **el caso virga no
puede reproducirse aquí** — su conflicto es vertical, entre sensores a alturas
distintas, y tres reanálisis estiman la misma magnitud en la misma celda.

## La caracterización, declarada **antes** de ejecutar nada

`src/data/sources/hindcast-characterization.ts`, commiteada en su propio commit
antes de correr el pipeline sobre un solo dato, y pineada por
`__tests__/data/hindcast-characterization.test.ts`. Dos reglas cerradas y **un
único parámetro por fuente**, el lado de celda:

| fuente | L | σ_P = 2,0·(L/10) | σ_T = 1,0·√(L/10) | δ |
|---|---:|---:|---:|---:|
| `ecmwf-ifs` | 9 km | **1,8** mm/h | 0,95 °C | 0,02 |
| `era5` | 25 km | **5,0** mm/h | 1,58 °C | 0,02 |
| `nasa-power` | 50 km | **10,0** mm/h | 2,24 °C | 0,02 |

σ_P **lineal** en L porque la precipitación es un campo intermitente y convectivo
—al duplicar el lado, el núcleo se diluye en cuatro veces más área—; σ_T en **√L**
porque la temperatura sí es suave y su error dominante al bajar de resolución es
orográfico. δ **iguales y no nulas**: no hay histórico de fallos por producto con
que ordenarlas, y δ = 0 afirmaría que un reanálisis no puede errar la celda ni el
tipo de precipitación. No hay ningún número escrito a mano por fuente, luego no
existe el grado de libertad con que afinar una a la vista de su serie.

**Regla dura: si los resultados sugieren que la caracterización es mala, se
REPORTA, no se retoca.** Se ha reportado; ver el hallazgo de abajo.

## Resultados

| | **E1 · DANA Valencia** | **E2 · Filomena Madrid** |
|---|---|---|
| ventana | 28-31 oct 2024, 96 h | 6-12 ene 2021, 168 h |
| punto | 39,42 N · −0,72 E | 40,472 N · −3,683 E |
| horas excluidas por huecos | **0** | **0** |
| pico de las fuentes (media) | 7,49 mm/h @ 29T17:00Z | 1,80 mm/h @ 08T22:00Z |
| K_máx **crudo** mediana / p95 / máx | 0,371 / 0,707 / **0,941** | 0,365 / 0,421 / **0,441** |
| d_J (medida vigente) mediana / p95 / máx | 0,276 / 0,681 / **0,830** | 0,273 / 0,285 / **0,308** |
| K_global mediana / máx | 0,423 / 0,983 | 0,412 / 0,543 |
| fusión D / C / E *(medida vigente D2)* | **76,0 % / 21,9 % / 2,1 %** | **99,4 % / 0,6 % / 0 %** |
| *(con la medida anterior D0)* | *0 % / 93,8 % / 6,3 %* | *0 % / 100 % / 0 %* |
| guardia κ_deg | 1 h | 0 h |
| plUpper máximo | **0,963** | **0,0492** *(era 0,0505)* |
| horas critical / warning / safe | 19 / 77 / 0 | **0 / 168 / 0** *(eran 2 / 166 / 0)* |
| anchura banda 95 % (mín/media/máx) | 15 / 47,3 / 500 mm/h | 15 / 15,2 / 30 mm/h |
| T < 0 °C en las tres fuentes | 0 h | **90 h (53,6 %)**, mín −12,03 °C |

### E1 — ¿cuándo escala, qué método domina, qué dicen los baselines?

**El escalado.** `plUpper` cruza p_crít = 0,05 ya en la **primera hora evaluada**
(28T00:00Z, plUpper = 0,0559), 41 h antes del pico de precipitación de las
fuentes. Ese «41 h antes» es una **cota inferior y un artefacto del recorte
temporal**, no una medida: el cruce pudo ocurrir antes de que empezara la ventana
capturada. `results.json` lo marca con `firstCriticalAtWindowStart: true`
precisamente para que no se lea como anticipación. Las 19 horas `critical` caen
en **cuatro bloques** —28T00-04 (5 h), 29T07-14 (8 h), 29T16-17 (2 h) y 29T19-22
(4 h)—, **los mismos con las dos medidas de conflicto**, y siguen a la lluvia: su
precipitación media es 4,09 mm/h frente a 0,37 mm/h en las 77 horas restantes. En
el pico, plUpper = 0,963, el máximo del evento.

**El método durante el pico.** La hora del pico es el caso extremo: ERA5 2,9 ·
IFS 18,2 · POWER 1,35 mm/h, K_máx = 0,941, d_J = 0,830, K_global = 0,983 → **la
guardia de degeneración se dispara** y fuerza la envolvente. Es la única hora de
los dos eventos en que lo hace. Con la medida corregida, Dempster se aplica en el
76 % de las horas del evento —con D0 no se aplicaba nunca, ver el hallazgo— y la
envolvente queda en 2 horas de 96, las dos de mayor desacuerdo real.

**Los baselines.** No señalan nada distinto de su intervalo fijo, y eso es
literal: su anchura toma **un solo valor distinto** en las 96 horas —14,80 mm/h
la media ponderada, 6,55 mm/h el Kalman— porque depende solo de σ y δ, nunca de
la evidencia. Lo único que se mueve es el centro. El precio se ve en el pico: el
intervalo del Kalman, [12,75 · 19,30], **deja fuera a dos de las tres fuentes que
dice resumir** (ERA5 con 2,9 y POWER con 1,35 mm/h). En total el Kalman excluye a
alguna fuente en **15 de las 96 horas**; la media ponderada, en 1. La banda de
AURA, en la misma hora, es [0, 500]: no resume, declara que no puede resumir.

### E2 — el mismo pipeline sobre un evento que su DAG no modela

> **CAVEAT OBLIGATORIO.** La precipitación de Filomena fue mayoritariamente
> **nieve**, con T < 0 °C sostenida (53,6 % de las horas por debajo de cero en las
> tres fuentes a la vez, mínimo −12,03 °C). El DAG de la demo acumula **lluvia**
> y resta un drenaje constante; ese mecanismo no existió. La precipitación se
> acumuló como manto nival y se liberó días después, en la fusión, con una
> dinámica que el DAG no representa en absoluto. **Todo h, plUpper y decisión de
> E2 describe lo que el pipeline diría si aquello hubiera sido lluvia.**

Con eso dicho, lo que el pipeline **dice** es informativo por lo que revela del
sistema. Con la medida vigente **no escala a `critical` en ninguna hora**: el
plUpper máximo es 0,0492, justo por debajo de p_crít = 0,05. Frente a las 19
horas y el plUpper de 0,963 de E1, el contraste está bien graduado: menos lluvia,
menos conflicto, menos escalado.

**Y el pipeline no puede saber lo del hielo.** La temperatura se captura, se
reporta y **no entra en el DAG**: la Ec. (34) solo consume precipitación. El
sistema dirá exactamente lo mismo con 18 °C que con −12 °C. Ese silencio es un
límite del **modelo**, no del motor de fusión, y es exactamente el modo de fallo
que §6.3 del paper cita al motivar H2: *hielo bloqueando drenes* es error de
modelo, no incertidumbre de medida, y ningún ε_h lo cubre porque cambia la
ECUACIÓN, no su residuo. E2 es la ilustración empírica de esa frase. Un sistema
desplegado necesitaría, o un DAG con nodo de fase, o una guardia que se niegue a
emitir certificado fuera del régimen declarado.

**Y un detalle que la corrección de la medida convirtió en hallazgo.** Con la
medida anterior (D0), E2 escalaba a `critical` en exactamente 2 horas —08T20:00Z
y 08T21:00Z— que **no eran** las dos de mayor precipitación: la de mayor
precipitación (08T22:00Z) era `warning`. La causa es que plUpper depende de la
ESTRUCTURA de la banda —de cuántos elementos focales tocan la región insegura— y
no de un valor puntual.

Con la medida vigente esas dos horas **dejan de ser críticas**, y se ve por qué:
las tres fuentes medían 1,4 / 2,1 / 1,58 mm/h —**acuerdo**— y el conflicto de
0,436 que las escalaba era suelo de discretización, no desacuerdo. Bajo D0 el
método era la media cautelosa y la banda se abría a [0, 30] mm/h, tocando la
región insegura; bajo D2 van a Dempster, la banda se cierra a [0, 5] y plUpper
cae de 5,04·10⁻² a **1,06·10⁻⁴**, tres órdenes de magnitud. **Las dos horas
`critical` de E2 eran un artefacto del suelo.** Es la consecuencia operativa más
clara de la corrección, y se reporta como descripción: el hindcast ya era
conocido cuando se eligió la medida.

### E1 frente a E2 — el perfil de conflicto

| cuantil de K_máx | E1 | E2 |
|---|---:|---:|
| mín | 0,3653 | 0,3651 |
| p25 | 0,3675 | 0,3651 |
| mediana | 0,3714 | 0,3652 |
| p75 | 0,4418 | 0,3742 |
| p95 | 0,7066 | 0,4207 |
| máx | 0,9413 | 0,4411 |

Los dos eventos comparten **exactamente el mismo suelo** y difieren solo en la
cola. E2 es casi una constante: su rango intercuartílico mide **0,009** (el de E1
es 0,074, ocho veces mayor) y 55 de sus 168 horas —el 32,7 %— son de
precipitación cero en las tres fuentes, con las tres BPAs concentradas en la
hipótesis *nula*. E1 tiene una cola larga —p95 = 0,71, máximo
0,94— que se corresponde una a una con las horas convectivas del 29 de octubre,
en las que el IFS de 9 km ve un núcleo que la celda de 50 km de MERRA-2 promedia
hasta hacerlo desaparecer. **El conflicto que AURA mide en E1 es, sobre todo,
diferencia de resolución**, y era lo esperado antes de ejecutar nada: tres
productos que asimilan las mismas observaciones no se contradicen, se
promedian distinto.

---

## Hallazgo: hay un **suelo estructural de conflicto** que hacía inalcanzable la regla de Dempster

> **Estado: corregido**, con el experimento pre-registrado 5
> (`exp:conflict-floor`) y **sin usar estos datos** en la selección. Lo que sigue
> describe el hallazgo tal como se midió con la medida anterior (D0, el K crudo);
> al final está lo que cambia con la medida vigente.

**Con la medida D0, Dempster no se aplicaba ni una sola vez en las 264 horas de
los dos eventos.** No era un bug: es una consecuencia medible de la
caracterización declarada, y el experimento la computa en vez de dejarla a la
interpretación (`analysis.conflictProfile.structuralFloor`).

Fusionando tres mediciones **idénticas** —acuerdo perfecto, dispersión cero— con
las σ declaradas:

| las tres fuentes miden | K_máx (D0) | K_global | método con D0 | **d_J (D2)** | **método con D2** |
|---:|---:|---:|---|---:|---|
| 0 mm/h | **0,365** | 0,411 | cautelosa | **0,273** | **dempster** |
| 1 mm/h | 0,411 | 0,480 | cautelosa | 0,293 | **dempster** |
| 5 mm/h | 0,561 | 0,779 | cautelosa | 0,153 | **dempster** |
| 10 mm/h | **0,619** | 0,727 | cautelosa | **0,513** | cautelosa |
| 20 mm/h | 0,501 | 0,554 | cautelosa | 0,381 | cautelosa |
| 40 mm/h | **0,189** | 0,196 | **dempster** | 0,165 | **dempster** |

La columna D2 no es monótona, y conviene no leerla como si lo fuera: d_J depende
de **cómo** se reparte la masa entre las hipótesis del marco, no solo de cuánto
solapa. A 5 mm/h las tres BPAs caen a caballo del corte *nula*/*ligera* de forma
parecida y la distancia es baja; a 10 mm/h la fuente fina se concentra en
*ligera* mientras la gruesa se reparte entre tres hipótesis, y sube. El suelo con
acuerdo perfecto **deja de superar κ₁** en el régimen bajo, que es lo que hacía
inalcanzable a Dempster; no desaparece en todo el rango.

El K_máx **mínimo observado** en E1 es 0,3653 y en E2 es 0,3651; el suelo con
lluvia nula es 0,3651. La diferencia en E1 es de 2·10⁻⁴ y en E2 es **exactamente
cero**. Es decir: el conflicto mínimo de los dos eventos **no medía desacuerdo
entre reanálisis, medía discretización**. Con la medida vigente el mínimo de E1
baja a 0,1297 y el de E2 a 0,2510, los dos por debajo del suelo de referencia de
0,2727: d_J no está acotada inferiormente por él, porque no es un residuo que se
reste sino otra forma de medir la distancia entre las dos BPAs.

**De dónde sale.** Tres fuentes que miden lo mismo con σ = 5,0 / 1,8 / 10,0 mm/h
reparten esa misma medición de forma muy distinta sobre las cinco hipótesis del
marco: la fina concentra casi toda la masa en una, la gruesa la extiende sobre
tres. El solape es incompleto y K_ij > 0 aunque no haya ningún desacuerdo físico.
Como el suelo (0,365) supera κ₁ = 0,3, **la rama de Dempster es inalcanzable en
todo el régimen de intensidades bajas y medias**, por mucho que las fuentes
concuerden. Solo se abre en 40 mm/h, donde las tres BPAs caen dentro de la
hipótesis *intensa* [30, 60), que es ancha; ninguno de los dos eventos llega
ahí en el valor de celda.

**Qué NO se ha hecho.** No se han tocado las σ. Bajar σ_P de POWER hasta que
Dempster vuelva a aparecer sería exactamente el retro-ajuste que la declaración a
priori existe para impedir, y produciría un número que no significa nada.

**Qué generaliza.** El «hallazgo colateral» de la campaña sintética —los fixtures
son más concordantes que el ruido real— atribuía el conflicto alto a la
**dispersión entre mediciones**. Aquí se ve que existe con dispersión **cero**,
por la sola heterogeneidad de las σ. Son dos mecanismos distintos con el mismo
efecto, y el segundo es más incómodo: no depende del dato en absoluto.

**Qué abrió, y cómo se cerró.** La Def. 3.6 compara un conflicto con umbrales
fijos, y la Capa 1 de `docs/ERRATA.md` §9 ya había corregido *qué magnitud* se
compara. Ésta era la pregunta siguiente, y la resolvió el **experimento 5**
(`exp:conflict-floor`, semilla 20261007) con tres medidas por pares tras una
interfaz común y un criterio de siete pasos fijado antes de medir. Se seleccionó
la **distancia de Jousselme** (D2); D1 —restar el suelo—, que anula el suelo de
forma exacta, quedó **descalificada** en el paso 2 por cobertura de banda.

Con D2, sobre estos mismos eventos y **como descripción, no como validación**:

| | E1 · DANA | E2 · Filomena |
|---|---|---|
| Dempster / cautelosa / envolvente, D0 (antes) | 0 % / 93,8 % / 6,3 % | 0 % / 100 % / 0 % |
| **con D2 (ahora)** | **76,0 % / 21,9 % / 2,1 %** | **99,4 % / 0,6 % / 0 %** |
| suelo con acuerdo perfecto a 0 mm/h | 0,3651 **> κ₁** | → **0,2727 < κ₁** |
| horas critical | 19, **mismos 4 bloques** | 2 → **0** |

Las 19 horas critical de E1 no se mueven —ni una: los mismos cuatro tramos, hora
por hora— y su lluvia media sigue siendo 4,09 mm/h frente a 0,37 en el resto. Las
**dos horas critical de E2 desaparecen**, y eran un artefacto del suelo: las tres
fuentes medían 1,4 / 2,1 / 1,58 mm/h —acuerdo— y el conflicto de 0,436 abría la
banda a [0, 30] mm/h; con D2 van a Dempster, la banda se cierra a [0, 5] y
plUpper cae de 5,04·10⁻² a 1,06·10⁻⁴.

**Lo que sigue abierto y declarado:** κ₁ y κ₂ están fijados para un **marco de
discernimiento** concreto. D2 elimina la dependencia de la heterogeneidad de σ,
no la del marco.

**Qué NO se ha hecho, ni antes ni ahora.** Las σ no se han tocado. Bajar σ_P de
POWER hasta que Dempster reapareciera habría sido el retro-ajuste que la
declaración a priori existe para impedir; lo que se cambió fue la **medida**, y
se eligió sin mirar estos datos.

---

## Experimentos previstos

Todos usarán este runner:

- **Calibración de ε_h y de σ** — el hindcast de aquí *usa* valores declarados;
  no calibra ninguno. Calibrar `DEMO_H_MODEL_ERROR_BOUND` con la Def. 4.4 /
  Ec. (25), y las σ contra una referencia observacional, exige una fuente de
  observación directa (AEMET con credencial, o una red de pluviómetros abierta) y
  un modelo hidrológico real. Sin eso, H1 del Teorema 6.1 se sigue asumiendo.
- **Cobertura del nivel probabilístico** — la campaña sintética mide el Puente
  1→2 sobre P. Falta la equivalente sobre `h` tras la Capa 2, comprobando
  `Bel(E) ≤ P(E) ≤ Pl(E)` empíricamente contra la frecuencia de inundación real
  del mundo sintético.
- **Umbrales frente al suelo estructural** — la pregunta que abre el hallazgo de
  arriba: si κ₁ y κ₂ deben depender del marco y de la heterogeneidad de σ, y con
  qué garantía.
