# Erratas y extensiones de `papers/AURA_v2.pdf`

Registro estructurado de las discrepancias entre el paper normativo
(`papers/AURA_v2.pdf`, Marzo 2026) y la implementación de referencia, para su
resolución en la **v3**.

Cada entrada declara: **sección/ecuación**, **texto actual** (transcripción
literal del PDF), **problema**, **corrección propuesta** y **estado en el
código**. Se distinguen tres clases:

| Clase | Significado |
|-------|-------------|
| **ERRATA** | El paper dice algo incorrecto o contradictorio consigo mismo. Hay que cambiar el paper. |
| **EXTENSIÓN** | El paper no es incorrecto, pero es insuficiente: la implementación necesitó una definición nueva para ser sound. Candidata a proposición nueva. |
| **SALVEDAD** | El enunciado es correcto en ℝ; la implementación solo puede cumplirlo hasta un límite que el paper no declara. Hay que declararlo. |

La numeración de citas en el código está alineada con este PDF y debe
mantenerse así. Las "correcciones de numeración" que registra el `README.md`
(el conjunto credal citado como Def. 3.5 en vez de 3.8, etc.) **no** son
erratas del paper: eran errores del código, ya corregidos.

---

## 1 · Ecuación (7) — el exponente −1 invierte el sentido de los pesos

**Clase:** ERRATA
**Ubicación:** §3.4.2, Definición 3.6, Nivel 2 (media ponderada cautelosa), Ec. (7).

### Texto actual

> **Nivel 2: Conflicto moderado** (κ₁ < K_máx ≤ κ₂): Aplicar media ponderada
> cautelosa (cautious rule):
>
> ```
> m_fused(A) = Σ_{i=1}^{n} w_i · m_i(A),      w_i = (1 − δ_i)^{−1} / Σ_j (1 − δ_j)^{−1}      (7)
> ```
>
> donde los pesos favorecen fuentes con menor tasa de fallo. Esta regla no
> normaliza por conflicto y por tanto no sufre el problema de Zadeh.

### Problema

La fórmula y el texto que la acompaña se contradicen. Con el exponente −1, el
peso es **creciente** en δ_i:

| δ_i (tasa de fallo) | (1 − δ_i)^{−1} | peso relativo |
|---|---|---|
| 0,1 (fuente fiable)   | 1,11 | **menor** |
| 0,4 (fuente poco fiable) | 1,67 | **mayor** |

Es decir, la Ec. (7) tal como está escrita hace pesar MÁS a la fuente MENOS
fiable, exactamente lo contrario de lo que enuncia la frase siguiente y de la
función de δ_i como "válvula de seguridad" introducida en la Definición 3.4.

No afecta a la soundness (Proposición 3.2: cualquier combinación convexa de
BPAs es una BPA válida y sigue induciendo un conjunto credal), pero sí a la
informatividad y al sentido operativo de la regla: en el nivel de conflicto
moderado el sistema estaría escuchando preferentemente a la peor fuente.

### Corrección propuesta

```
w_i = (1 − δ_i) / Σ_j (1 − δ_j)                                              (7′)
```

Con ella, δ_i = 0 (fuente perfecta) maximiza el peso y δ_i → 1 (fuente que
falla siempre) lo anula, que es lo que el texto describe. Alternativa
equivalente en espíritu si se quiere preservar la forma con inversa: usar la
tasa de acierto en el denominador, w_i ∝ (δ_i)^{−1}, pero es peor condicionada
(diverge en δ_i = 0, el caso normal).

### Estado en el código

**Ya implementada la versión correcta (7′).** `cautiousCombine`
(`src/core/dempster-shafer/combination.ts`) calcula
`w_i = (1 − δ_i) / Σ_j (1 − δ_j)`, y `fuse` usa la misma fórmula para
`FusionResult.sourceWeights`. La discrepancia está documentada en el JSDoc de
`cautiousCombine`. Pendiente de confirmar con el autor y corregir el PDF.

---

