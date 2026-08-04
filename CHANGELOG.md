# Changelog

Registro de cambios de AURA v2, reconstruido desde el historial de git y
agrupado por iteraciones del proyecto. Cada iteración declara **qué cambió en el
motor**, **qué se corrigió** (con la causa en una línea) y **qué se midió**.

Las referencias `Def. X.Y`, `Ec. (N)`, `Prop. X.Y` y `Teo. X.Y` remiten a
`papers/AURA_v2.pdf` (marzo 2026). Las discrepancias entre ese paper y esta
implementación viven en [`docs/ERRATA.md`](docs/ERRATA.md), citado aquí por
número de entrada.

---

## [2.0.0-rc1] — 2026-08-04

Release candidate para la redacción del paper v3. El motor queda congelado: a
partir de aquí solo empaquetado, documentación y verificación.

---

### Iteraciones 1–3 — núcleo epistémico, conflicto global y registro de erratas

*(`1411939`, `0c979b2`, `770a554`)*

**Motor.** Primera implementación de las tres capas: aritmética de intervalos
(Def. 4.2), reachability por zonotopes con linearización (Teo. 5.1), combinación
de creencias Dempster-Shafer (Def. 3.2–3.6), propagación por el DAG causal
(Def. 4.3) y síntesis de decisión con certificado existencial (Def. 5.5). Capa
de datos con adaptadores AEMET, NASA POWER y Open-Meteo, con normalización.
Suite vitest sobre todo ello.

Se añade el **conflicto global n-ario** `K_global` (Ec. 6′, ERRATA §2), el bound
de error de modelo `ε_i` como campo propio de `StructuralEquation` (ERRATA §4) y
`docs/ERRATA.md` como registro estructurado de discrepancias con el paper.

**Corregido.**

- **La Def. 3.6 decidía con el conflicto por pares, que no acota la reducción
  secuencial de Dempster.** Causa: para *n* > 2 la BPA acumulada se concentra
  paso a paso y puede quedar disjunta de una fuente aún no incorporada aunque
  ningún par original esté cerca de 1.
- **Ec. (7): el exponente −1 invertía el sentido de los pesos de la media
  cautelosa.** Causa: `(1 − δ_i)^{−1}` es creciente en la tasa de fallo, luego
  pesaba más a la peor fuente — lo contrario de lo que enuncia el propio texto.
  Implementada la forma correcta `w_i = (1 − δ_i)/Σ_j (1 − δ_j)` (ERRATA §1).
- **El error de modelo `U_i` era argumento de `f_i` en la Def. 4.1 y término
  aditivo en la Ec. (24).** Causa: ambigüedad del paper heredada por un tipo que
  no distinguía `f_i([pa])` de `ε_i`. Se separan (ERRATA §4).
- **La cota `L·r_Z²/2` del Teo. 5.1 supone la jacobiana exacta.** Causa: con `J`
  numérica y `L ≈ 0` el error de la propia jacobiana domina y el zonotope podía
  salir más estrecho que `f(Z)`. `propagateNonlinearAuto` estima el error de `J`
  por paso doble y lo suma, con suelo de redondeo (ERRATA §6).
- **El lifting centro/radio de la Ec. (27) no cubría el extremo superior en coma
  flotante.** Causa: cuando el ancho es menor que el ulp del punto medio,
  `(v̄−v̲)/2` se queda corto. Se toma `r = máx(v̄−c, c−v̲)`, exacto por Sterbenz
  (ERRATA §7).

**Medido.** Ratio de conservatismo `ρ̂ = 0,99999997 < 1` en el caso casi lineal,
que es lo que destapó la salvedad de la jacobiana numérica.

---

### Iteración 4 — marcos de soporte acotado y H0 en el certificado (ERRATA §5)

*(`d282690`, `93939c1`, `91babbb`)*

**Motor.** El soporte acotado deja de ser un artefacto del cálculo y pasa a ser
hipótesis declarada del sistema:

- `FrameOfDiscernment.domainBound` (P_máx de la Def. 3.1′), **obligatorio y sin
  valor por defecto**; `createFrame`/`validateFrame` validan en construcción y
  `hypothesisUpper` da el `b_j` efectivo de la Ec. (10).
- `HYPOTHESIS_H0_BOUNDED_SUPPORT` y `CERTIFICATE_ASSUMPTIONS` (= H0 + H1–H3);
  `SafetyCertificate.domainBounds` registra el bound de cada variable de
  entrada, exigido como parámetro por `certifySafety`/`synthesizeDecision`.
  `THEOREM_6_1_HYPOTHESES` se conserva intacta como transcripción literal.

