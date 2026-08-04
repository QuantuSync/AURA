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

Tres experimentos sobre un **mundo sintético con ground truth conocido**, que es
lo que permite medir cobertura: la verdad se sortea primero y las mediciones se
derivan de ella, de modo que «el intervalo contiene P*» tiene respuesta exacta.

```bash
npm run exp:all        # los tres, semilla canónica 20260804  (~3 s)
npm run exp:coverage   # experimento 1, N = 10.000
npm run exp:h1         # experimento 2, 11 puntos × N = 2.000
npm run exp:virga      # experimento 3, N = 5.000
npm run exp:verify     # los tres reducidos a N = 200 (los que ve `verify`)
```

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

| método | condición | n | cobertura | IC Wilson 95 % | anchura media | mediana |
|---|---|---:|---:|---|---:|---:|
| `aura-existencial` | global | 10.000 | **100,00 %** | [99,96 · 100,00] | 500,00 | 500,00 |
| | sin fallo | 7.258 | 100,00 % | [99,95 · 100,00] | 500,00 | 500,00 |
| | fallo δ | 1.495 | 100,00 % | [99,74 · 100,00] | 500,00 | 500,00 |
| | virga | 1.247 | 100,00 % | [99,69 · 100,00] | 500,00 | 500,00 |
| `aura-banda-95` | global | 10.000 | **99,97 %** | [99,91 · 99,99] | 295,26 | 500,00 |
| | sin fallo | 7.258 | 100,00 % | [99,95 · 100,00] | 247,96 | 30,00 |
| | fallo δ | 1.495 | 99,87 % | [99,51 · 99,96] | 492,01 | 500,00 |
| | virga | 1.247 | 99,92 % | [99,55 · 99,99] | 334,70 | 500,00 |
| `media-ponderada` | global | 10.000 | **76,20 %** | [75,36 · 77,02] | 4,60 | 4,60 |
| | sin fallo | 7.258 | 94,81 % | [94,27 · 95,29] | 4,60 | 4,60 |
| | fallo δ | 1.495 | **2,01 %** | [1,41 · 2,85] | 4,60 | 4,60 |
| | virga | 1.247 | 56,86 % | [54,09 · 59,58] | 4,60 | 4,60 |
| `kalman-estatico` | global | 10.000 | **76,68 %** | [75,84 · 77,50] | 4,24 | 4,24 |
| | sin fallo | 7.258 | 95,34 % | [94,83 · 95,80] | 4,24 | 4,24 |
| | fallo δ | 1.495 | **2,34 %** | [1,69 · 3,24] | 4,24 | 4,24 |
| | virga | 1.247 | 57,18 % | [54,41 · 59,90] | 4,24 | 4,24 |

Por tramo de intensidad (cobertura), los baselines caen de 82 % en *seco* a
69 % en *extrema*; AURA se mantiene en 100 % en los cinco tramos (banda:
99,91 % en *ligera*, el único tramo con fallos). Tabla completa en
`results.csv`.

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
- La banda de evidencia al 95 % da 99,97 % de cobertura con 295 mm/h de anchura
  media pero **30 mm/h de mediana en mundos limpios**: la media está dominada
  por la cola de mundos en que la fusión escala a envolvente (ver abajo).

## Experimento 2 — degradación bajo violación de H1

`h1-violation.ts` · 11 puntos × N = 2.000 · figura f3.

Barrido de la fracción de mundos en que **las tres fuentes fallan a la vez**
(violación directa de H1 del Teorema 6.1). Cobertura sobre todos los mundos del
punto:

| violación | `aura-existencial` | `aura-banda-95` | `media-ponderada` | `kalman-estatico` |
|---:|---:|---:|---:|---:|
| 0 % | 100,00 % | 100,00 % | 80,35 % | 80,35 % |
| 25 % | 100,00 % | 84,00 % | 61,55 % | 61,80 % |
| 50 % | 100,00 % | 67,75 % | 39,80 % | 39,90 % |

Desglosado por si el mundo estaba violado o no (al 50 %):

| método | mundos violados | mundos intactos |
|---|---:|---:|
| `aura-existencial` | 100,00 % | 100,00 % |
| `aura-banda-95` | 37,17 % | 99,90 % |
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
  evidencia mantiene **99,7-100 % en los mundos intactos en los once puntos** y
  cae a ~35 % dentro de los violados. Degrada exactamente donde la hipótesis se
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
| `aura-banda-95` | **0,02 %** | [0,00 · 0,11] | 0,00 % | 99,8 % | 99,5 % | 356,01 |
| `media-ponderada` | **43,12 %** | [41,75 · 44,50] | 33,71 % | 49,9 % | 44,4 % | 4,60 |
| `kalman-estatico` | **41,58 %** | [40,22 · 42,95] | 32,04 % | 49,2 % | 46,0 % | 4,24 |