## 2 · Definición 3.6 — decidir con el conflicto por pares no acota la reducción secuencial

**Clase:** EXTENSIÓN (no es errata: lo que dice el paper es cierto, pero no basta)
**Ubicación:** §3.4.2, Definiciones 3.5 y 3.6; §3.4.1, Ecuaciones (5)-(6).

### Texto actual

> **Definición 3.5 (Conflicto por pares).** Para n fuentes, la matriz de
> conflicto K ∈ [0,1)^{n×n} tiene entradas
> K_ij = Σ_{B∩C=∅} m_i(B)·m_j(C), i ≠ j,
> y el conflicto máximo del sistema es K_máx = máx_{i≠j} K_ij.
>
> **Definición 3.6 (Estrategia de fusión por nivel de conflicto).** […]
> **Nivel 1:** Bajo conflicto (K_máx ≤ κ₁): Aplicar regla de Dempster estándar.
> **Nivel 2:** Conflicto moderado (κ₁ < K_máx ≤ κ₂): […]
> **Nivel 3:** Alto conflicto (K_máx > κ₂): Abandonar fusión. […]

### Problema

Para n > 2 fuentes, la regla de Dempster se aplica por reducción secuencial
`(((m₁⊕m₂)⊕m₃)⊕…)`. **K_máx no acota el conflicto de esa reducción.** La BPA
acumulada se concentra a cada paso y su soporte puede volverse disjunto del de
una fuente aún no incorporada, aunque ningún par original estuviera cerca de 1.

**Contraejemplo minimizado** (fast-check, semilla 20260804, tras 4.508 casos;
fijado como test de regresión en
`__tests__/properties/dempster-validity.property.test.ts`). Marco de 3
hipótesis, tres fuentes en ciclo de solapamiento parcial:

```
m₁ = { {h₀}: 0,5 ; {h₁}: 0,5 }
m₂ = { {h₁}: 0,5 ; {h₂}: 0,5 }
m₃ = { {h₂}: 0,5 ; {h₀}: 0,5 }
```

Cada fuente comparte una hipótesis con la siguiente, pero las tres juntas no
comparten ninguna. Entonces:

- K₁₂ = K₁₃ = K₂₃ = **0,75** — ningún par es especialmente conflictivo.
- m₁ ⊕ m₂ concentra **toda** la masa en {h₁}, cuyo soporte es disjunto del de
  m₃ ⇒ el conflicto del segundo paso es **exactamente 1** y la regla de
  Dempster no está definida.

En este caso concreto la estrategia escalonada sí protegía el sistema, pero de
forma **accidental**: 0,75 > κ₂ = 0,7. Basta atenuar el ciclo con masa sobre Θ
(m_i = {a:0,4; b:0,4; Θ:0,2}) para que todos los pares bajen de κ₂ y el mismo
patrón entre en una rama que el paper reserva para conflicto menor. La
corrección del sistema no puede depender de que el conflicto por pares sea
representativo del conflicto n-ario.

### Corrección propuesta

Añadir a §3.4.2 el **conflicto global n-ario**, generalización directa del K de
la Ecuación (6) al producto conjunto de las n BPAs:

```
K_global = Σ_{A₁∩…∩Aₙ = ∅}  m₁(A₁) · m₂(A₂) · … · mₙ(Aₙ)                    (6′)
```

y sustituir K_máx por **K_decision = máx(K_máx, K_global)** en los tres niveles
de la Definición 3.6. Los umbrales κ₁ = 0,3 y κ₂ = 0,7 **no cambian**.

K_global se define sobre el producto conjunto, donde no hay orden: es
independiente de la permutación de las fuentes, coherentemente con la
conmutatividad y asociatividad de ⊕. Dos propiedades lo justifican como la
magnitud correcta (candidatas a **Proposición 3.3** en la v3):