**Corregido.**

- **`buildCredalSet` truncaba el intervalo credal e invalidaba el Lema 6.1 en
  silencio.** Causa: la cola abierta `[60, ∞)` de la Def. 3.1 hacía que la
  Ec. (10) devolviera `+∞`, y el código lo resolvía filtrando `Pl > 0,01` y
  cortando en `a_j·2`. Un valor real de 200 mm/h quedaba fuera del conjunto
  credal sin señal alguna. Eliminados el filtro y el truncamiento; si el lifting
  sale no acotado, **lanza**.
- **El corte no era 120 mm/h sino, con frecuencia, mucho más ceñido.** Causa: el
  filtro `Pl > 0,01` se aplicaba ANTES de elegir la hipótesis de referencia, de
  modo que el truncamiento era más agresivo cuanto más concordante la evidencia
  (dos sensores en 9 mm/h → corte en 30 mm/h).
- **`createBPAFromGaussian` asumía la cola abierta en un segundo punto no
  registrado.** Causa: comprobaba `upper === Infinity` para dar `P(X < ∞) = 1`;
  cerrar el marco sin tocarlo habría repartido la masa sobrante entre todas las
  hipótesis vía la renormalización, inflando las centrales.
- **`WIND_FRAME` tenía el mismo defecto** (`huracán [120, ∞)`): el registro
  original solo mencionaba precipitación.

**Medido.** Coste de la corrección: el upper del marco de la demo pasa de 120 a
500 mm/h. Regresión que reproduce el algoritmo antiguo y comprueba el contraste
sobre un evento de 200 mm/h.

---

### Iteración 5 — propagación credal y certificado de dos niveles (ERRATA §8)

*(`77fe42d`, `30bcd52`, `afc3a8c`, `4298f93`, `890b7d0`)*

**Motor.** Módulo nuevo `src/core/credal-propagation/`: en lugar de un
intervalo, se propaga una **distribución de masa sobre intervalos** (Def. 3.9′ /
Ec. 10′), con coste lineal en el número de elementos focales y límite
configurable que **lanza** al superarse. `probabilityBounds` emite
`[Bel(E), Pl(E)]` (Def. 5.5′ propuesta, Prop. 5.3 demostrada en el JSDoc).

`certifySafety`/`synthesizeDecision` ganan un cuarto parámetro
`probabilityBounds`, **obligatorio aunque sea `null`** (BREAKING CHANGE), y
**lanzan** si los bounds contradicen el veredicto. Jerarquía resultante:
`status` (demostrado, existencial) → `probabilityBounds` (demostrado, continuo)
→ `severity` (heurístico, sin estatus formal).
`SafetySpec.unsafeProbabilityThreshold` y `CertifiedDecision.escalationBasis`
separan la escalada por bound demostrado de la escalada por heurística.

**Corregido.**

- **El nivel existencial era sound y vacuo: no distinguía una llovizna de un
  diluvio.** Causa: la Ec. (4) reserva masa `δ_i` sobre Θ, Θ interseca todas las
  hipótesis, y tras la fusión `Pl(cola) ≥ Π δ_i ≈ 1e-4` — seis órdenes de
  magnitud por encima del umbral 1e-10 de la Def. 3.9. La Ec. (10) devolvía el
  marco entero con independencia de la evidencia. La causa raíz no es `δ_i` ni
  el umbral: es que la Ec. (10) descarta la estructura credal y conserva solo el
  soporte.
- **`belLower` era estructuralmente 0 con el horizonte como ventana `[0, T]`.**
  Causa: `t = 0` da `h = h₀`, trivialmente seguro, luego ningún elemento focal
  queda contenido en la región insegura. El pipeline evalúa `h(t)` en el
  instante final `t = [2, 2]`; la opción de ventana sigue disponible y
  documentada.

**Medido.** Con el mismo veredicto existencial y la misma severidad heurística
(0,9631) en ambos escenarios:

| Escenario | Ec. (10) | Reachable | Def. 5.5 | Bel(E) | Pl(E) |
|---|---|---|---|---|---|
| ligera ~8 mm/h | [0, 500] | [−12, 992] | `unsafe-possible` | 0 | 1,559e-4 |
| intensa ~45 mm/h | [0, 500] | [−12, 992] | `unsafe-possible` | 0,99988 | ≈ 1 |

Property **B10** (cobertura credal end-to-end) sobre BPAs, marcos, DAGs y
regiones inseguras generados, con dos estimadores de la frecuencia: exacto en la
rama (sin holgura) y Monte Carlo puro con holgura de Hoeffding
(`2·exp(−2Nt²) = 8,3e-8`). Campaña `FC_SEED=20260804 FC_NUM_RUNS=20000`:
98/98 propiedades en 97 s, sin contraejemplos.

