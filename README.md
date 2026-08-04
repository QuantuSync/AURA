# AURA v2

[![verify](https://github.com/QuantuSync/AURA/actions/workflows/verify.yml/badge.svg)](https://github.com/QuantuSync/AURA/actions/workflows/verify.yml)

**Autonomous Uncertainty-Aware Resilience Architecture**

Plataforma de fusión de datos con cuantificación formal de incertidumbre para decisiones en infraestructura crítica.

## Arquitectura

AURA integra tres capas matemáticas en un pipeline operativo:

| Capa | Función | Framework | Módulo |
|------|---------|-----------|--------|
| 0 | Ingesta | Clientes de API + modo offline por fixtures | `src/data/` |
| 1 | Fusión de datos | Dempster-Shafer + Conjuntos credales | `src/core/dempster-shafer/` |
| 1→2 | Puente credal | Propagación por elementos focales | `src/core/credal-propagation/` |
| 2 | Modelado causal | SCM + Aritmética de intervalos | `src/core/causal-dag/` |
| 3 | Verificación | Zonotopes + Reachability | `src/core/zonotope/` |
| 3 | Decisión | Certificado de dos niveles | `src/core/decision/` |

El pipeline completo del caso de uso de §7 está en `src/core/pipeline/`, y su
ejecución reproducible sobre los cuatro escenarios versionados en
`scripts/reproduce.ts` (ver [Reproducibilidad](#reproducibilidad)).

Referencia teórica normativa: **`papers/AURA_v2.pdf`**. Toda cita a
definiciones, teoremas y ecuaciones en el código y en este README se refiere a
ese documento.

Las discrepancias detectadas entre el paper y la implementación —erratas,
extensiones y salvedades— están registradas en **[`docs/ERRATA.md`](docs/ERRATA.md)**,
con su estado en el código y la corrección propuesta para la v3.

> `papers/AURA_final.pdf` es la versión 1, anterior y superada. No es
> especificación: contiene afirmaciones no implementadas. Consultar solo por
> contexto histórico.

## Stack

- **Motor matemático**: TypeScript puro (sin dependencias, ejecutable en cliente y serverless)
- **Frontend**: Next.js 16.2 + React 19 + Tailwind CSS 4
- **Visualización**: Recharts / D3.js en la UI; SVG generado por código en las figuras reproducibles
- **Tests**: Vitest + fast-check
- **Scripts**: `tsx` (los scripts de `scripts/` son TypeScript ejecutable)
- **Despliegue**: Vercel

Requiere **Node ≥ 20.11** (declarado en `package.json`). CI usa Node 22.

## Desarrollo

```bash
npm ci                   # Instalación reproducible desde package-lock.json
npm run dev              # Servidor de desarrollo (localhost:3000)
npm run test             # Tests con Vitest (watch mode)
npm run test:run         # Suite completa, incluidas las properties (1.000 casos c/u)
npm run test:properties  # Solo properties, 20.000 casos por propiedad
npm run build            # Build de producción
```

Las properties se parametrizan por entorno: `FC_NUM_RUNS` (casos por
propiedad), `FC_SEED` (semilla; fija por defecto para que CI sea
reproducible) y `FC_VERBOSE=1`. `FC_NUM_RUNS` es un **valor por defecto**, no
una imposición: el entorno manda, que es lo que permite a CI usar el ciclo
rápido sin duplicar el script.

```bash
FC_NUM_RUNS=1000 npm run test:properties            # ciclo rápido (el de CI)
FC_SEED=20260804 FC_NUM_RUNS=50000 npm run test:properties
```

## Reproducibilidad

Todo resultado que pueda aparecer en el paper es regenerable con un comando, sin
red y sin reloj.

```bash
npm ci           # instalación exacta desde package-lock.json
npm run verify   # puerta completa: tipos → tests → properties → repro → experimentos → snapshots
npm run repro    # solo la regeneración de resultados y figuras
```

`npm run verify` encadena ocho pasos y para en el primer fallo:

| # | Paso | Qué comprueba |
|---|------|---------------|
| 1 | `npx tsc --noEmit` | Tipos |
| 2 | `npm run test:run` | Suite completa |
| 3 | `npm run test:properties` | Campaña de property-based testing |
| 4 | `npm run repro` | Regeneración de los cuatro escenarios |
| 5 | `npm run exp:smoke` | El contrato del runner de experimentos |
| 6 | `npm run exp:verify` | Los tres experimentos de cobertura, con N = 200 |
| 7 | `npm run exp:hindcast:verify` | El hindcast sobre datos reales, 24 h del pico de E1 |
| 8 | `npm run snapshots:check` | `out/` **byte a byte** contra `snapshots/` |

### Escenarios

La ingesta lee de `fixtures/<escenario>/` en lugar de la red cuando se activa el
modo offline (`AURA_OFFLINE=1`, o `{ offline: true }` en la llamada). El modo por
defecto **no cambia**: sin esa señal, los clientes hacen `fetch`. Procedencia y
formato de cada fixture, en [`fixtures/README.md`](fixtures/README.md).

| Escenario | Precipitación (mm/h) | `K_máx` | `K_global` | Método | Bel(E) | Pl(E) | Decisión |
|---|---|---|---|---|---|---|---|
| `s1-normal` | 0 / 0 / 0 | 0,0256 | 0,0272 | dempster | 0 | 1,234e-4 | `warning` |
| `s2-light-rain` | 8 / 9 / 7,5 | 0,1576 | 0,1844 | dempster | 0 | **1,559e-4** | `warning` |
| `s3-virga-conflict` | 3 / 18 / 25 | 0,9159 | 0,9512 | envelope † | 0 | 0,99997 | `critical` |
| `s4-extreme` | 45 / 46 / 44,5 | 3,22e-9 | 3,32e-9 | dempster | 0,99988 | ≈ 1 | `critical` |

† `s3` es además el único que activa la **guardia de degeneración**
(`K_global ≥ κ_deg = 0,95`); ya iba a envolvente por `K_máx > κ₂`, de modo que
llega al mismo sitio por dos vías independientes. Ver «Estrategia de fusión».

En los cuatro, el veredicto **existencial** es el mismo (`unsafe-possible`) sobre
el mismo reachable set (`[−12, 992]` mm) y con la misma severidad heurística: es
la tesis de [`docs/ERRATA.md`](docs/ERRATA.md) §8 medida sobre cuatro regímenes
de evidencia distintos.

### Salidas

`npm run repro` escribe en `out/` (ignorado por git; la expectativa versionada
está en `snapshots/`):

```
out/
├── summary.csv                    una fila por escenario, tabla agregada
└── <escenario>/
    ├── result.json                resultado íntegro: mediciones, BPAs, conflictos,
    │                              método de fusión, bounds por hipótesis, conjunto
    │                              credal de entrada y propagado, y el certificado
    │                              completo con H0–H3 y domainBounds
    ├── summary.csv                la fila de este escenario, aislada
    └── figures/
        ├── h-evolution.svg        h(t) con los bounds del hull y la banda que
        │                          concentra ≥ 99 % de la masa credal
        └── credal-mass.svg        masa por hipótesis, antes y después de la fusión
```

Columnas de `summary.csv`: `scenario`, `K_max`, `K_global`, `rule`,
`K_decision`, `guard`, `method`, `credal_lower`, `credal_upper`,
`reachable_lower`, `reachable_upper`, `status`, `belLower`, `plUpper`,
`decision`. Las tres del medio son la traza de la regla de conflicto: sin ellas,
`K_max` y `K_global` no explican por sí solos por qué se eligió `method`.

### Estrategia de fusión (Def. 3.6) — qué magnitud decide

El paper elige entre regla de Dempster, media ponderada cautelosa y envolvente
conservativa comparando **un** número con κ₁ = 0,3 y κ₂ = 0,7. Cuál es ese
número no es obvio con n > 2 fuentes, y el repositorio ha pasado por dos
respuestas:

- **K_máx por pares** (Def. 3.5, literal del paper) **no acota** el conflicto de
  la reducción secuencial `(((m₁⊕m₂)⊕m₃)⊕…)`: hay un contraejemplo con todos los
  pares a 0,75 que degenera a conflicto total. Ver [`docs/ERRATA.md`](docs/ERRATA.md) §2.
- **K_decision = máx(K_máx, K_global)** lo cierra, pero aplica a una magnitud
  n-aria unos umbrales elegidos para la escala del par: K_global crece con n y
  con la granularidad del marco aunque no exista desacuerdo físico. Ver
  [`docs/ERRATA.md`](docs/ERRATA.md) §9.

La regla vigente separa las dos funciones que aquello mezclaba:

```
K_decision = K_máx por pares          →  comparada con κ₁ y κ₂   (informatividad)
K_global ≥ κ_deg = 0,95               →  fuerza envolvente        (protección)
```

es decir, κ₁/κ₂ vuelven a comparar el conflicto por pares para el que fueron
elegidos, y K_global hace **solo** aquello que motivó su introducción: impedir
que la reducción degenere. Es sound por construcción — la rama Dempster exige
K_global < 0,95 < 1, y la propiedad (P2′) de [`docs/ERRATA.md`](docs/ERRATA.md)
§2 acota entonces el conflicto de **todo** paso intermedio por ese mismo valor.

Las cuatro reglas candidatas conviven tras `FusionConfig.rule`
(`src/core/dempster-shafer/conflict-rules.ts`) y la vigente se eligió con un
**experimento pre-registrado** —candidatos, requisito innegociable y criterio de
selección fijados antes de ver ningún resultado, y con una semilla distinta de
la canónica:

```bash
npm run exp:conflict-rule   # Fase A: los 4 candidatos sobre los mismos mundos
npm run exp:all             # Fase B: los números publicables, regla vigente
npm run exp:all:c0          # los mismos, con la regla anterior, para comparar
```

Efecto medido (10.000 mundos, semilla 20260804): en mundos limpios y
concordantes la envolvente cae del **15,6 % al 4,6 %** y la anchura media de la
banda de evidencia baja un 9,4 %, con la cobertura existencial intacta en el
100 % y la de la banda de evidencia en 99,91 % (era 99,97 %). El desglose
completo, con lo que se paga por ello, en [`docs/ERRATA.md`](docs/ERRATA.md) §9.

### Determinismo

Dos ejecuciones consecutivas producen **bytes idénticos**. Las tres fuentes de
variación están cerradas en `scripts/lib/canonical.ts`: claves ordenadas,
números a 12 cifras significativas (el ruido de coma flotante vive a partir de la
15.ª) y no finitos como cadena, porque `safeRegion.lower = -Infinity` es un valor
con significado que `JSON.stringify` convertiría en `null`. Los timestamps salen
del fixture, no del reloj, y el único campo que lleva `Date.now()`
(`CertifiedDecision.timestamp`) se excluye explícitamente de la serialización.

```bash
npm run repro && cp -r out /tmp/a && npm run repro && diff -r /tmp/a out
```

### Snapshots

`snapshots/` versiona la salida esperada, con el mismo árbol que `out/`.
`npm run snapshots:check` compara y falla con el diff línea a línea;
`npm run snapshots:update` los regenera **deliberadamente**. La actualización
nunca es automática: un snapshot que se regenera solo al fallar convierte
cualquier cambio de resultado en un cambio de expectativa, y entonces el commit
que altera un número publicado pasa inadvertido.

### Experimentos

`scripts/experiments/` define el contrato de todo experimento futuro —semilla
obligatoria por CLI, PRNG compartido con las properties (`src/lib/prng.ts`),
salida estándar en `out/experiments/<nombre>/`—. El detalle está en
[`scripts/experiments/README.md`](scripts/experiments/README.md).

```bash
npx tsx scripts/experiments/smoke.ts --seed 20260804 --samples 200
npm run exp:all    # campaña de cobertura: los tres experimentos, ~3 s
```

La **campaña de cobertura** compara el pipeline credal contra dos baselines
clásicos sobre mundos sintéticos con ground truth conocido. Titulares (semilla
20260804; tablas completas y método en el README de `scripts/experiments/`):

| | cobertura global | anchura media |
|---|---:|---:|
| AURA, nivel existencial (Ec. 10) | **100,00 %** [99,96 · 100,00] | 500,00 mm/h |
| AURA, banda de evidencia 95 % | **99,97 %** [99,91 · 99,99] | 295,26 mm/h |
| media ponderada (δ_i en el peso) | 76,20 % [75,36 · 77,02] | 4,60 mm/h |
| Kalman estático (pesos por precisión) | 76,68 % [75,84 · 77,50] | 4,24 mm/h |

Los dos baselines están **bien calibrados mientras su modelo se cumple** (94,8 %
y 95,3 % en mundos sin fallo ni conflicto, contra un 95 % nominal) y caen a ~2 %
en cuanto **una sola** de las tres fuentes falla, sin que su intervalo se
ensanche un milímetro. En el caso *virga* del Ejemplo 3.1, un tercio de los
mundos produce una media que no contiene **ni P\* ni γ·P\***: ni lo que ocurre
arriba ni lo que ocurre abajo. La contrapartida está en la columna de la
derecha, y es enorme.

### Hindcast sobre dos eventos reales

```bash
npm run hindcast:capture   # UNA VEZ: descarga y versiona fixtures/hindcast/
npm run exp:hindcast       # los dos eventos, sin red      (~1,5 s)
```

El pipeline completo, **hora a hora**, sobre dos episodios meteorológicos reales
con datos públicos sin API key: la **DANA de Valencia** (28-31 oct 2024, 39,42 N
−0,72 E, 96 h) y la **borrasca Filomena** en Madrid (6-12 ene 2021, 40,472 N
−3,683 E, 168 h). Tres reanálisis por evento —ERA5 a ~25 km, análisis operativo
del IFS a ~9 km y MERRA-2 vía NASA POWER a ~50 km— con σ y δ **declaradas antes
de ejecutar nada**. Detalle completo en
[`scripts/experiments/README.md`](scripts/experiments/README.md).

> #### ⚠ Es un ejercicio ILUSTRATIVO, no una validación operativa
>
> Muestra **cómo se comporta el pipeline** sobre entrada real. No muestra —ni
> puede— que AURA «habría evitado» ni «habría predicho» nada de lo que ocurrió en
> aquellos episodios, y ninguna cifra de esta sección debe leerse así: no hay
> ground truth (los tres productos son mallas de reanálisis, no el valor en el
> punto), el DAG es el de juguete de la demo (Ec. 34) y las tres fuentes
> comparten observaciones asimiladas, luego H3 no se cumple en sentido estricto.

> #### ⚠ CAVEAT OBLIGATORIO DE FILOMENA (E2)
>
> Su precipitación fue mayoritariamente **nieve**, con T < 0 °C sostenida (53,6 %
> de las horas por debajo de cero en las tres fuentes a la vez, mínimo −12,03 °C).
> El DAG de la demo modela inundación por **lluvia**: acumula precipitación
> líquida y resta un drenaje constante. Ese mecanismo no existió. **Todo h,
> plUpper y decisión de E2 describe lo que el pipeline diría si aquello hubiera
> sido lluvia, y no una estimación del riesgo real de aquel episodio.** El
> interés de E2 está en la capa de fusión y en el contraste con E1. La
> advertencia viaja también en el manifest de sus fixtures y en las cuatro
> figuras del evento.

| | **E1 · DANA Valencia** | **E2 · Filomena Madrid** |
|---|---|---|
| horas evaluadas / excluidas por huecos | 96 / **0** | 168 / **0** |
| K_máx mediana · p95 · máx | 0,371 · 0,707 · 0,941 | 0,365 · 0,421 · 0,441 |
| fusión Dempster / cautelosa / envolvente | 0 % / 93,8 % / 6,3 % | 0 % / 100 % / 0 % |
| plUpper máximo | 0,963 | 0,0505 |
| horas critical / warning / safe | 19 / 77 / 0 | 2 / 166 / 0 |
| anchura banda 95 %, mín-media-máx | 15 · 47,3 · 500 mm/h | 15 · 15,2 · 30 mm/h |

**Lo que se ve.** Los dos baselines tienen anchura **constante** en las 264 horas
—14,80 y 6,55 mm/h— porque depende solo de σ y δ, nunca de la evidencia; en la
hora de máximo desacuerdo de E1 el intervalo del Kalman deja fuera a **dos de las
tres fuentes** que dice resumir, y AURA responde con la envolvente y una banda de
[0, 500] mm/h: no resume, declara que no puede. El pipeline **no consume la
temperatura**, de modo que en E2 dice exactamente lo mismo con −12 °C que con
18 °C — que es, literalmente, el modo de fallo «hielo bloqueando drenes» que §6.3
del paper cita al motivar H2.

**Y un hallazgo que los mundos sintéticos no habían mostrado.** Dempster **no se
aplica ni una vez** en las 264 horas. Con tres fuentes midiendo *exactamente lo
mismo* y σ = 1,8 / 5,0 / 10,0 mm/h, K_máx ya vale **0,365** — por encima de
κ₁ = 0,3. Es un **suelo estructural** que no procede de ningún desacuerdo, sino
de que BPAs con σ muy distintas reparten la misma medición de forma distinta
sobre las hipótesis del marco. El mínimo observado en los dos eventos coincide
con ese suelo (a 2·10⁻⁴ en E1, exactamente en E2): **el conflicto mínimo del
hindcast no mide desacuerdo entre reanálisis, mide discretización.** Las σ no se
han tocado — retocarlas a la vista del resultado es justo lo que la declaración a
priori existe para impedir. Consecuencia registrada como limitación: **κ₁ y κ₂
están declarados para un marco y una heterogeneidad de σ dados**, y no son
transportables sin más a fuentes de resolución muy dispar.

**Atribución de los datos.** Series de Open-Meteo (`archive-api.open-meteo.com`,
modelos `era5` y `ecmwf_ifs`, sobre archivo ERA5/IFS de Copernicus/ECMWF), bajo
licencia **CC BY 4.0** — <https://open-meteo.com/>. Series de NASA POWER
(endpoint horario, MERRA-2), **dominio público con atribución exigida**:
*«These data were obtained from the NASA Langley Research Center (LaRC) POWER
Project funded through the NASA Earth Science/Applied Science Program.»* AEMET
queda deliberadamente fuera: su OpenData exige API key y rompería la
reproducibilidad para quien no la tenga. URLs exactas, fechas de captura,
resoluciones y checksums SHA-256 de cada fichero están en
`fixtures/hindcast/<evento>/manifest.json`.

## Trazabilidad matemática

Cada módulo referencia definiciones, lemas y teoremas de `papers/AURA_v2.pdf`,
con su sección real:

| Módulo | Referencias normativas | Sección |
|--------|------------------------|---------|
| `dempster-shafer/types.ts` | Def. 3.1, 3.2, 3.3, 3.7, 3.8 *(+ `domainBound`, extensión)* | §3.2–3.5 |
| `dempster-shafer/frame.ts` | Def. 3.1 *(marco de soporte acotado, extensión)* | §3.2 |
| `dempster-shafer/bpa.ts` | Def. 3.3 y Ec. (1)-(2); Def. 3.4 y Ec. (3)-(4) | §3.2–3.3 |
| `dempster-shafer/conflict.ts` | Def. 3.5 y Ec. (6); Def. 3.6 *(+ K_global, extensión)* | §3.4 |
| `dempster-shafer/conflict-rules.ts` | Def. 3.6 *(qué magnitud se compara con κ₁/κ₂; extensión, ERRATA §9)* | §3.4.2 |
| `dempster-shafer/combination.ts` | Ec. (5)-(6) Dempster; Ec. (7) cautelosa; Def. 3.7 y Ec. (8)-(9) | §3.4 |
| `dempster-shafer/credal-set.ts` | Def. 3.8; Prop. 3.1, 3.2; Def. 3.9 y Ec. (10) | §3.4–3.6 |
| `credal-propagation/credal-interval-set.ts` | Def. 3.9 y Ec. (10) *(→ Def. 3.9′ y Ec. (10′), extensión)* | §3.6 |
| `credal-propagation/propagation.ts` | Def. 4.3 y Ec. (24); Teo. 4.1 *(por elemento focal, extensión)* | §4.4.2 |
| `credal-propagation/probability-bounds.ts` | Def. 3.3 y Ec. (1)-(2) *(→ Def. 5.5′ y Ec. (31′), extensión)* | §3.2, §5.5 |
| `intervals/` | Def. 4.2 y Ec. (20)-(23); Prop. 4.1 | §4.4.1 |
| `causal-dag/` | Def. 4.1; Def. 4.3 y Ec. (24); Def. 4.4 y Ec. (25); Teo. 4.1 | §4.2, §4.4.2, §4.5 |
| `causal-dag/demo-dag.ts` | Ec. (34) *(modelo de acumulación de la demo)* | §7.3 |
| `pipeline/demo-pipeline.ts` | §7 completo: Def. 3.4 → Ec. (34) → Def. 5.5 + 5.5′ | §7 |
| `zonotope/types.ts` | Def. 5.1 y Ec. (26) | §5.2 |
| `zonotope/zonotope.ts` | Obs. 5.1; Def. 5.2 y Ec. (27) *(Puente 2→3)*; Obs. 5.2 (Girard) | §5.2–5.4 |
| `zonotope/propagation.ts` | Teo. 5.1 y Ec. (28)-(29) | §5.4 |
| `zonotope/linearization.ts` | Teo. 5.1 (cota de Lagrange automática) | §5.4 |
| `zonotope/reachability.ts` | Def. 5.3 | §5.5 |
| `decision/synthesis.ts` | Def. 5.5 y Ec. (31); Teo. 5.2; Teo. 6.1 (H1–H3) *(+ H0 y nivel probabilístico, extensiones)* | §5.5, §6.3 |
| `data/sources/characterization.ts` | Def. 3.4 y Ec. (3)-(4) — σ y δ de cada fuente *(declarados, no calibrados)* | §3.3 |

> **Correcciones de numeración.** Iteraciones anteriores del código se
> escribieron sin acceso al paper y citaban referencias desalineadas: el
> conjunto credal como Def. 3.5 (es 3.8), la aritmética de intervalos como
> Def. 4.4 (es 4.2), la propagación zonotópica como Teo. 5.2 (es 5.1), la
> cobertura como Prop. 3.5 (es 3.1), un inexistente "Teo. 5.4 end-to-end" (es
> el Teo. 6.1) y las ecuaciones de la envolvente como (6)-(7) (son (8)-(9)).
> Todas corregidas.

## Certificado de dos niveles

Todo certificado de AURA lleva **dos afirmaciones demostradas**, no una. Ambas
dependen exactamente de las mismas hipótesis (H0 + H1–H3) y de ninguna más.

| Nivel | Qué afirma | Referencia |
|---|---|---|
| **Existencial** — `certificate.status` | `proven-safe` ⟺ *reachable* ⊆ región segura. `unsafe-possible` ⟺ existe un estado alcanzable inseguro. Binario. | Def. 5.5 y Ec. (31), §5.5 |
| **Probabilístico** — `certificate.probabilityBounds` | `Bel(E) ≤ P(evento inseguro) ≤ Pl(E)`, por propagación credal elemento focal a elemento focal. Continuo. | *Extensión*, → Def. 5.5′ y Ec. (31′) |

Y una tercera magnitud que **no** es formal y nunca lo ha sido:
`decision.severity`, la fracción geométrica del reachable set fuera de la región
segura. `decision.escalationBasis` dice cuál de las dos señales sostuvo el
`warning`/`critical` que se ve en pantalla.

**Por qué hacía falta el segundo nivel.** Con H0 honesta (ver más abajo), la
válvula de seguridad `δ_i` de la Def. 3.4 deja masa sobre Θ, Θ interseca la
hipótesis de cola, y el lifting de la Ec. (10) devuelve el rango completo del
marco **casi siempre**: `Pl(cola) ≥ Π δ_i ≈ 1e-4`, seis órdenes por encima del
umbral 1e-10 de la Def. 3.9. El nivel existencial resulta entonces sound y
**vacuo**. Sobre el escenario de la demo:

| Escenario | Ec. (10) | Reachable `h(2 h)` | Def. 5.5 | `severity` | **Bel(E)** | **Pl(E)** |
|---|---|---|---|---|---|---|
| Lluvia ligera (~8 mm/h) | [0, 500] | [−12, 992] | `unsafe-possible` | 0,9631 | **0** | **1,559e-4** |
| Lluvia intensa (~45 mm/h) | [0, 500] | [−12, 992] | `unsafe-possible` | 0,9631 | **0,99988** | **≈ 1** |

Las cuatro primeras columnas son **idénticas**: ni el veredicto formal ni la
heurística geométrica distinguen una llovizna de un diluvio. Las dos últimas los
separan por más de tres órdenes de magnitud.

**La dirección de la garantía.** Los intervalos propagados sobre-aproximan, y
sobre-aproximar solo puede *quitar* términos a `Bel(E)` (la contención se vuelve
más difícil) y *añadirlos* a `Pl(E)` (la intersección, más fácil). Luego
`[Bel, Pl] ⊇ [P̲(E), P̄(E)]` reales: la imprecisión **ensancha** el intervalo de
probabilidad, nunca lo desplaza fuera. Corolario práctico: `Pl(E)` pequeño es
una afirmación fuerte, `Bel(E)` pequeño es débil — y por eso el escalado
operativo mira `Pl(E)`.

Detalle completo, demostración y estado en
[`docs/ERRATA.md`](docs/ERRATA.md) §8.

## Soundness verification

Los invariantes de soundness del paper se verifican con **property-based
testing** (fast-check) sobre entradas generadas, no sobre casos escogidos a
mano. Semilla fija → CI reproducible; `FC_NUM_RUNS` escala la campaña.

| Invariante | Referencia normativa | Archivo de test | Propiedades |
|------------|----------------------|-----------------|-------------|
| Aritmética de intervalos: `x◦y ∈ [a]◦[b]` para `◦ ∈ {+,−,×,÷}` | Prop. 4.1, §4.4.1 | `properties/interval-arithmetic.property.test.ts` | 9 |
| Cobertura de la envolvente conservativa | Prop. 3.1, §3.4.2 | `properties/fusion-coverage.property.test.ts` | 8 |
| Validez y conmutatividad de la regla de Dempster | Ec. (5)-(6), §3.4.1 | `properties/dempster-validity.property.test.ts` | 9 (+6 regresión) |
| Clausura zonotópica (Minkowski, transf. lineal, hull, Girard) | Def. 5.1 / Obs. 5.1-5.2, §5.2-5.4 | `properties/zonotope-operations.property.test.ts` | 9 |
| Cobertura del lifting a zonotope (Puente 2→3) | Prop. 5.1 = Lema 6.2, §5.3/§6.2 | `properties/bridge-2-3.property.test.ts` | 6 |
| Propagación no lineal: `f(Z) ⊆ Z'` + conservatismo ρ̂ | Teo. 5.1 y Ec. (28)-(29); Def. 5.6, §5.4/§5.6 | `properties/nonlinear-propagation.property.test.ts` | 5 (500 pts/caso) |
| Certificado existencial de decisión | Def. 5.5 y Ec. (31), §5.5 | `properties/certificate-soundness.property.test.ts` | 12 |
| Propagación por el DAG: `v*_i ∈ [V_i]` con `\|u_i\| ≤ ε_i` | Def. 4.3 y Ec. (24); Teo. 4.1, §4.4.2 | `properties/dag-propagation.property.test.ts` | 5 (+1 contraejemplo) |
| Conflicto global n-ario e invariancia al orden de las fuentes | Def. 3.5-3.6 *(extensión)*, §3.4.2 | `properties/global-conflict.property.test.ts` | 11 |
| Lifting credal bajo soporte acotado: `x* ∈ I(X)` dado H0 | Def. 3.9 y Ec. (10); Lema 6.1 *(+ H0, extensión)*, §3.6/§6.1 | `properties/credal-lifting.property.test.ts` | 7 (2 del caso negativo de H0) |
| Cobertura credal end-to-end: `Bel(E) ≤ P(E) ≤ Pl(E)` | Def. 3.9′ y Ec. (10′); Def. 5.5′ y Ec. (31′) *(extensión)*, §3.6/§5.5 | `properties/credal-propagation.property.test.ts` | 10 (≥ 500 mundos muestreados/caso) |

Cada propiedad ejecuta `FC_NUM_RUNS` casos generados: **1.000** en `test:run`
(CI) y **20.000** en `test:properties`. Campaña de referencia: 91 propiedades ×
20.000 casos (más 7 contraejemplos deterministas de regresión), semilla 20260804
— todas pasan, en 107 s de reloj. La suite completa (`npm run test:run`) son 476
tests en 34 ficheros, y `npm run verify` entero, 125 s.

### Ratio de conservatismo medido (Definición 5.6)

`test:properties` reporta ρ̂ = ancho(hull computado) / ancho(hull empírico de
las imágenes muestreadas), el análogo muestral por eje del ratio de
sobre-conservatismo de la Def. 5.6. Campaña de 20.000 casos × 500 puntos,
13.941 mediciones válidas:

| Familia de funciones | Mediciones | ρ̂ mediana | ρ̂ media | ρ̂ p95 | ρ̂ máx |
|----------------------|-----------|-----------|---------|-------|-------|
| `k·√(x+c)` (Darcy-Weisbach, Ec. 11) | 6.646 | **1,26** | 1,79 | 4,15 | 47,8 |
| `sin` y composiciones | 4.654 | 2,38 | 4,56 | 13,10 | 133,6 |
| Polinomios de grado ≤ 3 | 2.641 | 4,03 | 14,56 | 50,49 | 1.496,8 |
| **Todas** | **13.941** | **1,55** | **5,13** | **13,57** | 1.496,8 |

ρ̂ ≥ 1 en las 13.941 mediciones, como exige la soundness (mínimo observado:
1,000). La familia hidráulica —la que el paper usa en el caso de uso— es con
diferencia la más ajustada, lo que respalda cuantitativamente la "Implicación
práctica" de §5.6: con dinámica suave e incertidumbre acotada el conservatismo
acumulado es tolerable. Los polinomios cúbicos con curvatura alta frente a su
término lineal son el peor caso, coherente con la Prop. 5.2 (ρ crece con L).

### Hallazgos de la infraestructura de reproducibilidad

Dos defectos que ninguna property podía encontrar, porque no estaban en el motor
sino en la **capa de datos** —y que solo salieron a la luz al hacer que el
pipeline reproducible se alimente de la ingesta real en lugar de constantes
escritas a mano:

- **`PRECTOTCORR` de NASA POWER se leía en mm/h siendo mm/day**: un factor 24 en
  una de las tres entradas de la fusión. La función convertía `WS10M` de m/s a
  km/h tres líneas más abajo, de modo que la ausencia de conversión era un
  descuido, no una decisión. Verificado contra la propia API
  (Madrid-Chamartín, 2026-03-10): las 24 horas suman 85,22 y su **media**,
  3,551, es exactamente el valor diario 3,55. *Corregido*, junto con el paso al
  endpoint **horario** —un acumulado diario no puede representar 45 mm/h en un
  marco de intensidad con horizonte de 2 h— y el tratamiento del `fill_value`
  (−999) con que POWER marca las horas que el reanálisis aún no cubre.
- **σ y δ de las fuentes estaban declarados dos veces y en desacuerdo.** Cada
  cliente de `src/data/sources/` los fijaba en línea, y
  `DEMO_SOURCES_LIGHT_RAIN` declaraba otros distintos para las mismas tres
  fuentes: σ_prec (0,5 / 1,5 / 2,0) frente a (1,5 / 2,0 / 2,5), y las δ de AEMET
  y Open-Meteo intercambiadas. Mientras ingesta y demo fueron caminos separados
  el desacuerdo fue invisible; en cuanto `npm run repro` alimenta la demo desde
  la ingesta, el `plUpper` publicado deja de reproducirse. *Corregido*:
  `src/data/sources/characterization.ts` es la declaración única, sobre los
  valores que respaldan todos los números publicados, y
  `__tests__/data/characterization.test.ts` bloquea el acuerdo entre ambas.

### Hallazgos del property-based testing

Cinco defectos reales encontrados por las properties y la revisión que
provocaron, todos corregidos o documentados en el código:

1. **`fromIntervals` violaba la Prop. 5.1** cuando el ancho del intervalo era
   menor que el ulp de su punto medio: el centro redondeado más el radio
   `(v̄−v̲)/2` no cubría el extremo superior. Ejemplo: `[100, 100+1e-14]` daba
   el hull `[100, 100]`, y el testigo α de la demostración salía 2 ∉ [−1,1].
   *Corregido*: el radio es ahora `máx(v̄−c, c−v̲)`, exacto por Sterbenz.
2. **`propagateNonlinearAuto` podía producir un zonotope más estrecho que
   f(Z)** para funciones casi lineales: el Teo. 5.1 supone J = Df(c) exacta,
   pero la jacobiana por diferencias centrales arrastra error ≈ ε·|f|/(h·|∂f|),
   y con L ≈ 0 la cota de Lagrange no lo absorbe (ρ̂ = 0,99999997 < 1).
   *Corregido*: el error de la jacobiana se estima por paso doble y se suma a
   la cota, junto con un suelo de redondeo.
3. **El conflicto secuencial no está acotado por el conflicto por pares.** La
   Def. 3.5 define K solo entre pares y la Def. 3.6 decide con K_máx, pero
   `dempsterCombineMultiple` reduce secuencialmente y la BPA acumulada se
   concentra. Contraejemplo con K_máx = 0,75 en todos los pares que alcanza
   conflicto **total** al tercer paso. *Cerrado por construcción* con `K_global`,
   el conflicto n-ario sobre el producto conjunto: `K_global < 1` **demuestra**
   que ningún paso de la reducción degenera en ningún orden, y la versión
   cuantitativa (P2′) acota además el conflicto de cada paso por el propio
   `K_global` (extensión del paper, ver [`docs/ERRATA.md`](docs/ERRATA.md) §2).
   La primera regla construida con él, `K_decision = máx(K_máx, K_global)`,
   cambiaba la estrategia en el 16,1 % de 20.000 casos generados, siempre hacia
   una rama más conservadora — y **demasiado** a menudo: ver el punto 6.
4. **El intervalo credal se truncaba sin respaldo formal cuando la cola del
   marco es plausible.** La Ec. (10) devuelve `+∞` para el marco de la Def. 3.1
   (última hipótesis `[60, ∞)`), y `buildCredalSet` lo sustituía en silencio
   por `a_j · 2` filtrando además por `Pl > 0,01` — el mismo "filtro semántico"
   que el módulo prohíbe explícitamente para el umbral 1e-10. Si el valor real
   superaba ese corte, quedaba fuera del conjunto credal y **H1 del Teo. 6.1
   dejaba de cumplirse**, invalidando cualquier certificado aguas abajo sin
   emitir señal alguna. *Corregido*: el soporte acotado es ahora una
   **hipótesis declarada** (`FrameOfDiscernment.domainBound`, validado en
   construcción) que viaja en el certificado como **H0**, y el truncamiento y
   el filtro han desaparecido. Ver [`docs/ERRATA.md`](docs/ERRATA.md) §5.
5. **Corregido el (4), el certificado se volvió vacuo.** La afirmación del paper
   "para la propagación zonotópica, el bound externo es suficiente" (Def. 3.9)
   es falsa en la práctica con H0 honesta: la válvula `δ_i` de la Def. 3.4 deja
   masa sobre Θ, Θ interseca la cola, y entonces `Pl(cola) ≥ Π δ_i ≈ 1e-4` —seis
   órdenes por encima del umbral 1e-10—, de modo que la Ec. (10) devuelve el
   rango completo del marco **independientemente de la evidencia**. Lluvia
   ligera y lluvia intensa producían el mismo intervalo credal, el mismo
   reachable set, el mismo veredicto y la misma severidad heurística. *Resuelto
   con una capa nueva*: `src/core/credal-propagation/` propaga **cada elemento
   focal con su masa** en lugar del soporte externo, y el certificado gana un
   segundo nivel demostrado `[Bel(E), Pl(E)]` que separa esos escenarios por más
   de tres órdenes de magnitud. El nivel existencial conserva su semántica
   intacta. Ver [`docs/ERRATA.md`](docs/ERRATA.md) §8.
6. **Cerrado el (3), el sistema abandonaba la regla de Dempster demasiado a
   menudo.** κ₁ = 0,3 y κ₂ = 0,7 fueron elegidos para el conflicto POR PARES,
   y `K_decision = máx(K_máx, K_global)` los aplicaba a una magnitud n-aria que
   crece con el número de fuentes y con la granularidad del marco **aunque no
   haya desacuerdo físico** (es `1 − Σ_j Π_i m_i(θ_j)` salvo Θ: basta que tres
   fuentes concordantes se repartan entre hipótesis contiguas por ruido
   instrumental). Medido: en mundos limpios y concordantes, solo el 54,1 %
   llegaba al Nivel 1 y el 15,6 % caía en envolvente. No era un fallo de
   soundness —el sistema pierde informatividad, que es la dirección
   conservadora— pero sí un punto de operación que el paper no declara.
   *Corregido con un experimento pre-registrado* (`npm run exp:conflict-rule`,
   semilla 20260311, distinta de la canónica): cuatro candidatos tras una
   interfaz común, requisito innegociable y criterio lexicográfico fijados antes
   de ver ningún resultado. Se seleccionó **C1** — κ₁/κ₂ contra el K_máx del
   paper, y K_global reducido a guardia de degeneración. La envolvente en mundos
   limpios cae al 4,6 % con la cobertura existencial intacta. Ver
   [`docs/ERRATA.md`](docs/ERRATA.md) §9.

### Límites conocidos de la garantía formal

- `propagateNonlinearAuto` estima la constante de Lipschitz de la jacobiana
  **por muestreo**: es empíricamente robusta pero no es una cota certificada.
  Para soundness formal hace falta una cota analítica de ‖∇²f‖ o aritmética de
  intervalos sobre el hessiano (ver TODO en `linearization.ts`). H3 del
  Teorema 6.1 se **asume**, no se verifica.
- La aritmética de intervalos usa coma flotante **sin redondeo dirigido hacia
  fuera**, de modo que la Prop. 4.1 se cumple hasta el error de redondeo (las
  properties lo verifican con tolerancia relativa 1e-12, y 1e-9 en la división).
- La regla de conflicto vigente (C1) garantiza `K_global < κ_deg = 0,95` en la
  rama de Dempster, lo que por (P2′) acota el factor `1/(1−K)` de cada paso por
  **20**. Es una cota mucho más laxa que el 1,43 de la regla anterior, aunque el
  peor factor observado en 15.000 mundos fue 1,443. Con n ≥ 4 fuentes o marcos
  mucho más finos, la regla C2 —disponible en `FusionConfig.rule`— tiene una
  cota estructuralmente mejor (2,04 con n = 3). Ver [`docs/ERRATA.md`](docs/ERRATA.md) §9.
- El bound de error de modelo ε_i de la Ec. (24) es ahora un campo obligatorio
  de `StructuralEquation` y la propagación aplica `⊕ [−ε_i, ε_i]` por
  construcción. Lo que **no** puede verificar el código es que cada ε_i esté
  bien calibrado (Def. 4.4): H2 del Teorema 6.1 se sigue asumiendo, pero ahora
  está declarada nodo a nodo y es auditable. El ε del DAG de la demo
  (`DEMO_H_MODEL_ERROR_BOUND` = 2,0 mm) está **declarado, no calibrado**: no
  hay aún serie histórica contra la que evaluar residuos.
- **H0 (soporte acotado) se asume, no se verifica.** El marco de discernimiento
  declara su dominio con `domainBound` (500 mm/h para precipitación, 500 km/h
  para viento: bounds conservadores de plausibilidad física, **no**
  calibraciones), y el intervalo credal de la Def. 3.9 nunca lo excede. Si el
  valor real lo supera, el conjunto credal no puede contenerlo *por
  construcción del marco*, y el motor no tiene forma de detectarlo —haría falta
  conocer el valor real—. Por eso H0 viaja en cada certificado junto a H1–H3, y
  `SafetyCertificate.domainBounds` registra qué bound se asumió para cada
  variable. H0 es lógicamente **previa** a H1: si H0 falla, H1 falla sin que
  ninguna evidencia pueda rescatarla. Ver
  [`docs/ERRATA.md`](docs/ERRATA.md) §5.
- Consecuencia operativa del punto anterior: con la hipótesis de cola plausible
  el intervalo credal llega hasta el `domainBound` y el veredicto **existencial**
  será casi siempre `unsafe-possible`. Es la señal correcta —la evidencia no
  descarta un evento extremo—, no un defecto del bound; estrecharlo es tarea de
  la evidencia, no del marco. Lo que **sí** distingue esos escenarios entre sí es
  el nivel probabilístico del certificado (ver arriba), que no estrecha el
  reachable set: conserva la masa que la Ec. (10) descartaba.
- El nivel probabilístico hereda las hipótesis del existencial y **ninguna
  más**, pero también sus límites: `Bel(E)` y `Pl(E)` son bounds sobre la
  probabilidad del evento **bajo H0–H3**. Si H2 falla (un ε_i mal calibrado) o
  H0 falla (un valor real por encima del `domainBound`), los bounds dejan de
  acotar nada, igual que el veredicto existencial deja de demostrar nada.
- El hull de un elemento focal **no contiguo** (p. ej. `{θ₀, θ₂}`) contiene
  puntos que no pertenecen a ninguna de sus hipótesis. Es sobre-aproximación
  deliberada y conservadora en ambos extremos; un tratamiento exacto exigiría
  propagar uniones de intervalos por el DAG, multiplicando el coste sin cambiar
  la dirección de la garantía.
- El DAG implementa la subclase de SCM con **ruido aditivo acotado**
  (`V_i = f_i(pa(V_i)) + U_i`, `|U_i| ≤ ε_i`), que es lo que la Ec. (24) y la
  demostración del Teo. 4.1 usan aunque la Def. 4.1 escriba `U_i` como
  argumento de `f_i`. Para errores no aditivos, `ε_i` debe acotar la
  discrepancia uniformemente sobre `[pa(V_i)]`. Declarado en el JSDoc de
  `causal-dag/types.ts`; ver [`docs/ERRATA.md`](docs/ERRATA.md) §4.
- `severityScore` (`decision/synthesis.ts`) es una heurística de priorización,
  **no** una probabilidad de violación. El veredicto formal lo da
  `certifySafety`, y la magnitud probabilística con respaldo formal es
  `certificate.probabilityBounds`. Sobre el escenario de la demo la heurística es
  literalmente idéntica (0,9631) para lluvia ligera y para lluvia intensa: no
  distingue lo que el nivel probabilístico separa en tres órdenes de magnitud.
  Se conserva solo para ordenar alarmas ya declaradas inseguras cuando no hay
  ruta credal.

## Cómo citar

Metadatos en [`CITATION.cff`](CITATION.cff) (versión 2.0.0).

## Licencia

[MIT](LICENSE). © 2026 INECO.