> **(P1)** K_global ≥ K_ij para todo par i ≠ j.
> *Demostración.* A_i ∩ A_j = ∅ ⟹ A₁∩…∩Aₙ = ∅, luego la suma que define
> K_global contiene todos los términos de K_ij; y esos términos factorizan como
> K_ij · Π_{l≠i,j} (Σ_A m_l(A)) = K_ij · 1. ∎
>
> Corolario: K_decision = K_global. El máximo se conserva en el código solo por
> trazabilidad y robustez numérica.

> **(P2)** Si K_global < 1, ninguna reducción secuencial de Dempster alcanza
> conflicto total, **en ningún orden**.
> *Demostración.* K_global < 1 implica que existe (A₁,…,Aₙ) con m_i(A_i) > 0
> para todo i y S := A₁∩…∩Aₙ ≠ ∅. Para cualquier prefijo P, la BPA acumulada
> tiene masa > 0 sobre ∩_{i∈P} A_i ⊇ S ≠ ∅, conjunto que interseca al A_j de
> cualquier fuente restante (contiene S). Luego el K de ese paso es < 1. ∎

(P2) es lo que cierra el hallazgo **por construcción**: con κ₁ = 0,3 < 1, la
rama Dempster solo se alcanza con K_global ≤ 0,3, y entonces está demostrado
que ningún paso intermedio degenera. La protección deja de ser un accidente de
los umbrales.

**Coste.** K_global es exponencial en n (Π_i |F_i| combinaciones en el peor
caso, con poda al primer prefijo vacío). Aceptable en nuestro dominio: la demo
usa 3 fuentes (§7.2). El código expone un límite configurable
(`FusionConfig.maxSourcesForGlobalConflict`, por defecto 6) y **lanza** al
superarlo, en lugar de degradar en silencio a la decisión por pares.

### Estado en el código

**Implementada.** `globalConflict` y `assessConflict`
(`src/core/dempster-shafer/conflict.ts`); `FusionResult` expone `maxConflict`
(el K_máx literal del paper), `globalConflict` y `decisionConflict`.
Propiedades verificadas en `__tests__/properties/global-conflict.property.test.ts`.

**Impacto medido** sobre 20.000 casos generados (semilla 20260804,
2–4 fuentes): la estrategia cambia en **3.213 casos (16,1 %)**, todos hacia una
rama más conservadora. De los 7.996 casos que la Def. 3.6 literal enviaba a
Dempster, **1.133 (14,2 %)** dejan de hacerlo. Con n = 2 no cambia nada, como
exige (P1) con igualdad. En ninguno de esos 7.996 casos la reducción secuencial
llegaba a degenerar en alguna permutación, pero el K secuencial máximo
observado dentro del régimen "bajo conflicto" del paper fue **0,672** — más del
doble de κ₁ y al borde de κ₂.

---

## 3 · Proposición 4.1 — la soundness se cumple hasta el error de redondeo IEEE-754

**Clase:** SALVEDAD
**Ubicación:** §4.4.1, Proposición 4.1; Definición 4.2, Ecuaciones (20)-(23).

### Texto actual

> **Proposición 4.1 (Soundness de la aritmética de intervalos).** Si x ∈ [a] e
> y ∈ [b], entonces x ◦ y ∈ [a] ◦ [b] para ◦ ∈ {+, −, ·, /}. La extensión
> natural de una función f a intervalos satisface:
> {f(x) : x ∈ [a]} ⊆ f([a])
> Es decir, el intervalo resultado contiene todos los valores posibles. Puede
> sobre-estimar (el wrapping effect), pero nunca sub-estima.

### Problema

El enunciado es exacto en ℝ. En coma flotante IEEE-754 **sin redondeo
dirigido**, cada operación de las Ecuaciones (20)-(23) redondea al más cercano,
de modo que el extremo calculado puede caer *dentro* del intervalo exacto por
hasta 1 ulp. El "nunca sub-estima" es entonces cierto salvo un error relativo
del orden de 2⁻⁵³ por operación, que se acumula con la profundidad del DAG.