---

### Iteración 6 — ingesta offline, reproducibilidad y empaquetado

*(`3376858`, `911966b`, `718c1a5`, `0edd625`, `f1c00c0`, `e748fea`, `d14b945`)*

**Motor.** Modo offline (`AURA_OFFLINE=1`) en los clientes de `src/data/`, con
parseo separado del transporte y cuatro escenarios versionados en `fixtures/`.
`npm run repro` recorre el pipeline completo por escenario y escribe
`result.json`, `summary.csv` y figuras SVG generadas desde código puro, sin
navegador. Determinismo cerrado en `scripts/lib/canonical.ts`: claves ordenadas,
12 cifras significativas y no-finitos como cadena. Runner común de experimentos
con **semilla obligatoria por CLI** y salida canónica en
`out/experiments/<nombre>/`. `npm run verify` encadena tipos → tests →
properties → repro → smoke → snapshots, parando en el primer fallo. CI en push y
PR a `main`. LICENSE MIT y `CITATION.cff`.

**Corregido.**

- **`PRECTOTCORR` de NASA POWER se leía en mm/h siendo mm/day: un factor 24.**
  Causa: unidad del endpoint no verificada. Se corrige la conversión, se pasa al
  endpoint horario y se tratan los `fill_value` (−999) del reanálisis.
- **σ y δ de las fuentes estaban declarados dos veces y en desacuerdo** entre
  los clientes y `DEMO_SOURCES_LIGHT_RAIN`. Causa: duplicación sin fuente única.
  Se unifican en `src/data/sources/characterization.ts`, con test que bloquea el
  acuerdo.
- **`npm run snapshots:check` fallaba en un clon recién hecho sin que nada
  hubiera cambiado.** Causa: `core.autocrlf=true` (el default de Git en Windows)
  checkouteaba `snapshots/` con CRLF mientras `repro` generaba `out/` con LF.
  Fijado con `.gitattributes`.

**Medido.** El barrido `smoke` (200 intensidades verdaderas en `[0, 60)` mm/h)
da **un único** status existencial y **un único** reachable set mientras `Pl(E)`
recorre de 1,3e-4 a 1 y la decisión operativa cambia: la tesis de ERRATA §8
sobre un rango continuo. Dos ejecuciones consecutivas de `repro` dan bytes
idénticos.

---

### Iteración 7 — campaña de cobertura contra baselines clásicos

*(`e26ffd1`, `bf41b84`, `543480d`, `796fb6d`)*

**Motor.** Mundo sintético con ground truth (`scripts/experiments/lib/world.ts`):
`P*` de una mezcla declarada de cinco tramos con techo en 120 mm/h (H0 se cumple
por construcción, muy por debajo del `domainBound` de 500), cada fuente mide
`P* + sesgo + N(0, σ_i)` y falla con su `δ_i`; con probabilidad configurable el
mundo tiene conflicto físico tipo virga. σ_i y δ_i salen de
`characterization.ts` **sin tocar**. Cuatro estimadores sobre las mismas
realizaciones: `aura-existencial`, `aura-banda-95`, `media-ponderada` y
`kalman-estatico`. `ExperimentOutput.artifacts` da salida a figuras con rutas
validadas (relativas, sin `..`). Los tres experimentos entran en `verify` en
versión reducida (N=200, `--profile verify`) contra snapshots.

**Corregido.** Nada de motor: la iteración es instrumentación y medida. Se
registra en cambio la entrada **ERRATA §9** como SALVEDAD (ver iteración 8).

**Medido** (semilla 20260804):

- **Exp. 1** (N=10.000): los baselines están bien calibrados mientras su modelo
  se cumple (94,81 % y 95,34 % frente al 95 % nominal) y caen a **2,01 % /
  2,34 %** en cuanto **una sola** de las tres fuentes falla, sin que su intervalo
  se ensanche — `δ_i` entra en el peso, no en la varianza. El nivel existencial
  cubre el 100 % midiendo siempre 500 mm/h; la banda de evidencia, 99,97 %.
- **Exp. 2** (11 × N=2.000, violación de H1 de 0 % a 50 %): el nivel existencial
  **no degrada ni dentro de los mundos violados** (100 % en los once puntos) —
  es inmune porque es vacuo. La banda mantiene 99,7–100 % en mundos intactos y
  cae a ~35 % dentro de los violados.