La afirmación del paper queda cuantificada: **uno de cada tres mundos de virga
pura** (y uno de cada 2,3 contando fallos δ) produce una media que no representa
ninguna de las dos realidades físicas.

Por tramo de γ, la métrica es monótona en el conflicto, y la estrategia de
fusión de AURA lo sigue:

| γ | n | `media-ponderada` | `kalman-estatico` | fusión AURA (D / C / E) |
|---|---:|---:|---:|---|
| 0,0-0,1 | 506 | 58,9 % | 57,7 % | 24 % / 12 % / **65 %** |
| 0,2-0,3 | 516 | 57,0 % | 54,1 % | 20 % / 13 % / **67 %** |
| 0,4-0,5 | 497 | 45,3 % | 44,1 % | 30 % / 17 % / 53 % |
| 0,6-0,7 | 498 | 37,3 % | 37,1 % | 27 % / 28 % / 45 % |
| 0,8-0,9 | 490 | 24,3 % | 23,9 % | 43 % / 25 % / 32 % |
| 0,9-1,0 | 476 | 19,7 % | 18,3 % | 43 % / 25 % / 32 % |

Reparto global de estrategias (Def. 3.6 con K_decision): **dempster 30,06 % ·
cautelosa 18,92 % · envolvente 51,02 %**. K_decision tiene mediana 0,718 y
cuartiles 0,228 / 0,935.

## Hallazgo colateral: los fixtures son más concordantes que el ruido real

Reparto de estrategias de fusión en el experimento 1 (`results.json`,
`fusionByCondition`):

| condición | n | dempster | cautelosa | envolvente |
|---|---:|---:|---:|---:|
| global | 10.000 | 44,1 % | 24,9 % | 31,0 % |
| **sin fallo ni virga** | 7.258 | **54,1 %** | **30,3 %** | **15,6 %** |
| fallo δ | 1.495 | 3,9 % | 1,1 % | 95,1 % |
| virga | 1.247 | 34,2 % | 21,8 % | 43,9 % |

Es decir: en **casi la mitad** de los mundos donde no pasa nada —ni fallo de
fuente ni conflicto físico— el sistema ya no aplica la regla de Dempster. Los
cuatro escenarios de `fixtures/` dan K_global = 0,027 / 0,184 / 0,951 / 3,3e-9,
es decir dempster en tres de cuatro.

La diferencia no es un error de ninguno de los dos: los fixtures fijan
mediciones que concuerdan dentro de ±0,75 mm/h, mientras que tres fuentes con
σ = 1,5 / 2,0 / 2,5 mm/h midiendo la MISMA verdad se separan típicamente varios
mm/h, y sobre un marco de cinco hipótesis anchas eso basta para que sus soportes
dejen de solaparse. K_global crece muy deprisa con la dispersión porque es
`1 − Σ_j Π_i m_i(θ_j)` salvo los términos de Θ: sin una hipótesis en la que las
tres fuentes concentren masa a la vez, el conflicto n-ario es alto **aunque no
haya ningún desacuerdo físico**.

Consecuencia para el paper: la demo de §7 **subrepresenta** con cuánta
frecuencia el sistema abandona la regla de Dempster en operación normal, y con
ella la pérdida de informatividad de la banda de evidencia (mediana 30 mm/h en
mundos limpios, media 248 por la cola de envolventes, en las que la BPA
sintética de `envelopeCombine` manda casi toda la masa a Θ). No es una errata
—el motor hace exactamente lo que la Def. 3.6 extendida dice— pero sí un régimen
que conviene declarar antes de que alguien lea los cuatro fixtures como
representativos del caso medio.

---

## Experimentos previstos

Todos usarán este runner:

- **Hindcast** — el pipeline sobre series históricas reales de AEMET, para
  calibrar por fin `ε_h` con la Def. 4.4 / Ec. (25) y sustituir los valores hoy
  **declarados** (`DEMO_H_MODEL_ERROR_BOUND`, `SOURCE_CHARACTERIZATIONS`, y el
  sesgo por fuente que esta campaña declara en `lib/world.ts`) por otros
  calibrados.
- **Cobertura del nivel probabilístico** — lo de aquí mide el Puente 1→2 sobre
  P. Falta la campaña equivalente sobre `h` tras la Capa 2, comprobando
  `Bel(E) ≤ P(E) ≤ Pl(E)` empíricamente contra la frecuencia de inundación real
  del mundo sintético.