Para una implementación rigurosa haría falta redondeo hacia fuera (`nextafter`
en cada extremo, o una biblioteca de intervalos con control del modo de
redondeo). No es un defecto de la implementación actual, es una condición que
el paper no declara.

### Corrección propuesta

Añadir a §4.4.1, tras la Proposición 4.1, una observación:

> **Observación 4.x (Aritmética finita).** En una implementación con aritmética
> de coma flotante y redondeo al más cercano, la Proposición 4.1 se cumple
> hasta el error de redondeo: los extremos computados pueden diferir de los
> exactos en O(ulp) por operación. Una implementación rigurosamente sound
> requiere redondeo dirigido hacia fuera en cada extremo.

Y registrar el redondeo dirigido como **trabajo futuro** en §9.

### Estado en el código

**Documentado, no corregido.** Cabecera de
`src/core/intervals/arithmetic.ts`. Las tolerancias están cuantificadas por las
propiedades: **1e-12 relativo** en las operaciones de la Definición 4.2, y
**1e-9** en la división (peor condicionada cerca de 0), con la tolerancia
relativa a la magnitud de los operandos —
`withinTolerance` en `__tests__/properties/_config.ts`. La propagación por el
DAG (`__tests__/properties/dag-propagation.property.test.ts`) usa la misma
tolerancia relativa de 1e-9.

---

## 4 · Definición 4.1 vs. Ecuación (24) — el error de modelo se supone aditivo sin decirlo

**Clase:** ERRATA (menor, de rigor)
**Ubicación:** §4.2, Definición 4.1; §4.4.2, Definición 4.3 y Ec. (24); demostración del Teorema 4.1.

### Texto actual

> **Definición 4.3.** Para cada variable V_i con padres pa(V_i) y ecuación
> estructural **V_i = f_i(pa(V_i), U_i)**:
> ```
> [V_i] = f_i([pa(V_i)]) ⊕ [−ε_i, ε_i]                                       (24)
> ```
> donde f_i([·]) es la extensión natural intervalar de f_i, y [−ε_i, ε_i] es el
> bound del error de modelo U_i.

Y en la demostración del Teorema 4.1:

> El valor real es v*_i = f_i(v*_{j₁}, …, v*_{jₘ}, u_i) con |u_i| ≤ ε_i. Por
> soundness de la aritmética de intervalos,
> f_i(v*_{j₁}, …, v*_{jₘ}) ∈ f_i([V_{j₁}], …, [V_{jₘ}]). **Sumando el error de
> modelo:** v*_i ∈ f_i([pa(V_i)]) ⊕ [−ε_i, ε_i] = [V_i].

### Problema

La ecuación estructural declara U_i como **argumento** de f_i, pero la Ec. (24)
y el paso "sumando el error de modelo" lo tratan como un término **aditivo**.
Ambas cosas solo coinciden si f_i es de la forma

```
f_i(pa(V_i), U_i) = f̃_i(pa(V_i)) + U_i
```

Con un error no aditivo (p. ej. multiplicativo, V_i = f̃_i(pa)·(1 + U_i)), el
paso de la demostración es inválido tal cual: habría que acotar
|f_i(pa, u) − f̃_i(pa)| ≤ ε_i sobre todo el intervalo de los padres, no
|u_i| ≤ ε_i. La Definición 4.4 (calibración) sí es consistente con la lectura
aditiva, porque calibra sobre el residuo v_i^(k) − f_i(x^(k)).

### Corrección propuesta

Declarar explícitamente la hipótesis en la Definición 4.3:

> Se supone el error de modelo **aditivo**: V_i = f_i(pa(V_i)) + U_i con
> |U_i| ≤ ε_i. Para errores no aditivos, ε_i debe acotar la discrepancia
> |f_i(pa, U_i) − f_i(pa)| **uniformemente sobre [pa(V_i)]**, y la calibración
> de la Definición 4.4 debe hacerse sobre esa discrepancia.

### Estado en el código