- **Exp. 3** (N=5.000, virga): uno de cada tres mundos de virga pura (43,12 %)
  produce una media que **no contiene ni `P*` ni `γ·P*`**; AURA se queda en
  0,00 % / 0,02 %. La métrica es monótona en γ (19,7 % → 58,9 %).
- `verify` completo en 121 s.

---

### Iteración 8 — la regla de decisión del conflicto, por experimento pre-registrado

*(`829c01b`, `dd915b3`, `2e0bd06`, `70df216`, `f62a8a2`)*

**Motor.** Interfaz `ConflictDecisionRule` con cuatro candidatos —C0
`máx(K_máx, K_global)`, **C1** `K_máx` + guardia `K_global ≥ κ_deg = 0,95`, C2
`máx(K_máx, K_norm)`, C3 `C2 + guardia`— disponibles por `FusionConfig.rule`.
`DEFAULT_FUSION_CONFIG.rule = 'C1'`. **κ₁ = 0,3 y κ₂ = 0,7 no se mueven**: lo
único que cambia es qué magnitud se compara con ellos. `FusionResult` expone
`rule`, `decisionConflict`, `normalizedConflict` y `degeneracyGuard`, y esos
campos viajan a `result.json` y a `summary.csv`. Dos identidades nuevas
demostradas en el JSDoc de `globalConflict`: `(I1) 1 − K^(k) = U_{k+1}/U_k` y
`(I2) Π_k (1 − K^(k)) = 1 − K_global`, de donde `(P2′) K^(k) ≤ K_global` en
cualquier orden.

**Corregido.**

- **κ₁ y κ₂ estaban declarados para `K_máx` por pares y se reutilizaban para
  `K_global`, desplazando el punto de operación.** Causa: `K_global ≈ 1 −
  Σ_j Π_i m_i(θ_j)` es pequeño solo si las *n* fuentes concentran masa sobre la
  MISMA hipótesis, luego crece con *n* y con la dispersión aunque no exista
  desacuerdo físico: no distingue conflicto de discretización. Reclasificada de
  SALVEDAD a ERRATA DE DISEÑO y corregida (ERRATA §9, capa 1).
- **El denominador de la masa sobre Θ en el test del pipeline era `1 −
  K_decision`.** Causa: coincidía con `1 − K_global` mientras C0 decidía con
  `K_global`; la identidad (I2) dice cuál es la correcta.
- `testTimeout` global a 30 s: la regla nueva manda más escenarios a la rama de
  Dempster, que es la cara, y B10 cruzaba los 5 s por defecto.

**Medido.** Selección **pre-registrada** (requisito, criterio y candidatos
fijados antes de ejecutar nada) con semilla **20260311**, distinta de la
canónica, y criterio lexicográfico en un módulo probado aparte que **lanza** si
nadie supera los pasos 1–2.

- Fase A (15.000 mundos): ningún candidato descalificado; C1, C2 y C3 empatan y
  **decide el paso 5 — simplicidad → C1**. C1 ≡ C2 en los 15.000 mundos
  (empírico, no teorema); C3 ≡ C2 es teorema para `n ≤ 3` con frontera exacta en
  `n − 1 < ln(1−κ_deg)/ln(1−κ₂) = 2,4882`. *(Esta tabla es un registro histórico
  bajo la medida D0; ver la nota de reproducibilidad de la iteración 10.)*
- Fase B (semilla canónica 20260804): en mundos limpios la envolvente cae de
  **15,6 % a 4,6 %** y el Nivel 1 sube de 54,1 % a 58,8 %; anchura media de la
  banda −9,4 %. **Pagado:** cobertura de banda-95 de 99,97 % a 99,91 % (piso
  pre-registrado: 99,5 %); un conflicto n-ario real con pares moderados baja de
  Nivel 3 a Nivel 2; la cota teórica sobre `1/(1−K)` se relaja de 1,43 a 20
  (peor valor observado: 1,443). **Cobertura existencial intacta: 100,00 % en
  las tres campañas y bajo las cuatro reglas.**
- Harness: ningún escenario cambia de método ni de veredicto; s2 sigue dando
  `plUpper = 1,559438e-4`. Barrido `smoke`: 116/47/37 → **126/65/9** (D/C/E),
  tres escenarios bajan de `critical` a `warning`, 0 violaciones de bounds.

---

### Iteración 9 — hindcast sobre dos eventos reales

*(`9b8bd78`, `8a508f4`, `144b9a6`, `aeaf64c`, `e1a1b2d`)*

