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
npm run verify   # puerta completa: tipos → tests → properties → repro → snapshots
npm run repro    # solo la regeneración de resultados y figuras
```

`npm run verify` encadena seis pasos y para en el primer fallo:

| # | Paso | Qué comprueba |
|---|------|---------------|
| 1 | `npx tsc --noEmit` | Tipos |
| 2 | `npm run test:run` | Suite completa |
| 3 | `npm run test:properties` | Campaña de property-based testing |
| 4 | `npm run repro` | Regeneración de los cuatro escenarios |
| 5 | `npm run exp:smoke` | El contrato del runner de experimentos |
| 6 | `npm run snapshots:check` | `out/` **byte a byte** contra `snapshots/` |

### Escenarios

La ingesta lee de `fixtures/<escenario>/` en lugar de la red cuando se activa el
modo offline (`AURA_OFFLINE=1`, o `{ offline: true }` en la llamada). El modo por
defecto **no cambia**: sin esa señal, los clientes hacen `fetch`. Procedencia y
formato de cada fixture, en [`fixtures/README.md`](fixtures/README.md).

| Escenario | Precipitación (mm/h) | `K_global` | Método | Bel(E) | Pl(E) | Decisión |
|---|---|---|---|---|---|---|
| `s1-normal` | 0 / 0 / 0 | 0,0272 | dempster | 0 | 1,234e-4 | `warning` |
| `s2-light-rain` | 8 / 9 / 7,5 | 0,1844 | dempster | 0 | **1,559e-4** | `warning` |
| `s3-virga-conflict` | 3 / 18 / 25 | 0,9512 | envelope | 0 | 0,99997 | `critical` |
| `s4-extreme` | 45 / 46 / 44,5 | 3,32e-9 | dempster | 0,99988 | ≈ 1 | `critical` |

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

Columnas de `summary.csv`: `scenario`, `K_max`, `K_global`, `method`,
`credal_lower`, `credal_upper`, `reachable_lower`, `reachable_upper`, `status`,
`belLower`, `plUpper`, `decision`.

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
```

## Trazabilidad matemática

Cada módulo referencia definiciones, lemas y teoremas de `papers/AURA_v2.pdf`,
con su sección real:

| Módulo | Referencias normativas | Sección |
|--------|------------------------|---------|
| `dempster-shafer/types.ts` | Def. 3.1, 3.2, 3.3, 3.7, 3.8 *(+ `domainBound`, extensión)* | §3.2–3.5 |
| `dempster-shafer/frame.ts` | Def. 3.1 *(marco de soporte acotado, extensión)* | §3.2 |
| `dempster-shafer/bpa.ts` | Def. 3.3 y Ec. (1)-(2); Def. 3.4 y Ec. (3)-(4) | §3.2–3.3 |
| `dempster-shafer/conflict.ts` | Def. 3.5 y Ec. (6); Def. 3.6 *(+ K_global, extensión)* | §3.4 |
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
— todas pasan, en 99 s de reloj. La suite completa (`npm run test:run`) son 372
tests en 29 ficheros, y `npm run verify` entero, 109 s.

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
   conflicto **total** al tercer paso. *Cerrado por construcción*: la decisión
   usa ahora `K_decision = máx(K_máx, K_global)` con `K_global` el conflicto
   n-ario sobre el producto conjunto, y `K_global < 1` **demuestra** que ningún
   paso de la reducción degenera, en ningún orden (extensión del paper, ver
   [`docs/ERRATA.md`](docs/ERRATA.md) §2). La estrategia cambia en el 16,1 % de
   20.000 casos generados, siempre hacia una rama más conservadora.
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

### Límites conocidos de la garantía formal

- `propagateNonlinearAuto` estima la constante de Lipschitz de la jacobiana
  **por muestreo**: es empíricamente robusta pero no es una cota certificada.
  Para soundness formal hace falta una cota analítica de ‖∇²f‖ o aritmética de
  intervalos sobre el hessiano (ver TODO en `linearization.ts`). H3 del
  Teorema 6.1 se **asume**, no se verifica.
- La aritmética de intervalos usa coma flotante **sin redondeo dirigido hacia
  fuera**, de modo que la Prop. 4.1 se cumple hasta el error de redondeo (las
  properties lo verifican con tolerancia relativa 1e-12, y 1e-9 en la división).
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