**Implementada la lectura aditiva, y ahora es explícita.**
`StructuralEquation.compute` devuelve f_i([pa(V_i)]) y `modelErrorBound`
declara ε_i por separado; `propagateIntervals` aplica el ⊕ [−ε_i, ε_i]. Antes
de esta iteración el tipo no distinguía ambas cosas, de modo que la ambigüedad
del paper se heredaba en el código.

---

## 5 · Definición 3.9 / Ecuación (10) — el marco con cola infinita produce un intervalo credal no acotado

**Clase:** EXTENSIÓN (hallazgo nuevo de esta iteración; el código lo resuelve de forma NO sound)
**Ubicación:** §3.2, Definición 3.1 (marco de precipitación); §3.6, Definición 3.9 y Ec. (10); §6.1, Lema 6.1.

### Texto actual

> **Definición 3.1.** Θ = { [0,5), [5,15), [15,30), [30,60), **[60, ∞)** } mm/h
> — *nula, ligera, moderada, intensa, torrencial*.
>
> **Definición 3.9.** […] el intervalo credal continuo es
> I(X) = ⋃_{j : P̄(I_j) > 0} I_j.
> […] Para la propagación zonotópica, el bound externo es suficiente:
> X ∈ [ mín_{j: P̄(I_j)>0} a_j , máx_{j: P̄(I_j)>0} b_j ]                    (10)

### Problema

El marco de la Definición 3.1 es exhaustivo gracias a la cola **[60, ∞)**. En
cuanto la hipótesis *torrencial* tiene plausibilidad no nula —lo que ocurre
siempre que alguna fuente le asigne masa, o que cualquier fuente tenga masa
sobre Θ, que interseca a todas—, la Ecuación (10) devuelve **b = +∞**.

Un intervalo credal no acotado es correcto pero **inutilizable** aguas abajo:
la Capa 2 propaga `+∞` y produce `NaN` en cuanto aparece una resta o un
producto por 0 (Ecuaciones 21-22). El paper no dice qué hacer.

La implementación actual (`buildCredalSet`,
`src/core/dempster-shafer/credal-set.ts`) resuelve el problema **truncando**:
filtra las hipótesis con plausibilidad > **0,01** y, si la última sigue siendo
abierta, usa `upper = a_j · 2` (es decir, 120 mm/h para *torrencial*).

Esto **rompe H1 del Teorema 6.1 y el Lema 6.1**: un valor real de 200 mm/h
queda fuera del intervalo credal devuelto, y todo certificado emitido a partir
de él es inválido sin que nada lo señale. Además el umbral 0,01 es exactamente
el tipo de "filtro semántico" que el propio módulo prohíbe en un comentario
destacado unas líneas más arriba, a propósito del umbral 1e-10 de la Ec. (10).

### Corrección propuesta

Para el paper (§3.2 y §3.6): exigir que el marco usado para propagar sea
**acotado**, sustituyendo la cola [60, ∞) por [60, P_máx] con P_máx un máximo
físico justificado (p. ej. el récord de intensidad horaria registrado en la
región, con margen), y declarar que la exhaustividad de la Definición 3.1 se
mantiene *dentro del dominio de validez del modelo*. Alternativamente,
formalizar en la Definición 3.9 un bound de truncamiento explícito y añadir a
las hipótesis del Teorema 6.1 una H0: "el valor real está dentro del rango
físico declarado del marco".

Para el código: el bound superior debe ser un **parámetro declarado del marco**
(`FrameOfDiscernment.maxValue`), no una heurística derivada de los datos, y su
uso debe quedar registrado en el certificado igual que las hipótesis H1-H3.

### Estado en el código

**Registrado, no corregido.** Corregirlo cambia el intervalo credal de todos
los escenarios con cola plausible y afecta al pipeline completo, por lo que se
deja fuera de esta iteración. Se ha añadido la advertencia de soundness en
`buildCredalSet` y la entrada correspondiente en los "Límites conocidos" del
`README.md`.

---

## 6 · Teorema 5.1 — la cota L·r_Z²/2 supone la jacobiana exacta