**Motor.** Caracterización a priori de las tres fuentes del hindcast, declarada
y bloqueada por test **antes** de ejecutar el pipeline sobre un solo dato real:
dos reglas cerradas y un único parámetro por fuente (el lado de celda), `σ_P`
lineal en `L` y `σ_T` en `√L`, sin ningún número escrito a mano. Captura
versionada de dos eventos (DANA Valencia, 96 h; Filomena Madrid, 168 h) desde un
único punto del repositorio que toca la red. Pipeline horario completo por
evento con sus cuatro figuras, más los dos baselines sobre los mismos valores —
`methods.ts` se generaliza en vez de reimplementarlos. El hindcast reducido a
las 24 h del pico de E1 entra en `verify` contra snapshots.

**Corregido.**

- **`ERA5-Land` no sirve precipitación en el Archive de Open-Meteo.** Causa:
  devuelve `null` en las 264 horas (también `rain` y `snowfall`); solo hay
  temperatura. Se versiona el fichero como evidencia reproducible de la ausencia
  y se sustituye por el análisis operativo del IFS (~9 km).
- **`PRECTOTCORR` horario de NASA POWER está en mm/day, no en mm/h.** Causa: la
  misma unidad de la iteración 6, ahora **comprobada** contra el endpoint diario
  de la misma ventana (21,864 frente a 21,86; razón suma/diario = 24,00 en los
  cuatro días) en lugar de fiarse del comentario. Si fallara, la captura aborta.

Tres decisiones registradas: una hora entra solo si las **tres** fuentes tienen
dato válido (imputar inventaría una tercera medición concordante, bajaría el
conflicto y estrecharía el credal — error en dirección no conservadora e
invisible); la alineación LST/UTC de POWER se **comprueba**; y la ventana de
pico del perfil `verify` se calcula solo con datos de entrada.

**Medido.** 96 + 168 horas, **0 excluidas por huecos**. Los dos baselines tienen
anchura constante en las 264 horas (14,80 y 6,55 mm/h) porque depende solo de σ
y δ, nunca de la evidencia; en la hora de máximo desacuerdo de E1 el Kalman deja
fuera a **dos de las tres fuentes** que dice resumir.

**El hallazgo que los mundos sintéticos no habían mostrado.** Con tres fuentes
midiendo *exactamente lo mismo* y σ = 5,0 / 1,8 / 10,0 mm/h, `K_máx` vale
**0,365 > κ₁**: un **suelo estructural** que no procede de ningún desacuerdo,
sino de que BPAs con σ dispares reparten la misma medición de forma distinta
sobre el marco. La rama de Dempster resultó **inalcanzable en 264 de 264 horas**,
y el mínimo observado coincide con el suelo (a 2·10⁻⁴ en E1, exactamente en E2).
Se registró como **limitación medida, no como corrección**: ninguna de las
reglas C0–C3 lo aborda, porque las cuatro comparan una magnitud con umbrales
fijos y el problema está en el par (magnitud, umbral). **Las σ no se tocaron** —
retocarlas a la vista del resultado es justo lo que la declaración a priori
existe para impedir.

Determinismo comprobado aparte: dos ejecuciones de `exp:hindcast` desde fixtures
dan los 14 ficheros byte a byte idénticos.

---

### Iteración 10 — la medida por pares del conflicto, por experimento pre-registrado

*(`c1737cc`)*

**Motor.** Se separa la **medida** por pares (con qué se puntúa un par) de la
**regla** (qué se hace con esa magnitud, corregida en la iteración 8). Interfaz
`PairwiseConflictMeasure` con tres candidatas: **D0** (`K` crudo, Ec. 6),
**D1** (exceso normalizado sobre el suelo) y **D2** (distancia de Jousselme
`d_J` sobre la matriz de Jaccard). `DEFAULT_FUSION_CONFIG.measure = 'D2'`.
`FusionResult` expone `measure`, `measureConflict`, `measureMatrix` y
`floorMatrix`.

**Separación estructural, no negociable:** la medida gobierna **solo** la
comparación con κ₁/κ₂. La **guardia de degeneración** sigue operando sobre el
`K_global` **crudo**, porque la explosión `1/(1−K)` que (P2)/(P2′) previenen es
propiedad del K crudo y una medida que reste un suelo puede acercarse a 0 con
`K_global ≈ 1`. C0, C2 y C3 quedan **congeladas sobre D0** — existen para
reproducir números publicados, y una regla congelada que cambiara de significado
al cambiar la medida no reproduciría nada.

**Corregido.**

- **El suelo estructural que el hindcast midió: κ₁ y κ₂ se aplicaban a una
  medida que no es cero con acuerdo perfecto.** Causa: `K_ij` crudo entre BPAs
  gaussianas con σ heterogéneas es > 0 sin desacuerdo físico alguno, y ese suelo
  (0,3651) supera κ₁ = 0,3 (ERRATA §9, capa 3).

**Medido.** Selección **pre-registrada** con semilla **20261007** y criterio
lexicográfico de 7 pasos en un módulo probado aparte.

> **Advertencia de honestidad, registrada en código, en la salida del
> experimento y en la documentación:** los resultados del hindcast **ya eran
> conocidos**. La selección se hizo **exclusivamente sobre mundos sintéticos con
> ground truth**; el bloque «σ del hindcast» usa esas σ sobre mundos sintéticos
> nuevos, no sobre los datos reales. El hindcast se re-ejecutó después **solo
> como descripción** y **no es una validación ciega**.

- Fase A (20.000 mundos): las tres pasan el requisito innegociable. **D1 queda
  descalificada en el paso 2** —cobertura de banda-95 del 99,48 % frente al piso
  pre-registrado del 99,5 %— pese a ser la candidata natural y la que mejor
  resuelve el problema declarado (anula el suelo de forma exacta y lleva el
  100 % de los mundos concordantes a Dempster). **El criterio no se relajó.**
  **D2 gana el paso 4 en solitario** (59,66 % frente a 9,90 % de D0).
- Fase B (semilla canónica 20260804): mundos limpios → Dempster 58,8 % → 65,9 %;
  anchura media de banda 276,51 → 250,18 mm/h. **Pagado:** cobertura de banda-95
  99,91 % → 99,72 %; virga «ni P\* ni γ·P\*» 0,04 % → 0,06 % (3 mundos de
  5.000); el peor `K_global` en la rama Dempster pasa de 0,4369 a 0,8024 y el
  peor factor `1/(1−K)` de 1,442 a **2,631**. **Cobertura existencial intacta:
  100,00 % en las tres campañas, bajo las tres medidas y en los once puntos del
  barrido de H1.**
- Fase C (descripción, no validación): Dempster pasa de **0 % a 76,0 %** en E1 y
  a **99,4 %** en E2. Los cuatro bloques `critical` de E1 **no se mueven** —hora
  por hora— y siguen a la lluvia (4,09 mm/h de media frente a 0,37). Las **dos
  horas `critical` de E2 eran un artefacto del suelo** y desaparecen: tres
  fuentes de acuerdo (1,4 / 2,1 / 1,58 mm/h) escalaban por conflicto de
  discretización, y su `plUpper` cae de 5,04e-2 a 1,06e-4.
- Hallazgo colateral: **`d_J` no está acotada por el K crudo en ninguna
  dirección.** En s4 `K_máx = 3,2e-9` y `d_J = 0,0447`, y un escenario del
  barrido `smoke` **escala** de cautelosa a envolvente. La corrección no es
  «relajar»; es medir otra cosa.

**Nota de reproducibilidad — la Fase A de la iteración 8 quedó fechada.**
Detectada en la verificación de cierre de la rc1, sin impacto en soundness.
`scripts/experiments/conflict-rule.ts` construye la configuración de cada
candidato como `{ ...DEFAULT_FUSION_CONFIG, rule }` en lugar de pasar por
`fusionConfigFor`, de modo que hereda la **medida por defecto del sistema**. Al
cambiar ese defecto de D0 a D2, y siendo C1 la única regla que consulta la
medida (C0, C2 y C3 están congeladas sobre el K crudo), **solo la fila de C1 se
mueve** al re-ejecutar `npm run exp:conflict-rule` hoy:

| | limpios → Dempster | anchura banda-95 | cobertura banda-95 |
|---|---:|---:|---:|
| C0, C2, C3 | 53,49 % / 57,62 % / 57,62 % | 296,99 / 280,67 / 280,67 | 99,910 / 99,840 / 99,840 % |
| C1 publicado (bajo D0) | 57,62 % | 280,67 | 99,840 % |
| **C1 hoy (bajo D2)** | **64,95 %** | **252,77** | **99,710 %** |

Consecuencias, en orden de importancia:

1. **La selección no cambia: sigue ganando C1.** Lo que cambia es el paso del
   criterio que la decide — del paso 5 (desempate por simplicidad, empatado con
   C2 y C3) al **paso 3** (mayor fracción de limpios → Dempster, sin empate).
   Los cuatro candidatos siguen pasando el requisito innegociable y la cobertura
   existencial sigue en **100,00 % para los cuatro**.
2. **La tabla de la Fase A publicada en ERRATA §9 no es reproducible desde la
   CLI a los defaults de hoy**, y `exp:conflict-rule` **no acepta `--measure`**:
   el flag se ignora en silencio. La tabla debe leerse como registro histórico
   bajo D0 — que es lo único que existía cuando se produjo—, no como salida
   actual del comando.