**Clase:** SALVEDAD
**Ubicación:** §5.4, Teorema 5.1, Ecuaciones (28)-(29).

### Texto actual

> f(Z) ⊆ Z' = ⟨f(c), [ J·G | (L·r_Z²/2)·I_m ]⟩ , con ‖Df(x) − Df(c)‖ ≤ L·‖x − c‖
> para todo x ∈ Z.

### Problema

El término de error L·r_Z²/2 es el resto de Lagrange de la linearización **en
torno a la jacobiana exacta J = Df(c)**. Una implementación que calcule J por
diferencias finitas introduce un error adicional ≈ ε·|f| / (h·|∂f|) que la cota
no cubre. Con L ≈ 0 (funciones casi lineales) ese término domina y el zonotope
resultante puede ser **más estrecho** que f(Z) — soundness rota, con ratio de
conservatismo medido ρ̂ = 0,99999997 < 1.

### Corrección propuesta

Añadir a §5.4 una observación:

> **Observación 5.x.** Si J se calcula numéricamente, la cota del Teorema 5.1
> debe ampliarse con el error de la propia jacobiana: el término de error total
> es L·r_Z²/2 + ‖ΔJ‖·r_Z, con ‖ΔJ‖ una cota del error de estimación de J.

Y mantener explícito que **L estimada por muestreo no es una cota certificada**:
H3 del Teorema 6.1 se asume, no se verifica.

### Estado en el código

**Corregido** en `propagateNonlinearAuto`
(`src/core/zonotope/linearization.ts`): el error de la jacobiana se estima por
paso doble y se suma a la cota, junto con un suelo de redondeo. La limitación
de L por muestreo sigue documentada como límite conocido en el `README.md`.

---

## 7 · Definición 5.2 / Ecuación (27) — el lifting centro/radio no es exacto en coma flotante

**Clase:** SALVEDAD
**Ubicación:** §5.3, Definición 5.2 y Ec. (27) (Puente Capa 2 → Capa 3); Proposición 5.1 (= Lema 6.2, §6.2).

### Texto actual

El lifting de una caja de intervalos a zonotope usa c_i = (v̲_i + v̄_i)/2 y
generadores diagonales de radio r_i = (v̄_i − v̲_i)/2.

### Problema

Cuando el ancho del intervalo es menor que el ulp de su punto medio, el centro
redondeado más el radio (v̄−v̲)/2 **no cubre** el extremo superior. Ejemplo:
`[100, 100 + 1e-14]` produce el hull `[100, 100]`, y el testigo α de la
demostración de la Proposición 5.1 sale 2 ∉ [−1, 1].

### Corrección propuesta

Nota de implementación en §5.3: el radio debe tomarse como
r_i = máx(v̄_i − c_i, c_i − v̲_i), exacto por el lema de Sterbenz, y no como
(v̄_i − v̲_i)/2.

### Estado en el código

**Corregido** en `fromIntervals` (`src/core/zonotope/zonotope.ts`), con la
propiedad de cobertura verificada en
`__tests__/properties/bridge-2-3.property.test.ts`.

---

## Resumen de estados

| # | Entrada | Clase | Paper | Código |
|---|---------|-------|-------|--------|
| 1 | Ec. (7), pesos de la media cautelosa | ERRATA | pendiente | corregido |
| 2 | Def. 3.6, conflicto global n-ario | EXTENSIÓN | pendiente | implementado |
| 3 | Prop. 4.1, redondeo IEEE-754 | SALVEDAD | pendiente | documentado |
| 4 | Def. 4.1 vs Ec. (24), error aditivo | ERRATA | pendiente | explícito |
| 5 | Def. 3.9 / Ec. (10), cola infinita del marco | EXTENSIÓN | pendiente | **registrado, NO corregido** |
| 6 | Teo. 5.1, jacobiana numérica | SALVEDAD | pendiente | corregido |
| 7 | Def. 5.2 / Ec. (27), lifting en coma flotante | SALVEDAD | pendiente | corregido |