3. **`config.json` de `conflict-rule` no registra la medida** (sí registra
   `rule`, κ₁, κ₂ y κ_deg), de modo que un `results.json` recién generado no
   declara bajo qué medida se produjo su columna C1. Es justo la clase de traza
   incompleta contra la que advierte el JSDoc de `fusionConfigFor`.

Se deja **registrado y no corregido** en la rc1: tocarlo es cambiar lógica de un
experimento, no empaquetar. La corrección natural para la v3 es pasar por
`fusionConfigFor`, aceptar `--measure` y añadir la medida a `config.json`.

---

## Known limitations

Lo que el motor **no** demuestra, extraído de [`docs/ERRATA.md`](docs/ERRATA.md)
y de los JSDoc del código. Ninguna de estas se ha cerrado en la rc1.

1. **La constante de Lipschitz se estima por muestreo, con safety factor — no es
   una cota certificada.** `estimateLipschitz`
   (`src/core/zonotope/linearization.ts`) toma el máximo sobre pares muestreados
   multiplicado por `safetyFactor` (1,5 por defecto, y **lanza** si es < 1). Es
   empíricamente robusta, pero no es un hessiano intervalar: cerrar el hueco del
   Teo. 5.1 exigiría una cota analítica de `‖∇²f‖` sobre `Z` o aritmética de
   intervalos sobre el hessiano (TODO explícito en `linearization.ts`).
   **H3 del Teorema 6.1 se asume, no se verifica.** (ERRATA §6.)

2. **La aritmética de intervalos usa coma flotante sin redondeo dirigido hacia
   fuera.** La Prop. 4.1 es exacta en ℝ; en IEEE-754 con redondeo al más
   cercano, cada operación de las Ec. (20)-(23) puede meter el extremo calculado
   *dentro* del intervalo exacto por hasta 1 ulp, y el error se acumula con la
   profundidad del DAG. **Las tolerancias están cuantificadas por las
   properties:** 1e-12 relativo en las operaciones de la Def. 4.2 y **1e-9** en
   la división (peor condicionada cerca de 0), con la tolerancia relativa a la
   magnitud de los operandos (`withinTolerance`, `__tests__/properties/_config.ts`);
   la propagación por el DAG usa la misma 1e-9. Una implementación rigurosamente
   sound requiere `nextafter` en cada extremo o una biblioteca con control del
   modo de redondeo. (ERRATA §3.)

3. **`d_J` no elimina el suelo de σ heterogéneas: solo elimina el
   auto-conflicto.** D2 baja el suelo con acuerdo perfecto de 0,3651 a 0,2727 —
   por debajo de κ₁— pero **no lo anula**, y no está acotada inferiormente por
   él: bajo D2 el mínimo observado en E1 cae a 0,1297, por debajo del suelo de
   referencia, porque `d_J` no es un residuo que se reste. La candidata que sí
   anulaba el suelo de forma exacta, **D1, quedó descalificada por cobertura**
   (banda-95 del 99,48 % frente al piso pre-registrado del 99,5 %), y el criterio
   no se relajó. Corolario que sigue abierto: **κ₁ y κ₂ no son transportables
   por sí solos** — D2 elimina la dependencia de la heterogeneidad de σ, pero los
   umbrales siguen declarados para un marco de discernimiento concreto, y un
   despliegue con otro marco debe volver a justificarlos. (ERRATA §9, capas 2
   y 3.)

4. **`belLower` es estructuralmente 0 con el horizonte tomado como ventana
   temporal `[0, T]`.** Con `t = 0` el nivel del agua es `h = h₀`, trivialmente
   seguro, luego **ningún** elemento focal puede quedar contenido en la región
   insegura, para cualquier evidencia — incluido un diluvio. No es un fallo del
   nivel probabilístico (`Bel(E) = 0` es cierto: existen instantes seguros en la
   ventana) y `plUpper` sigue siendo informativo, pero el evento deja de ser el
   que interesa operativamente. El pipeline de la demo evalúa por tanto `h(t)` en
   el instante final `t = [2, 2]`; la ventana completa sigue disponible y da
   bounds igualmente sound, con `belLower = 0` por esta razón. (JSDoc de
   `src/core/pipeline/demo-pipeline.ts`.)

5. **El hindcast no es ciego, y su medida se seleccionó solo sobre mundos
   sintéticos.** Los resultados del hindcast bajo D0 ya eran conocidos cuando se
   diseñó `exp:conflict-floor`. La selección de D2 se hizo **exclusivamente
   sobre mundos sintéticos con ground truth**, con semilla propia (20261007) y
   criterio pre-registrado; el bloque «σ del hindcast» usa esas σ sobre mundos
   sintéticos nuevos. El hindcast se re-ejecutó **después y solo como
   descripción**. Ninguna cifra de la Fase C puede presentarse como confirmación
   independiente de la medida elegida, y así consta en `results.selectionDisclosure`,
   en `scripts/experiments/README.md` y en ERRATA §9. En el mismo sentido, el
   hindcast entero es un ejercicio **ilustrativo**: no muestra —ni puede— que
   AURA «habría evitado» ni «habría predicho» nada.

6. **Las tres fuentes del hindcast no son independientes: son reanálisis.** ERA5
   (~25 km), el análisis operativo del IFS (~9 km) y MERRA-2 vía NASA POWER
   (~50 km) **comparten observaciones asimiladas**, luego la independencia que la
   fusión Dempster-Shafer supone no se cumple en sentido estricto. Tampoco hay
   ground truth: los tres productos son mallas de reanálisis, no el valor en el
   punto. Añádase el caveat obligatorio de E2: la precipitación de Filomena fue
   mayoritariamente **nieve** (53,6 % de las horas bajo cero en las tres fuentes
   a la vez, mínimo −12,03 °C) y el DAG de la demo modela inundación por lluvia,
   de modo que todo `h`, `plUpper` y decisión de E2 describe lo que el pipeline
   diría **si aquello hubiera sido lluvia**.

### Otras limitaciones registradas

7. **H0 (soporte acotado) se asume, no se verifica.** El marco declara su dominio
   con `domainBound` (500 mm/h y 500 km/h: bounds conservadores de plausibilidad
   física, **no** calibraciones) y el intervalo credal nunca lo excede. Si el
   valor real lo supera, el conjunto credal no puede contenerlo *por construcción
   del marco*, y el motor no puede detectarlo. H0 es lógicamente **previa** a H1.
   Consecuencia operativa: con la hipótesis de cola plausible el veredicto
   existencial será casi siempre `unsafe-possible` — es la señal correcta, no un
   defecto del bound. (ERRATA §5.)

8. **H2 se sigue asumiendo: `ε_i` es obligatorio pero no calibrable por el
   código.** La propagación aplica `⊕ [−ε_i, ε_i]` por construcción, pero nada
   verifica que cada `ε_i` esté bien calibrado (Def. 4.4). El `ε` del DAG de la
   demo (`DEMO_H_MODEL_ERROR_BOUND` = 2,0 mm) está **declarado, no calibrado**:
   no hay serie histórica contra la que evaluar residuos. (ERRATA §4.)

9. **El nivel probabilístico hereda H0–H3 y ninguna más — incluidos sus
   límites.** Si H2 o H0 fallan, `Bel(E)` y `Pl(E)` dejan de acotar nada, igual
   que el veredicto existencial deja de demostrar nada. (ERRATA §8.)

10. **El hull de un elemento focal no contiguo sobre-aproxima.** `{θ₀, θ₂}`
    contiene puntos que no pertenecen a ninguna de sus hipótesis. Es
    sobre-aproximación deliberada y conservadora en ambos extremos; el
    tratamiento exacto exigiría propagar uniones de intervalos por el DAG.
    (ERRATA §8.)

11. **El DAG implementa solo la subclase de SCM con ruido aditivo acotado**
    (`V_i = f_i(pa(V_i)) + U_i`, `|U_i| ≤ ε_i`). Para errores no aditivos, `ε_i`
    debe acotar la discrepancia **uniformemente sobre `[pa(V_i)]`**. (ERRATA §4;
    JSDoc de `src/core/causal-dag/types.ts`.)

12. **La cota teórica de C1 sobre `1/(1−K)` es 20, no 1,43.** C1 garantiza
    `K_global < κ_deg = 0,95` en la rama de Dempster, cota mucho más laxa que la
    de C0. El peor factor observado fue 1,443 en la iteración 8 y **2,631** tras
    adoptar D2. Con `n ≥ 4` fuentes o marcos mucho más finos, C2 —disponible en
    `FusionConfig.rule`— tiene una cota estructuralmente mejor (2,04 con n = 3).
    (ERRATA §9.)

13. **`severityScore` es una heurística de priorización, no una probabilidad de
    violación.** Sobre la demo vale literalmente lo mismo (0,9631) para lluvia
    ligera y para lluvia intensa: no distingue lo que el nivel probabilístico
    separa en tres órdenes de magnitud. Se conserva solo para ordenar alarmas ya
    declaradas inseguras cuando no hay ruta credal. (README, §Límites conocidos.)
