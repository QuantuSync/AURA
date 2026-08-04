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

y usarlo para acotar la reducción secuencial. Esta entrada propuso además
sustituir K_máx por **K_decision = máx(K_máx, K_global)** en los tres niveles de
la Definición 3.6, con κ₁ = 0,3 y κ₂ = 0,7 sin cambio.

> ⚠ **Esa segunda parte fue revisada por la entrada 9.** Aplicar los umbrales
> del par a K_global desplaza el punto de operación de un modo que depende de n
> y de la granularidad del marco. El experimento pre-registrado
> `npm run exp:conflict-rule` sustituyó la regla `máx(K_máx, K_global)` (hoy
> «C0») por la regla **C1**: κ₁/κ₂ vuelven a compararse con el K_máx por pares,
> y K_global se conserva como **guardia de degeneración** (K_global ≥ κ_deg =
> 0,95 ⟹ envolvente). Lo que sigue vigente de esta entrada es K_global como
> magnitud —su definición, (P1), (P2) y la nueva (P2′)—, no la regla de
> decisión que se construyó con él. Ver la entrada 9.

K_global se define sobre el producto conjunto, donde no hay orden: es
independiente de la permutación de las fuentes, coherentemente con la
conmutatividad y asociatividad de ⊕. Dos propiedades lo justifican como la
magnitud correcta (candidatas a **Proposición 3.3** en la v3):

> **(P1)** K_global ≥ K_ij para todo par i ≠ j.
> *Demostración.* A_i ∩ A_j = ∅ ⟹ A₁∩…∩Aₙ = ∅, luego la suma que define
> K_global contiene todos los términos de K_ij; y esos términos factorizan como
> K_ij · Π_{l≠i,j} (Σ_A m_l(A)) = K_ij · 1. ∎
>
> *Vigente sin cambios.* Es una propiedad de K_global, no de la regla de
> decisión. Lo que CAYÓ con la entrada 9 es su antiguo corolario
> «K_decision = K_global», que solo describía a la regla C0.

> **(P2)** Si K_global < 1, ninguna reducción secuencial de Dempster alcanza
> conflicto total, **en ningún orden**.
> *Demostración.* K_global < 1 implica que existe (A₁,…,Aₙ) con m_i(A_i) > 0
> para todo i y S := A₁∩…∩Aₙ ≠ ∅. Para cualquier prefijo P, la BPA acumulada
> tiene masa > 0 sobre ∩_{i∈P} A_i ⊇ S ≠ ∅, conjunto que interseca al A_j de
> cualquier fuente restante (contiene S). Luego el K de ese paso es < 1. ∎

> **(P2′)** *(nueva, entrada 9)* El conflicto de **cada** paso de la reducción
> secuencial cumple K^(k) ≤ K_global, en cualquier orden. Más aún, con
> U_k := 1 − K_global(m₁,…,m_k),
>
> ```
> 1 − K^(k) = U_{k+1} / U_k        (I1)      Π_{k=1}^{n−1} (1 − K^(k)) = 1 − K_global   (I2)
> ```
>
> *Demostración.* La BPA acumulada tras k pasos es m^(k)(B) = ũ_k(B)/U_k, con
> ũ_k la masa sin normalizar sobre la intersección B ≠ ∅. Entonces
> 1 − K^(k) = Σ_{B∩A≠∅} m^(k)(B)·m_{k+1}(A) = U_{k+1}/U_k, que es (I1); (I2) es
> su telescopio con U_1 = 1. Como U_k ≤ 1 y U es decreciente en k,
> 1 − K^(k) = U_{k+1}/U_k ≥ U_{k+1} ≥ U_n = 1 − K_global. ∎

(P2) es el caso débil de (P2′) y es lo que cierra el hallazgo **por
construcción**: cualquier regla de decisión que garantice una cota
K_global ≤ B < 1 en la rama Dempster impide que un paso intermedio degenere, y
(P2′) añade que ninguno supera esa misma B — con lo que el factor 1/(1−K) de la
Ecuación (5) queda acotado por 1/(1−B). La protección deja de ser un accidente
de los umbrales, y deja también de depender de QUÉ regla se use: las cuatro de
`src/core/dempster-shafer/conflict-rules.ts` declaran su B (§9).

(I2) tiene además una consecuencia que la entrada 9 explota: 1 − K_global es el
producto de los (n−1) factores (1 − K^(k)), luego 1 − (1−K_global)^{1/(n−1)} es
la **media geométrica** del conflicto por paso, expresada en la escala del par.
No es una analogía; es una identidad.

**Coste.** K_global es exponencial en n (Π_i |F_i| combinaciones en el peor
caso, con poda al primer prefijo vacío). Aceptable en nuestro dominio: la demo
usa 3 fuentes (§7.2). El código expone un límite configurable
(`FusionConfig.maxSourcesForGlobalConflict`, por defecto 6) y **lanza** al
superarlo, en lugar de degradar en silencio a la decisión por pares.

### Estado en el código

**Implementada.** `globalConflict` y `assessConflict`
(`src/core/dempster-shafer/conflict.ts`); `FusionResult` expone `maxConflict`
(el K_máx literal del paper), `globalConflict`, `rule`, `decisionConflict`,
`normalizedConflict` y `degeneracyGuard`.
Propiedades verificadas en `__tests__/properties/global-conflict.property.test.ts`,
hoy parametrizadas por regla. La regla de decisión que esta entrada proponía es
la «C0» de `conflict-rules.ts`; el sistema usa **C1** desde la entrada 9.

**Impacto medido** de la regla C0 frente a la Definición 3.6 literal, sobre
20.000 casos generados (semilla 20260804,
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

**Clase:** EXTENSIÓN — candidata a **modificación de la Definición 3.1 y del
Teorema 6.1** en la v3.
**Ubicación:** §3.2, Definición 3.1 (marco de precipitación); §3.6, Definición 3.9 y Ec. (10); §6.1, Lema 6.1; §6.3, Teorema 6.1.

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

**Ampliación del hallazgo** (encontrada al corregirlo, no en el registro
original):

1. **El corte no era siempre 120 mm/h; con frecuencia era mucho más ceñido.**
   El filtro `Pl > 0,01` se aplicaba ANTES de elegir la hipótesis de referencia.
   Cuando la cola *torrencial* tenía plausibilidad no nula pero pequeña —el caso
   normal, porque la masa sobre Θ interseca a todas las hipótesis y produce
   Pl ≈ 1e-3 en la cola—, el filtro la descartaba y el bound caía al `upper`
   finito de la última hipótesis superviviente. Dos sensores concordando en
   9 mm/h daban así un intervalo credal cortado en **30 mm/h**, no en 120. El
   truncamiento era, por tanto, más agresivo cuanto más concordante la
   evidencia. Fijado como test de regresión en
   `__tests__/core/dempster-shafer/frame.test.ts`.
2. **La cola abierta se asumía en un segundo punto del código, no registrado.**
   `createBPAFromGaussian` comprobaba `upper === Infinity` para dar
   `P(X < ∞) = 1` a la hipótesis de cola. Cerrar el marco sin tocar ese punto
   habría hecho que la masa gaussiana por encima del `domainBound` dejara de
   pertenecer a la cola y se repartiera proporcionalmente entre TODAS las
   hipótesis vía la renormalización final — inflando en silencio la creencia en
   las hipótesis centrales. Corregido: las hipótesis extremas absorben las colas
   fuera del dominio del marco, que es la lectura condicionada a H0.
3. **El marco de viento tenía el mismo defecto.** `WIND_FRAME` cierra con
   *huracán* [120, ∞): el registro original solo mencionaba precipitación. Ambos
   marcos declaran ahora su bound.

### Corrección propuesta

Son **dos** cambios, y ninguno de los dos es opcional: el primero sin el
segundo deja la garantía en el mismo sitio, solo que con un número más bonito.

**(1) Definición 3.1 — marcos de soporte acotado con bound declarado.**
Sustituir la cola abierta por una cerrada y exigir la declaración del bound:

> **Definición 3.1′ (Marco de discernimiento de soporte acotado).** Un marco de
> discernimiento sobre una variable continua X es un par (Θ, P_máx) donde
> P_máx ∈ ℝ es el **límite superior declarado del dominio** de X y
> Θ = { [a₀, a₁), [a₁, a₂), …, [a_{k−1}, **P_máx**] } es una partición finita
> de [a₀, P_máx]. P_máx debe ser finito y P_máx > a_{k−1}.
>
> La exhaustividad de Θ es entonces exhaustividad **dentro del dominio
> declarado**, no sobre ℝ. El marco de precipitación de la Definición 3.1
> queda Θ = { [0,5), [5,15), [15,30), [30,60), [60, P_máx] } mm/h.

P_máx es un **bound de plausibilidad física**, no una estimación estadística:
se elige holgadamente por encima de cualquier evento registrado en el dominio
de despliegue. Un bound ceñido es frágil (cada evento extremo lo pone en
cuestión) y uno holgado solo cuesta anchura de intervalo, que es exactamente el
precio que un sistema de garantías debe estar dispuesto a pagar.

Con la Definición 3.1′ la Ecuación (10) es finita por construcción y la
Definición 3.9 no necesita cambio alguno: b_j ≤ P_máx para toda hipótesis.

**(2) Teorema 6.1 — H0 como hipótesis explícita.** El Teorema 6.1 enuncia
H1 (cobertura sensorial), H2 (fidelidad del modelo) y H3 (regularidad
dinámica). Falta la que las precede:

> **H0 (Soporte acotado).** El valor real de cada variable de entrada no excede
> el P_máx declarado de su marco: x*_v ∈ [a₀^v, P_máx^v] para toda variable de
> entrada v.

**H0 es lógicamente previa a H1**, y conviene que el enunciado lo diga. H1
afirma que x* pertenece al conjunto credal de la Capa 1; pero ese conjunto
credal es una unión de hipótesis del marco (Ec. 10), luego está contenido en
[a₀, P_máx] por construcción. Si H0 falla, **ninguna** evidencia puede
rescatar H1: no hay fusión, por concordante que sea, que produzca un conjunto
credal que contenga un valor fuera del dominio del marco. H0 falsa ⟹ H1 falsa,
y no por fallo sensorial sino por construcción del marco. Sin H0 explícita, el
Teorema 6.1 tiene una hipótesis tácita: que el marco elegido cubre la realidad.

La demostración del Lema 6.1 no cambia — sigue siendo el argumento del
contrapositivo sobre Pl(θ_j) = 0 ⟹ P*(θ_j) = 0—, pero su conclusión pasa a
leerse "x* ∈ [x̲, x̄] **bajo H0**".

Nótese la simetría con H2 y H3: las tres son hipótesis que el sistema
**declara y arrastra**, pero no puede verificar. Verificar H0 exigiría conocer
x*, que es precisamente lo que no se tiene. Lo que sí puede hacer el sistema —y
ahora hace— es hacerla explícita y auditable.

### Estado en el código

**Corregido en código.** El soporte acotado es ahora una hipótesis declarada
del sistema, no un artefacto del cálculo:

- `FrameOfDiscernment.domainBound` (`src/core/dempster-shafer/types.ts`) es el
  P_máx de la Definición 3.1′: campo **obligatorio y sin valor por defecto**.
- `createFrame` / `validateFrame` (`src/core/dempster-shafer/frame.ts`) validan
  en construcción —bound finito, estrictamente mayor que a_{k−1}, hipótesis
  contiguas, coherencia con un `upper` finito ya declarado— y cierran la cola.
  `hypothesisUpper` da el b_j efectivo de la Ec. (10), de modo que un marco
  escrito como literal con cola [a, ∞) tampoco reintroduce `+∞`.
- `buildCredalSet` (`src/core/dempster-shafer/credal-set.ts`) **elimina** el
  truncamiento `a_j·2` y el filtro `Pl > 0,01`. El único umbral que queda es la
  tolerancia de coma flotante 1e-10 de la Definición 3.9. Si aun así el lifting
  sale no acotado (marco que no pasó por `createFrame`), **lanza** en vez de
  truncar: un intervalo no acotado es inutilizable, pero uno truncado en
  silencio es peor.
- `HYPOTHESIS_H0_BOUNDED_SUPPORT` y `CERTIFICATE_ASSUMPTIONS` (= H0 + H1-H3) en
  `src/core/decision/types.ts`; `SafetyCertificate.domainBounds` registra el
  bound concreto de cada variable de entrada, y `certifySafety` /
  `synthesizeDecision` lo exigen como parámetro. `THEOREM_6_1_HYPOTHESES` se
  conserva intacta y aparte: es la transcripción literal del paper, y H0 es una
  extensión de la implementación. Con la lista de bounds vacía, la
  justificación del certificado declara explícitamente que **H0 no es
  auditable**, en lugar de callar.
- Marcos de la demo (`src/lib/constants.ts`): precipitación P_máx = 500 mm/h y
  viento V_máx = 500 km/h, ambos documentados como bounds conservadores de
  plausibilidad física —muy por encima de los récords registrados— y
  explícitamente **no** calibraciones.

**Verificación.** `__tests__/core/dempster-shafer/frame.test.ts` reproduce el
algoritmo antiguo y comprueba el contraste: con dos sensores concordando en un
evento de 200 mm/h, el truncamiento devolvía 120 mm/h y dejaba el valor real
fuera; ahora el intervalo llega a 500 mm/h y lo contiene.
`__tests__/properties/credal-lifting.property.test.ts` verifica el Lema 6.1
condicionado a H0 sobre marcos y BPAs generados, y su **caso negativo**: todo
x* > domainBound queda fuera del intervalo credal, que es H0 falsa y no un
fallo del motor (simétrico del caso negativo de H2 en
`dag-propagation.property.test.ts`).

**Coste medido.** La corrección solo puede ensanchar el intervalo credal, y lo
ensancha mucho en cuanto la hipótesis de cola es plausible: el upper pasa de
120 a 500 mm/h en el marco de la demo. Eso hará que la mayoría de escenarios
con cola plausible certifiquen `unsafe-possible`. **No es un defecto del
bound**: es la señal correcta de que la evidencia disponible no descarta un
evento extremo, señal que el truncamiento suprimía. Estrechar el intervalo es
tarea de la evidencia —fuentes que quiten plausibilidad a la cola—, no del
bound.

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

## 8 · Definición 3.9 / Ecuación (10) — "el bound externo es suficiente" es falso en la práctica

**Clase:** EXTENSIÓN — candidata a **sustituir la Definición 3.9 y extender la
Definición 5.5** en la v3.
**Ubicación:** §3.6, Definición 3.9 y Ec. (10); §3.3, Definición 3.4 y Ec. (4); §5.5, Definición 5.5 y Ec. (31).

> Esta entrada es la consecuencia directa de haber corregido la §5. Mientras el
> truncamiento ocultaba la cola, el problema no se veía.

### Texto actual

> **Definición 3.9.** […] el intervalo credal continuo es
> I(X) = ⋃_{j : P̄(I_j) > 0} I_j.
> […] **Para la propagación zonotópica, el bound externo es suficiente:**
> X ∈ [ mín_{j: P̄(I_j)>0} a_j , máx_{j: P̄(I_j)>0} b_j ]                    (10)
>
> **Definición 3.4.** m_i({θ_j}) = (1 − δ_i) ∫_{θ_j} p_i(x) dx  (3)
> **m_i(Θ) = δ_i**  (4)  — "válvula de seguridad" de la fuente.

### Problema

La frase resaltada es **falsa en la práctica** una vez la §5 está corregida. El
argumento es de tres pasos y no depende de la evidencia:

1. La Ec. (4) reserva masa δ_i sobre **Θ** en cada fuente.
2. **Θ interseca todas las hipótesis**, incluida la de cola [a_{k−1}, P_máx].
   Tras la fusión por la regla de Dempster, la masa sobre Θ sobrevive: el único
   término del producto conjunto cuya intersección es Θ es (Θ, …, Θ), de masa
   Π_i δ_i, y la normalización por 1/(1−K) solo puede aumentarla. Por tanto

   ```
   Pl(cola) ≥ m_fusionada(Θ) ≥ Π_i δ_i
   ```

3. El umbral de la Ec. (10) es la tolerancia de coma flotante 1e-10. Con tres
   fuentes de δ ≈ 0,05 se tiene Π δ_i ≈ 1e-4: **seis órdenes de magnitud por
   encima**. La cola nunca se descarta y la Ec. (10) devuelve **[a₀, P_máx]
   entero, independientemente de la evidencia.**

Medido sobre el escenario de la demo (tres fuentes concordando en ~8 mm/h, con
δ = 0,05 / 0,03 / 0,08, K_decision = 0,1844):

| Magnitud | Valor |
|---|---|
| Π δ_i | 1,200e-4 |
| m_fusionada(Θ) | 1,4713e-4 = Π δ_i / (1 − K) |
| Pl(*torrencial*) | 1,4713e-4 |
| Intervalo credal, Ec. (10) | **[0, 500] mm/h** — el marco completo |
| Reachable set h(2 h) | **[−12, 992] mm** |
| Veredicto Def. 5.5 | `unsafe-possible` |

Y con lluvia **intensa** concordante (~45 mm/h), el intervalo credal, el
reachable set y el veredicto son **exactamente los mismos**. También lo es la
severidad heurística, porque se deriva del mismo reachable set. El sistema es
sound y **vacuo**: no distingue una llovizna de un diluvio.

La causa raíz no es el δ_i ni el umbral 1e-10 —ambos son correctos y necesarios:
δ_i es la válvula de seguridad de la Def. 3.4 y 1e-10 es tolerancia numérica, no
un filtro semántico (§5)—. La causa raíz es que **la Ec. (10) descarta la
estructura credal y conserva solo el soporte.** La información de que el 99,9 %
de la masa está sobre *ligera* existe en la BPA fusionada y se destruye en el
puente 1→2.

### Corrección propuesta

Son **dos** cambios, y el segundo es el que devuelve la informatividad.

**(1) Definición 3.9′ — propagar el conjunto credal, no su soporte.** Sustituir
el lifting a un único intervalo por el lifting a una **distribución de masa
sobre intervalos**:

> **Definición 3.9′ (Conjunto credal intervalar).** Sea m la BPA fusionada sobre
> el marco (Θ, P_máx). Su lifting continuo es el conjunto de pares
>
> ```
> C(m) = { (m(A), I_A) : A ⊆ Θ, m(A) > 0 },    I_A = [ mín_{θ_j∈A} a_j , máx_{θ_j∈A} b_j ]   (10′)
> ```
>
> El intervalo de la Ec. (10) se recupera como el hull de C(m), de modo que la
> Def. 3.9 es el caso degenerado de la Def. 3.9′ en que se olvidan las masas.

La propagación por el DAG (Def. 4.3 / Ec. 24) se aplica **a cada I_A por
separado**, con la masa intacta: el SCM es determinista módulo U_i y U_i ya está
acotado por ε_i dentro de J_A, luego la regla de extensión de Dempster-Shafer
para una imagen manda la masa de A íntegra a la imagen de A. El coste es
**lineal** en el número de elementos focales, no exponencial.

**(2) Definición 5.5′ — certificado de dos niveles.** El veredicto existencial
de la Def. 5.5 **no cambia**. Se le añade un segundo nivel:

> **Definición 5.5′ (Certificado probabilístico).** Sea E el evento inseguro y
> {(m(A), J_A)} el conjunto credal propagado sobre la variable de interés. Se
> definen
>
> ```
> Bel(E) = Σ_{A : J_A ⊆ E}     m(A)          Pl(E) = Σ_{A : J_A ∩ E ≠ ∅} m(A)     (31′)
> ```
>
> **Proposición 5.3 (soundness del certificado probabilístico).** Bajo H0–H3,
> Bel(E) ≤ P(v* ∈ E) ≤ Pl(E).
>
> *Demostración.* Por la Def. 3.2 la masa m(A) es la parte de la evidencia que
> sostiene "el valor real está en A" y nada más fino, luego la distribución real
> admite la descomposición P* = Σ_A m(A)·P_A con P_A soportada en A; equivale a
> una variable de rama Λ con P(Λ = A) = m(A). Condicionado a Λ = A el valor de
> entrada está en A ⊆ I_A y, por el Teorema 4.1 (usando H2), el de la variable
> objetivo está en J_A. Por tanto P(v* ∈ E | Λ = A) vale 0 si J_A ∩ E = ∅ y 1 si
> J_A ⊆ E. Aplicando la ley de la probabilidad total y acotando los términos
> indeterminados por 0 y por 1 se obtienen las dos desigualdades. ∎

**Dirección de la sobre-aproximación.** Los J_A sobre-aproximan (wrapping
effect, hull de un A no contiguo, ε holgado). Sustituir J_A por J'_A ⊇ J_A hace
la contención **más difícil** —solo puede quitar términos a Bel(E)— y la
intersección **más fácil** —solo puede añadirlos a Pl(E)—. Luego
[Bel, Pl] ⊇ [P̲(E), P̄(E)] reales: la imprecisión de la Capa 2 **ensancha** el
intervalo de probabilidad, nunca lo desplaza fuera. Es la dirección conservadora
en ambos extremos.

Corolario operativo: **Pl(E) pequeño es una afirmación fuerte** (ni la
sobre-aproximación deja sitio para que el evento sea probable), mientras que
**Bel(E) pequeño es débil** (puede serlo solo por imprecisión). Por eso el
escalado operativo debe mirar Pl(E), no Bel(E).

**Efecto sobre la demo.** Mismo escenario, mismo veredicto existencial:

| Escenario | Ec. (10) | Reachable | Def. 5.5 | severidad | **Bel(E)** | **Pl(E)** |
|---|---|---|---|---|---|---|
| Lluvia ligera (~8 mm/h) | [0, 500] | [−12, 992] | `unsafe-possible` | 0,9631 | **0** | **1,559e-4** |
| Lluvia intensa (~45 mm/h) | [0, 500] | [−12, 992] | `unsafe-possible` | 0,9631 | **0,99988** | **≈ 1** |

Las cuatro primeras columnas son idénticas; las dos últimas separan los
escenarios por **más de tres órdenes de magnitud**. Esa diferencia es
exactamente la informatividad que la Ec. (10) destruía.

### Estado en el código

**Implementado.** Módulo nuevo `src/core/credal-propagation/`:

- `types.ts` — `FocalInterval`, `CredalIntervalSet` (invariante Σ m = 1 ± 1e-9),
  `ProbabilityBounds`, `CredalPropagationConfig`.
- `credal-interval-set.ts` — `toCredalIntervalSet` (Def. 3.9′ / Ec. 10′), con el
  b_j efectivo de `hypothesisUpper` (H0). `hullOf` recupera la Ec. (10) exacta,
  y hay un test que lo comprueba: la extensión **refina** la Def. 3.9, no la
  contradice. *(Alcance precisado por la auditoría de la rc1: la igualdad es
  exacta mientras ningún elemento focal tenga masa ≤ 1e-10, lo que la válvula
  δ_i > 0 de la Def. 3.4 garantiza —Pl ≥ Π_i δ_i ≈ 1e-4—. Con δ_i = 0 puede
  romperse, y solo en la dirección **hull ⊇ Ec. (10)**: el umbral de tolerancia
  únicamente puede quitar hipótesis al lado de la Ec. (10). Medido: identidad
  exacta en las 30.089 fusiones con δ > 0 de una campaña de 60.000, y cero casos
  de hull ⊉ Ec. (10) en las 60.000. El reachable set se construye sobre el hull,
  luego el objeto que puede quedarse corto no es el que sostiene el veredicto.
  Fijado en `__tests__/core/credal-propagation/credal-interval-set.test.ts`.)* La ruta de alto conflicto usa la BPA sintética de
  `envelopeCombine`, cuya masa sobrante va a Θ y por tanto cuenta siempre para
  Pl y nunca para Bel — conservadora en ambos extremos.
- `propagation.ts` — `propagateCredalThroughDAG`, coste |F| × propagación
  intervalar, con límite configurable `maxFocalElements` (64 por defecto) que
  **lanza** al superarse.
- `probability-bounds.ts` — `probabilityBounds` (evento intervalar) y
  `unsafeProbabilityBounds` (el complemento de la región segura, que es el
  evento de la Def. 5.5). La demostración completa está en el JSDoc del módulo.

Certificado de dos niveles: `SafetyCertificate.probabilityBounds`
(`src/core/decision/types.ts`), obligatorio y explícitamente nullable —con
`null` la justificación declara que el nivel probabilístico no está disponible,
en lugar de callar—. `certifySafety` **lanza** si los bounds contradicen su
propio veredicto (`proven-safe` con Pl(E) > 0). `SafetySpec.unsafeProbabilityThreshold`
y `CertifiedDecision.escalationBasis` separan la escalada por bound demostrado
de la escalada por heurística; `severityScore` sigue existiendo aparte y sin
estatus formal.

Pipeline extremo a extremo: `src/core/pipeline/demo-pipeline.ts`.

**Verificación.** `__tests__/properties/credal-propagation.property.test.ts` (10
propiedades): la cobertura credal end-to-end sobre BPAs, DAGs y regiones
inseguras generados —muestreando el mundo real y comprobando que la frecuencia
del evento cae en [Bel, Pl]—, los invariantes de los bounds, la conservación de
la masa y la consistencia con el nivel existencial en ambas direcciones.
`__tests__/core/pipeline/demo-pipeline.test.ts` fija los números de la tabla de
arriba **incluyendo la vacuidad del nivel existencial**: si alguien intentara
"arreglar" el problema estrechando el intervalo credal, esos tests fallarían.

**Confirmación empírica (campaña de cobertura, agosto 2026).** El experimento 2
(`npm run exp:h1`, `scripts/experiments/README.md`) lleva de 0 % a 50 % la
fracción de mundos en que **las tres fuentes fallan a la vez** —violación
directa de H1 del Teorema 6.1— y mide qué le pasa a cada nivel:

| fracción de violación | nivel existencial, Ec. (10) | banda de evidencia 95 % |
|---:|---:|---:|
| 0 % | 100,00 % | 100,00 % |
| 25 % | 100,00 % | 84,00 % |
| 50 % | 100,00 % | 67,75 % |

El nivel existencial cubre el 100 % **también dentro de los mundos violados**:
es insensible a que H1 sea falsa. No es robustez, es la vacuidad de esta entrada
medida por otra vía — la masa δ_i sobre Θ mantiene Pl > 0 sobre todas las
hipótesis y el lifting devuelve el marco entero sea cual sea la evidencia, luego
también cuando no hay evidencia válida ninguna. La banda de evidencia, que sí
conserva la estructura de masa, mantiene 99,7-100 % en los mundos intactos y cae
a ~35 % dentro de los violados: degrada exactamente donde la hipótesis se rompe
y en ningún otro sitio, que es el comportamiento que se le pide a un nivel
informativo.

**Lo que NO cambia.** El nivel existencial conserva su semántica exacta:
`proven-safe` sigue significando reachable ⊆ safeRegion y `unsafe-possible`
sigue siendo existencial. El nivel probabilístico **cualifica**, no decide, y
depende de las mismas H0–H3 y de ninguna hipótesis más.

---

## 9 · Capa 1 — Definición 3.6: κ₁ y κ₂ están declarados para K_máx y se reutilizaban para K_global

> Esta entrada tiene **tres capas**. Ésta corrige **qué magnitud** se compara con
> κ₁/κ₂ (→ regla **C1**); la Capa 2 documenta el **suelo estructural** que el
> hindcast midió, y la Capa 3 corrige **con qué se puntúa un par** (→ medida
> **D2**). Las tres juntas son candidatas a sección propia en la v3.

**Clase:** ERRATA DE DISEÑO *(reclasificada: la iteración anterior la registró
como SALVEDAD, «se reporta, no se corrige»)*
**Ubicación:** §3.4.2, Definición 3.6 (umbrales de la estrategia escalonada), en
combinación con la entrada 2 de este documento.

### Texto actual

> **Nivel 1: Bajo conflicto** (K_máx ≤ κ₁): Aplicar regla de Dempster […]
> **Nivel 2: Conflicto moderado** (κ₁ < K_máx ≤ κ₂) […]
> **Nivel 3: Alto conflicto** (K_máx > κ₂) […]
> con κ₁ = 0,3 y κ₂ = 0,7.

### Problema

La entrada 2 sustituye K_máx por K_decision = máx(K_máx, K_global) y declara que
«los umbrales κ₁ = 0,3 y κ₂ = 0,7 **no cambian**». Esa frase es correcta como
decisión de diseño —cambiarlos habría sido ajustar el sistema a un resultado—
pero **oculta un desplazamiento del punto de operación** que la campaña de
cobertura midió y que el paper no declara en ninguna parte.

La causa es estructural. Para BPAs gaussianas sobre singletons (Def. 3.4), y
despreciando los términos de Θ,

```
K_global ≈ 1 − Σ_j Π_{i=1}^{n} m_i(θ_j)
```

es decir, K_global es pequeño **solo si las n fuentes concentran masa sobre la
MISMA hipótesis a la vez**. Con n = 3 y un marco de cinco hipótesis anchas, tres
fuentes que miden exactamente la misma verdad con σ = 1,5 / 2,0 / 2,5 mm/h se
reparten entre dos o tres hipótesis contiguas por puro ruido instrumental, y el
producto colapsa. K_global crece con n y con la dispersión **aunque no exista
ningún desacuerdo físico entre las fuentes**: no distingue conflicto de
discretización.

Medido con la regla C0 (10.000 mundos, semilla 20260804), sobre los 7.258
mundos **sin fallo de fuente y sin conflicto físico**: Dempster 54,1 %,
cautelosa 30,3 %, envolvente **15,6 %**. Casi la mitad de los mundos
*tranquilos* no llegaban al Nivel 1.

El diagnóstico, en una línea: **κ₁/κ₂ y K_global viven en escalas distintas**.
Los umbrales fueron elegidos para el conflicto POR PARES de la Definición 3.5;
K_global es una magnitud n-aria que crece con n y con la granularidad del marco.
La regla C0 mezclaba dos funciones que hay que separar:

1. **informatividad** — qué magnitud decide entre Dempster, media cautelosa y
   envolvente;
2. **protección** — qué impide que la reducción secuencial degenere, es decir la
   propiedad (P2) de la entrada 2.

La protección debía conservarse. La sobre-conservación estructural, no.

### Corrección — experimento pre-registrado

La iteración anterior dejó esto sin corregir por una razón sólida: elegir una
regla nueva a la vista de sus propios resultados es el error que la campaña
prohíbe. La corrección se hizo por tanto **pre-registrando** candidatos,
requisito y criterio ANTES de ejecutar nada, y con una **semilla distinta**
(20260311) de la canónica con que se publican los números (20260804), para que
la regla elegida no pudiera quedar ajustada a la realización del PRNG que luego
se cita.

**Los cuatro candidatos** (`src/core/dempster-shafer/conflict-rules.ts`, tras la
interfaz común `ConflictDecisionRule`; κ₁ y κ₂ **no se mueven en ninguno**):

| | K_decision (contra κ₁/κ₂) | guardia | cota B sobre K_global en la rama Dempster |
|---|---|---|---|
| **C0** *(la vigente)* | máx(K_máx, K_global) | — | κ₁ = 0,30 |
| **C1** | K_máx por pares | K_global ≥ κ_deg ⟹ envolvente | κ_deg = 0,95 |
| **C2** | máx(K_máx, K_norm) | — | 1 − (1−κ₁)^{n−1} = 0,51 *(n = 3)* |
| **C3** | máx(K_máx, K_norm) | K_global ≥ κ_deg ⟹ envolvente | 0,51 |

con **K_norm = 1 − (1 − K_global)^{1/(n−1)}** y κ_deg = 0,95. Por (I2) de la
entrada 2, K_norm es exactamente la **media geométrica del conflicto por paso**
de la reducción secuencial, llevada a la escala del par; para n = 2 vale
K_global = K_par de forma exacta, bit a bit.

**Requisito innegociable**, verificado ANTES de comparar nada. Un candidato que
falle cualquiera de los tres queda descalificado por informativo que sea:

- (a) el contraejemplo del ciclo va a envolvente o cautelosa, nunca a Dempster
  (`__tests__/core/dempster-shafer/conflict-rules.test.ts`);
- (b) la rama Dempster no se ejecuta nunca con K_decision > κ₂, y su K_global
  respeta la cota B < 1 declarada
  (`__tests__/properties/global-conflict.property.test.ts`, 20.000 casos × las
  cuatro reglas × todas las permutaciones);
- (c) la campaña de soundness de `__tests__/experiments/world-soundness.test.ts`,
  hoy parametrizada por regla: 4 reglas × 3 configuraciones × 2.000 mundos.

**Criterio de selección**, lexicográfico y aplicado mecánicamente por
`scripts/experiments/lib/selection.ts` (probado aparte de las cifras que
consume, en `__tests__/experiments/conflict-rule-selection.test.ts`):

1. pasa el requisito innegociable;
2. cobertura existencial 100 % y cobertura de banda-95 ≥ 99,5 % global;
3. mayor fracción de mundos limpios concordantes que alcanza Dempster;
4. empate a < 1 punto porcentual en 3 → menor anchura media de la banda-95;
5. empate también en 4 → el más simple, orden C1 > C2 > C3.

### Fase A — calibración y selección

`npm run exp:conflict-rule` · semilla **20260311** · 10.000 mundos de
calibración + 5.000 solo-virga, los **mismos** para los cuatro candidatos.

| candidato | requisito | cob. existencial | cob. banda-95 | limpios → Dempster | anchura banda-95 | virga: ni P\* ni γP\* | virga (D/C/E) |
|---|---|---:|---:|---:|---:|---:|---|
| C0 | ✅ | 100,00 % | 99,910 % | 53,49 % | 296,99 mm/h | 0,00 % | 29 / 20 / 51 % |
| **C1** | ✅ | 100,00 % | 99,840 % | **57,62 %** | **280,67 mm/h** | 0,02 % | 31 / 24 / 45 % |
| C2 | ✅ | 100,00 % | 99,840 % | **57,62 %** | **280,67 mm/h** | 0,02 % | 31 / 24 / 45 % |
| C3 | ✅ | 100,00 % | 99,840 % | **57,62 %** | **280,67 mm/h** | 0,02 % | 31 / 24 / 45 % |

**Ningún candidato fue descalificado.** Los cuatro pasan el requisito y los
pasos 1–2 del criterio; C1, C2 y C3 empatan en el paso 3 (identidad exacta, no
aproximación) y en el paso 4, y **decide el paso 5: se selecciona C1** por
simplicidad.

**Acuerdo par a par**, sobre los 15.000 mundos:

| | C0 | C1 | C2 | C3 |
|---|---:|---:|---:|---:|
| C0 | — | 88,53 % | 88,53 % | 88,53 % |
| C1 | | — | **100 %** | **100 %** |
| C2 | | | — | **100 %** |

C1, C2 y C3 eligen la MISMA estrategia en los 15.000 mundos. Dos coincidencias
distintas se superponen ahí:

- **C3 ≡ C2 es un teorema para n ≤ 3**, no una casualidad. La guardia añade algo
  a C2 solo si existe un caso con K_global ≥ κ_deg y máx(K_máx, K_norm) ≤ κ₂; el
  peor caso es K_global = κ_deg, y entonces
  K_norm(κ_deg, n) > κ₂ ⟺ n − 1 < ln(1−κ_deg)/ln(1−κ₂) = **2,4882**.
  Con κ_deg = 0,95 y κ₂ = 0,7 la guardia es **redundante para n ≤ 3** y
  **operativa para n ≥ 4**: con n = 4 y K_global = 0,95, K_norm = 0,6316 ≤ κ₂ y
  C2 va a la media cautelosa mientras C3 fuerza la envolvente. En el dominio de
  la demo (3 fuentes, §7.2) **C3 colapsa en C2 exactamente**; en el régimen que
  `maxSourcesForGlobalConflict` = 6 admite, **no**. Demostrado y testeado.
- **C1 ≡ C2 es empírico, no un teorema.** Con tres fuentes gaussianas sobre este
  marco resultó que K_norm ≤ K_máx en los 15.000 mundos, de modo que el máximo
  de C2 se lo lleva siempre K_máx —que es justo lo que C1 usa—. No vale en
  general: en el ciclo del contraejemplo K_máx = 0,75 y K_norm = 1.

**Margen numérico realmente usado** en la rama Dempster (peor caso sobre los
15.000 mundos):

| | cota B declarada | peor K_global observado | peor K^(k) secuencial | peor factor 1/(1−K) |
|---|---:|---:|---:|---:|
| C0 | 0,30 | 0,2999 | 0,2954 | 1,419 |
| C1 | 0,95 | 0,4474 | 0,3070 | 1,443 |
| C2, C3 | 0,51 | 0,4474 | 0,3070 | 1,443 |

La cota teórica de C1 es mucho más laxa que la de C2 (20 frente a 2,04 sobre el
factor de normalización), y el criterio pre-registrado no la contempla. Medido,
la diferencia no se materializa: el peor factor realmente aplicado es 1,443 con
C1 frente a 1,419 con C0. Se declara igualmente como el punto débil de la regla
elegida, y como la razón por la que C2 seguiría siendo preferible si algún día
se opera con n ≥ 4 fuentes o con marcos mucho más finos.

### Fase B — validación con la semilla canónica

`npm run exp:all` · semilla **20260804** · regla C1. La columna C0 se regenera
con `npm run exp:all:c0` y reproduce exactamente los números publicados antes de
esta corrección, lo que confirma que nada más ha cambiado.

**Experimento 1 — reparto de estrategias** (10.000 mundos):

| condición | n | C0 (D / C / E) | **C1 (D / C / E)** |
|---|---:|---|---|
| global | 10.000 | 44,10 / 24,87 / 31,03 % | **47,93 / 30,06 / 22,01 %** |
| **sin fallo ni virga** | 7.258 | 54,08 / 30,30 / **15,62** % | **58,82 / 36,55 / 4,63 %** |
| fallo δ | 1.495 | 3,88 / 1,07 / 95,05 % | 3,88 / 1,74 / 94,38 % |
| virga | 1.247 | 34,24 / 21,81 / 43,95 % | 37,37 / 26,22 / 36,41 % |

**Experimento 1 — cobertura y anchura**:

| método · estrato | C0 cobertura | C1 cobertura | C0 anchura | C1 anchura |
|---|---:|---:|---:|---:|
| existencial · global | 100,00 % | **100,00 %** | 500,00 | 500,00 |
| banda-95 · global | 99,97 % | **99,91 %** | 295,26 | **276,51** |
| banda-95 · sin fallo | 100,00 % | 99,92 % | 247,96 | **224,77** |
| banda-95 · fallo δ | 99,87 % | 99,87 % | 492,01 | 492,01 |
| banda-95 · virga | 99,92 % | 99,92 % | 334,70 | **319,29** |

Los dos baselines no se mueven ni un dígito (76,20 % y 76,68 %, anchuras 4,60 y
4,24 mm/h): no dependen de la regla de fusión, y sirven de control.

**Experimento 2 — violación de H1** (11 puntos × 2.000 mundos), banda-95:

| violación | C0 todos | C1 todos | C0 violados | C1 violados | C0 intactos | C1 intactos |
|---:|---:|---:|---:|---:|---:|---:|
| 0 % | 100,00 % | 99,95 % | — | — | 100,00 % | 99,95 % |
| 25 % | 84,00 % | 83,95 % | 34,29 % | 34,09 % | 100,00 % | 100,00 % |
| 50 % | 67,75 % | 67,70 % | 37,17 % | 37,17 % | 99,90 % | 99,79 % |

El nivel existencial se mantiene en 100,00 % en los once puntos con las dos
reglas. La estructura del hallazgo —degrada dentro de los mundos violados y solo
allí— no cambia; la anchura media baja (365,00 frente a 375,51 mm/h al 50 %).

**Experimento 3 — virga** (5.000 mundos solo-virga):

| | C0 | C1 |
|---|---:|---:|
| existencial · ni P\* ni γP\* | 0,00 % | 0,00 % |
| banda-95 · ni P\* ni γP\* (todos) | 0,02 % | **0,04 %** |
| banda-95 · ni P\* ni γP\* (sin fallo δ) | 0,00 % | 0,02 % |
| banda-95 · anchura media | 356,01 | **343,19** mm/h |
| reparto D / C / E | 30,06 / 18,92 / 51,02 % | **32,68 / 23,22 / 44,10 %** |
| K_decision mediana (p25 / p75) | 0,718 (0,228 / 0,935) | 0,596 (0,200 / 0,892) |

`media-ponderada` y `kalman-estatico` siguen en 43,12 % y 41,58 %: la afirmación
del Ejemplo 3.1 queda cuantificada igual que antes.

### Qué se compró y qué se pagó

**Comprado.** En mundos limpios y concordantes, la envolvente cae de **15,6 % a
4,6 %** (un factor 3,4) y el Nivel 1 sube de 54,1 % a 58,8 %. La anchura media
de la banda de evidencia baja un 6,4 % en global y un 9,4 % en mundos limpios.
El objetivo declarado —eliminar la sobre-conservación estructural— se cumple.

**Pagado, y hay que decirlo:**

1. La cobertura de la banda-95 baja de 99,97 % a 99,91 % en global y de 100,00 %
   a 99,92 % en mundos limpios. Sigue muy por encima del 95 % nominal y del piso
   pre-registrado del 99,5 %, pero es una pérdida real: la banda es más estrecha
   y falla más. En virga, la métrica «ni P\* ni γ·P\*» sube de 0,02 % a 0,04 %
   (2 mundos de 5.000). **La soundness no se toca**: el nivel existencial sigue
   en 100,00 % en las tres campañas y bajo las cuatro reglas.
2. **Un conflicto n-ario real con pares moderados baja de Nivel 3 a Nivel 2.**
   El ciclo atenuado del test de regresión (m_i = {a:0,4; b:0,4; Θ:0,2}, pares a
   0,48 y K_global = 0,784) iba a envolvente con C0 y va a media cautelosa con
   C1 —y también con C2 y C3, luego es el precio de reescalar, no de C1—. La
   media cautelosa es una combinación convexa (Prop. 3.2), sigue siendo sound y
   no normaliza: se pierde conservadurismo, no corrección. Está fijado
   explícitamente en `__tests__/properties/dempster-validity.property.test.ts`.
3. La cota teórica sobre el factor de normalización se relaja de 1,43 a 20 (ver
   la tabla de márgenes; el valor observado no llega a 1,45).

### Estado en el código

**Corregido.** `assessConflict` delega en `ruleOf(config).decide(...)`
(`src/core/dempster-shafer/conflict.ts`), y `DEFAULT_FUSION_CONFIG.rule = 'C1'`.
Las cuatro reglas siguen disponibles por configuración —`FusionConfig.rule` y
`FusionConfig.kappaDegeneracy`— y los experimentos aceptan `--rule` para
reproducir cualquier número publicado bajo una regla anterior
(`npm run exp:all:c0`). `FusionResult` expone `rule`, `decisionConflict`,
`normalizedConflict` y `degeneracyGuard`, y esos campos viajan a
`out/<escenario>/result.json` y a las columnas `rule`, `K_decision` y `guard` de
`summary.csv`.

**κ₁ y κ₂ no se han movido.** Siguen valiendo 0,3 y 0,7
(`src/lib/constants.ts`). Lo único que ha cambiado es qué magnitud se compara
con ellos.

**Impacto en los cuatro escenarios del harness:** ninguno cambia de método de
fusión ni de veredicto. s2 sigue dando plUpper = 1,559438e-4 exactamente, y los
cuatro conservan su `credal`, su `reachable`, su `belLower`, su `plUpper` y su
decisión. Lo único que cambia en `summary.csv` son las columnas nuevas y el
valor de `K_decision`, que ahora es el K_máx por pares. Detalle a anotar:
**s3-virga-conflict activa la guardia** (K_global = 0,9512 ≥ κ_deg = 0,95); ya
iba a envolvente por K_máx = 0,9159 > κ₂, de modo que el resultado es el mismo
por dos vías independientes.

**Impacto en el barrido `smoke`** (200 escenarios concordantes, semilla
20260804): las estrategias pasan de 116/47/37 a **126/65/9** (D/C/E) y tres
escenarios de 200 bajan de `critical` a `warning`. Es el mismo efecto que mide
el experimento 1 —menos envolventes, más informatividad— visto en un barrido
continuo, y sin violaciones de bounds (0 antes y después).

**Verificación.** `npm run exp:conflict-rule` (Fase A, semilla 20260311) y
`npm run exp:all` (Fase B, semilla 20260804); `out/experiments/conflict-rule/results.json`
lleva el criterio, la traza de la selección y las métricas de los cuatro
candidatos.

---

## 9 · Capa 2 — el suelo estructural: κ₁ y κ₂ aplicados a una medida que no es cero con acuerdo perfecto

> **Cómo leer esta entrada.** Tiene **tres capas**, y son tres cosas distintas
> que conviene no fundir:
>
> 1. **la regla** (arriba): qué magnitud se compara con κ₁/κ₂ y qué protege de la
>    degeneración → seleccionada **C1** por `exp:conflict-rule`;
> 2. **el suelo medido en el hindcast** (esta sección): el diagnóstico, que se
>    registró primero como limitación medida porque no había experimento que lo
>    resolviera;
> 3. **la medida corregida** (la sección siguiente): con qué se puntúa un par →
>    seleccionada **D2** por `exp:conflict-floor`, y **con selección solo
>    sintética**, porque los resultados del hindcast ya eran conocidos.
>
> Es candidata a **sección propia en la v3**: las tres capas juntas son la
> historia completa de por qué la Definición 3.6 necesita dos parámetros donde el
> paper escribe uno.

### El diagnóstico

Lo anterior corrigió **qué magnitud** se compara con κ₁ y κ₂. El hindcast sobre
datos reales (`npm run exp:hindcast`) dejó ver que había una segunda pregunta
debajo: **con qué escala fueron elegidos κ₁ y κ₂**.

Al fusionar tres mediciones **idénticas** —acuerdo perfecto, dispersión cero— con
las σ del hindcast (5,0 / 1,8 / 10,0 mm/h, declaradas a priori a partir del lado
de celda de cada producto), el conflicto por pares **no es cero**:

| las tres fuentes miden | K_máx | método elegido |
|---:|---:|---|
| 0 mm/h | **0,365** | cautelosa |
| 5 mm/h | 0,561 | cautelosa |
| 10 mm/h | 0,619 | cautelosa |
| 40 mm/h | 0,189 | dempster |

Es un **suelo estructural**: BPAs con σ muy distintas reparten la MISMA medición
de forma distinta sobre las cinco hipótesis del marco —la fina concentra la masa
en una, la gruesa la extiende sobre tres—, el solape es incompleto y K_ij > 0 sin
ningún desacuerdo físico. Como ese suelo (0,365) supera κ₁ = 0,3, **la rama de
Dempster es inalcanzable** en todo el régimen de intensidades bajas y medias: en
las 264 horas de los dos eventos no se aplica ni una sola vez, y el K_máx mínimo
observado coincide con el suelo (a 2·10⁻⁴ en E1, exactamente en E2).

**Cómo quedó registrado entonces:** como limitación medida y no como corrección.
Ninguna de las cuatro reglas C0-C3 aborda esto, porque las cuatro comparan una
magnitud con umbrales fijos y el problema está en el par (magnitud, umbral). El
candidato natural —restar el suelo, o normalizar K por él— **no se propuso**
porque no se había estudiado su soundness; hacerlo exigía un experimento
pre-registrado propio. Es el que se describe a continuación.

Detalle completo, tablas y por qué las σ **no** se retocaron a la vista del
resultado, en [`scripts/experiments/README.md`](../scripts/experiments/README.md).

---

## 9 · Capa 3 — corrección de la MEDIDA, con selección solo sintética

**Clase:** ERRATA DE DISEÑO *(continuación directa de las dos capas anteriores)*
**Ubicación:** §3.4.1, Definición 3.5 y Ecuación (6), en combinación con la
Definición 3.6.

### ⚠ Advertencia de honestidad que rige todo el diseño

**Los resultados del hindcast YA ERAN CONOCIDOS** cuando se diseñó este
experimento: `npm run exp:hindcast` estaba ejecutado, commiteado y descrito en
las secciones anteriores, y es de ahí de donde sale el problema. Elegir la medida
mirando esos resultados sería retro-ajuste con pasos extra. En consecuencia, y
sin excepción:

- **la selección se hizo EXCLUSIVAMENTE sobre mundos sintéticos con ground
  truth**, donde «acertar» tiene una respuesta que no depende de nadie;
- el bloque «σ del hindcast» de la Fase A usa las σ y δ declaradas a priori
  (5,0 / 1,8 / 10,0 mm/h, δ = 0,02) sobre **mundos sintéticos nuevos**, no sobre
  los datos reales;
- **el hindcast se re-ejecutó DESPUÉS y solo como descripción. NO es una
  validación ciega**, y así consta literalmente en su `results.json`
  (`results.selectionDisclosure`), en el README de experimentos y aquí.

La semilla de la Fase A (**20261007**) es nueva y distinta de la canónica 20260804
con que se publican los números de la Fase B.

### Las tres candidatas

Fijadas en `src/core/dempster-shafer/conflict-measures.ts` tras la interfaz común
`PairwiseConflictMeasure`. **La regla es C1 en las tres** y κ₁/κ₂ no se mueven:
lo único que cambia es CON QUÉ se puntúa el desacuerdo de un par.

| | d(m_i, m_j) | suelo con acuerdo perfecto (σ del hindcast, 0 mm/h) |
|---|---|---:|
| **D0** *(la vigente)* | K_ij crudo, Ec. (6) | 0,3651 **> κ₁** |
| **D1** | máx(0, (K_ij − K_floor_ij)/(1 − K_floor_ij)) | **0 exacto** |
| **D2** | distancia de Jousselme d_J sobre la matriz de Jaccard | 0,2727 < κ₁ |

con **K_floor_ij** = conflicto entre las BPAs de i y j construidas ambas sobre
x̂_ij, la media de las dos mediciones **ponderada por precisión** (w ∝ 1/σ²). Es
«el conflicto que existiría sin desacuerdo alguno».

**Separación estructural**, que rige a las tres y no es negociable: la medida
gobierna **solo** la comparación con κ₁/κ₂. La **guardia de degeneración**
(κ_deg = 0,95) sigue operando sobre el **K_global CRUDO**, porque la explosión
1/(1−K) que (P2)/(P2′) previenen es propiedad del K crudo y una medida que reste
un suelo puede acercarse a 0 con K_global ≈ 1. Consecuencia comprobada: el
contraejemplo del ciclo va a envolvente **por la guardia** bajo las tres — y bajo
D2 esa es la **única** vía, porque d_J le asigna 0,5 ≤ κ₂.

**Propiedades demostradas y testeadas** (`__tests__/core/dempster-shafer/conflict-measures.test.ts`
y `__tests__/properties/conflict-measures.property.test.ts`):

- **D1 (i)** mediciones idénticas ⇒ K_excess = **0 exactamente** (no 1e-16: x̂ se
  devuelve tal cual cuando x_i = x_j, y las BPAs del suelo son bit a bit las
  originales);
  **(ii)** K_excess ∈ [0, 1];
  **(iii)** K_excess ≤ K siempre —porque K_floor·(K−1) ≤ 0—, y con σ iguales y
  mediciones muy separadas vuelve al K crudo (Δ = 80 mm/h: 0,9604 frente a
  0,9604). El caso K_floor = 1 devuelve 0 y está testeado aparte, porque es
  inalcanzable con BPAs de la Def. 3.4 sobre un marco que cubra el dominio.
- **D2** d_J(m, m) = 0 exactamente, simetría exacta, rango [0, 1] y desigualdad
  triangular (viene de una forma cuadrática semidefinida positiva).
- **Sin procedencia gaussiana no hay suelo**: una BPA fusionada, una envolvente
  sintética o una escrita a mano no tienen (valor, σ) que reconstruir, y D1
  degrada **exactamente** a D0. Es la dirección conservadora.

Punteros de literatura anotados en el JSDoc como conceptos a formalizar en la
fase de paper, sin atribuir enunciados literales: **distancia de Jousselme**,
**auto-conflicto de Martin/Osswald** y la **crítica de Liu al K escalar**. El
suelo que aquí se mide es pariente del auto-conflicto pero no es el mismo objeto:
no es K(m, m) sino K(m_i(x̂), m_j(x̂)) con **σ distintas**; el auto-conflicto es
su caso particular σ_i = σ_j.

### Requisito innegociable y criterio

**Requisito**, verificado ANTES de comparar nada:

- (a) el ciclo va a envolvente **por la guardia** bajo las tres;
- (b) la rama Dempster no se ejecuta nunca con la medida de decisión > κ₂ ni con
  **K_global crudo** ≥ κ_deg (`__tests__/properties/conflict-measures.property.test.ts`,
  entradas generadas × todas las permutaciones);
- (c) campaña world-soundness completa (`__tests__/experiments/world-soundness.test.ts`,
  ahora 3 medidas × 3 configuraciones × 2.000 mundos, además de las 4 reglas);
- (d) cobertura existencial 100 % en la calibración.

**Criterio**, lexicográfico y aplicado mecánicamente por
`scripts/experiments/lib/floor-selection.ts` (probado aparte de las cifras que
consume, en `__tests__/experiments/conflict-floor-selection.test.ts`):

1. pasa el requisito innegociable;
2. cobertura de banda-95 ≥ **99,5 %** global;
3. métrica virga «ni P\* ni γ·P\*» ≤ **0,10 %**;
4. bloque «σ del hindcast» sintético: mayor fracción que alcanza Dempster;
5. empate a < 1 punto en 4 → mayor fracción de limpios → Dempster en la
   configuración estándar;
6. empate también en 5 → menor anchura media de banda-95;
7. empate total → el más simple, orden D1 > D2.

### Fase A — calibración y selección

`npm run exp:conflict-floor` · semilla **20261007** · 10.000 mundos estándar +
5.000 solo-virga + 5.000 con las σ del hindcast y dispersión ≤ 0,5 mm/h, los
**mismos** para las tres candidatas.

| candidata | 1. requisito | 2. banda-95 | 3. virga ni-ni | 4. σ-hindcast → Dempster | 5. limpios → Dempster | 6. anchura |
|---|---|---:|---:|---:|---:|---:|
| D0 | ✅ | 99,870 % | 0,000 % | 9,90 % | 58,97 % | 280,66 |
| D1 | ✅ | **99,480 %** ❌ | 0,080 % | *(100,00 %)* | *(81,00 %)* | *(197,49)* |
| **D2** | ✅ | 99,720 % | 0,000 % | **59,66 %** ⟵ decide | 65,98 % | 254,32 |

**D1 queda DESCALIFICADA en el paso 2** y **D2 gana el paso 4 en solitario**.

Esto es exactamente para lo que sirve el pre-registro, y conviene decirlo sin
adornos: **D1 era la candidata natural y la que mejor resuelve el problema
declarado** —anula el suelo de forma exacta y lleva el 100 % de los mundos
concordantes a Dempster—, pero paga la informatividad con cobertura: su banda-95
cae al 99,48 %, por debajo del piso del 99,5 % fijado antes de medir. El criterio
**no se relajó**. La pérdida se concentra donde era previsible: en mundos limpios
D1 baja al 99,539 % (D2: 99,749 %; D0: 99,902 %) con una anchura media de 120,03
frente a 191,87 y 224,96 mm/h — la banda es mucho más estrecha y falla más.

**Acuerdo par a par** sobre los 20.000 mundos: D0~D1 63,6 %, D0~D2 82,3 %,
D1~D2 78,4 %. Las tres eligen estrategias distintas con frecuencia; aquí no hay
ninguna equivalencia empírica como la que C1 ≡ C2 tuvo en la capa anterior.

**Margen numérico realmente usado** en la rama Dempster (peor caso, 20.000
mundos). La cota declarada es κ_deg = 0,95 para las tres, porque es la de la
guardia y la guardia no cambia:

| | peor K_global observado | peor K^(k) secuencial | peor factor 1/(1−K) |
|---|---:|---:|---:|
| D0 | 0,4369 | 0,3064 | 1,442 |
| D1 | 0,8215 | 0,6893 | 3,219 |
| **D2** | 0,8024 | 0,6199 | **2,631** |

Es el precio directo de admitir más fusiones de Dempster: se entra en la rama con
K_global crudo más alto. Sigue muy por debajo del 20 que κ_deg permite, pero es
1,8× el margen que se usaba antes y queda declarado.

### Fase B — validación con la semilla canónica

`npm run exp:all` · semilla **20260804** · medida D2. La columna D0 se regenera
con `npm run exp:all:d0` y **reproduce exactamente** los números publicados en la
capa anterior, lo que confirma que nada más ha cambiado.

**Experimento 1 — reparto de estrategias** (10.000 mundos):

| condición | n | D0 (D / C / E) | **D2 (D / C / E)** |
|---|---:|---|---|
| global | 10.000 | 47,93 / 30,06 / 22,01 % | **53,45 / 23,64 / 22,91 %** |
| **sin fallo ni virga** | 7.258 | 58,82 / 36,55 / 4,63 % | **65,86 / 28,38 / 5,76 %** |
| fallo δ | 1.495 | 3,88 / 1,74 / 94,38 % | 3,88 / 1,54 / 94,58 % |
| virga | 1.247 | 37,37 / 26,22 / 36,41 % | 40,66 / 22,53 / 36,81 % |

**Experimento 1 — cobertura y anchura**:

| método · estrato | D0 cobertura | D2 cobertura | D0 anchura | D2 anchura |
|---|---:|---:|---:|---:|
| existencial · global | 100,00 % | **100,00 %** | 500,00 | 500,00 |
| banda-95 · global | 99,91 % | **99,72 %** | 276,51 | **250,18** |
| banda-95 · sin fallo | 99,92 % | 99,75 % | 224,77 | **191,25** |
| banda-95 · fallo δ | 99,87 % | 99,87 % | 492,01 | 492,02 |
| banda-95 · virga | 99,92 % | 99,36 % | 319,29 | **303,22** |

Los dos baselines no se mueven ni un dígito (76,20 % y 76,68 %, anchuras 4,60 y
4,24 mm/h): no dependen de la medida de conflicto, y sirven de control.

**Experimento 2 — violación de H1** (11 puntos × 2.000 mundos), banda-95:

| violación | D0 todos | D2 todos | D0 violados | D2 violados | D0 intactos | D2 intactos |
|---:|---:|---:|---:|---:|---:|---:|
| 0 % | 99,95 % | 99,75 % | — | — | 99,95 % | 99,75 % |
| 25 % | 83,95 % | 84,00 % | 34,09 % | 34,50 % | 100,00 % | 99,93 % |
| 50 % | 67,70 % | 67,60 % | 37,17 % | 37,27 % | 99,79 % | 99,49 % |

El nivel existencial se mantiene en **100,00 % en los once puntos** con las dos
medidas. La estructura del hallazgo —degrada dentro de los mundos violados y solo
allí— no cambia; la anchura media baja (348,75 frente a 365,00 mm/h al 50 %).

**Experimento 3 — virga** (5.000 mundos solo-virga):

| | D0 | D2 |
|---|---:|---:|
| existencial · ni P\* ni γP\* | 0,00 % | 0,00 % |
| banda-95 · ni P\* ni γP\* (todos) | 0,04 % | **0,06 %** |
| banda-95 · ni P\* ni γP\* (sin fallo δ) | 0,02 % | 0,05 % |
| banda-95 · anchura media | 343,19 | **330,60** mm/h |
| reparto D / C / E | 32,68 / 23,22 / 44,10 % | **35,24 / 20,16 / 44,60 %** |

`media-ponderada` y `kalman-estatico` siguen en 43,12 % y 41,58 %: la afirmación
del Ejemplo 3.1 queda cuantificada igual que antes.

### Fase C — el hindcast, como DESCRIPCIÓN

`npm run exp:hindcast` con la medida seleccionada, y `npm run exp:hindcast:d0`
para la comparación.

> ⚠ **Esta fase NO es una validación.** Los resultados bajo D0 ya eran conocidos
> antes de la selección, y la selección fue **solo sintética**. Ninguna cifra de
> abajo puede presentarse como confirmación independiente de la medida elegida.
> Se reporta porque describe qué hace el sistema corregido sobre entrada real, no
> porque lo valide.

**Reparto de métodos por evento:**

| | E1 · DANA (96 h) | E2 · Filomena (168 h) |
|---|---|---|
| D0 (antes) | 0 % / 93,8 % / 6,3 % | 0 % / 100 % / 0 % |
| **D2 (ahora)** | **76,0 % / 21,9 % / 2,1 %** | **99,4 % / 0,6 % / 0 %** |

Sí: **la rama de Dempster se abre en las horas tranquilas**, que es exactamente
lo que el suelo impedía. En E2 —un evento de nieve con precipitación líquida
equivalente baja y tres fuentes muy concordantes— pasa a aplicarse en 167 de 168
horas.

**Suelo observado vs suelo de la medida nueva:**

| | K crudo (D0) | d_J (D2) |
|---|---:|---:|
| suelo con acuerdo perfecto a 0 mm/h | 0,3651 **> κ₁** | 0,2727 **< κ₁** |
| mínimo observado en E1 | 0,3653 | 0,1297 |
| mínimo observado en E2 | 0,3651 | 0,2510 |
| mediana en E2 | 0,3652 | 0,2728 |

El mínimo observado seguía pegado al suelo bajo D0 (a 2·10⁻⁴ en E1, exactamente
en E2). Bajo D2 el mínimo de E1 cae **por debajo** del suelo de referencia
(0,1297 < 0,2727): d_J no está acotada inferiormente por el valor con acuerdo
perfecto y σ heterogéneas, porque no es un residuo que se reste.

**Horas critical y sus bloques:**

| | D0 (antes) | D2 (ahora) |
|---|---|---|
| E1 | 19 h en 4 bloques: 28-oct 00-04, 29-oct 07-14, 16-17, 19-22 | **idénticos**: 19 h, los mismos 4 bloques |
| E2 | 2 h: 08-ene 20:00-21:00 Z | **0 h** |

**¿Siguen ahora a la lluvia más que al conflicto?** En **E1 no cambia nada, y no
cambia porque ya seguían a la lluvia**: las horas critical tienen lluvia media de
4,09 mm/h frente a 0,37 en el resto, con las dos medidas, y los cuatro bloques
son hora por hora los mismos. Lo que cambia dentro de ellos es el método —de
13 cautelosas + 6 envolventes a 17 + 2—, no el veredicto. En **E2 sí cambia, y en
la dirección esperada**: las dos horas critical de D0 tenían lluvia 1,74 mm/h
(frente a 0,22 en el resto) pero un K_decision de 0,4363 con las tres fuentes
midiendo 1,4 / 2,1 / 1,58 mm/h — es decir, **acuerdo**. La escalada la producía
el suelo, no la precipitación: bajo D0 el método era la media cautelosa, la banda
se abría a [0, 30] mm/h y plUpper llegaba a 5,04·10⁻²; bajo D2 esas horas van a
Dempster, la banda se cierra a [0, 5] mm/h y plUpper cae a 1,06·10⁻⁴, tres
órdenes de magnitud. **Las dos horas critical de E2 eran un artefacto del suelo.**

**Las 5 horas clave de E1 con la medida nueva** (orden pignístico, el mismo
criterio de siempre):

| hora (Z) | prec. era5 / ifs / nasa | K crudo | **d_J** | método | plUpper | decisión |
|---|---|---:|---:|---|---:|---|
| 2024-10-29 17:00 | 2,90 / 18,20 / 1,35 | 0,9413 | **0,8303** | envolvente | 9,63·10⁻¹ | critical |
| 2024-10-29 16:00 | 1,30 / 7,90 / 1,37 | 0,7148 | **0,7039** | envolvente | 7,25·10⁻¹ | critical |
| 2024-10-29 19:00 | 10,40 / 8,80 / 0,76 | 0,7053 | **0,6746** | cautelosa | 1,04·10⁻¹ | critical |
| 2024-10-29 09:00 | 7,40 / 9,70 / 0,86 | 0,7084 | **0,6836** | cautelosa | 6,72·10⁻² | critical |
| 2024-10-29 11:00 | 6,30 / 10,10 / 1,63 | 0,6938 | **0,6640** | cautelosa | 6,40·10⁻² | critical |

El sesgo del orden pignístico que la iteración anterior declaró —«ordena por una
mezcla de intensidad y desacuerdo, porque la envolvente sube la esperanza
pignística»— **se atenúa**: con D0 las cinco horas seleccionadas eran las cinco
de envolvente; ahora solo dos lo son, y cuatro de las cinco coinciden con las que
selecciona `keyHoursBySourceMean`, que ordena por la media cruda de las fuentes y
es ciega al conflicto.

### Qué se compró y qué se pagó

**Comprado.** La rama de Dempster deja de ser inalcanzable con fuentes de
resolución dispar: de 0 de 264 horas del hindcast a 240 de 264. En mundos limpios
sintéticos el Nivel 1 sube del 58,8 % al 65,9 %, y la anchura media de la banda
de evidencia baja un 9,5 % en global y un 14,9 % en mundos limpios. Las dos horas
critical de E2 que eran artefacto del suelo desaparecen.

**Pagado, y hay que decirlo:**

1. La cobertura de banda-95 baja de 99,91 % a **99,72 %** en global y de 99,92 %
   a 99,75 % en mundos limpios. Sigue muy por encima del 95 % nominal y del piso
   pre-registrado del 99,5 %, pero es una pérdida real. En virga, la métrica «ni
   P\* ni γ·P\*» sube de 0,04 % a **0,06 %** (3 mundos de 5.000). **La soundness
   no se toca**: el nivel existencial sigue en 100,00 % en las tres campañas,
   bajo las tres medidas y en los once puntos del barrido de H1.
2. **El margen numérico se estrecha**: el peor K_global en la rama Dempster pasa
   de 0,4369 a 0,8024 y el peor factor 1/(1−K) de 1,442 a **2,631**. Es
   consecuencia directa de entrar en Dempster con más conflicto crudo. Sigue
   lejos del 20 que κ_deg autoriza, pero es 1,8× lo que se usaba.
3. **D2 no es uniformemente menos conservadora que D0, y eso puede sorprender.**
   d_J no está acotada por K en ninguna dirección: en el escenario s4 del harness
   K_máx = 3,2·10⁻⁹ y d_J = 0,0447, y en el barrido `smoke` un escenario de 200
   **escala** de media cautelosa a envolvente (d_J = 0,7014 > κ₂ frente a
   K = 0,6866 < κ₂). La corrección no es «relajar»; es medir otra cosa.
4. **La limitación de fondo sigue abierta.** D2 elimina la dependencia de la
   heterogeneidad de σ, pero κ₁ y κ₂ siguen declarados para un marco de
   discernimiento concreto. Un despliegue con otro marco debe volver a
   justificarlos.

### Estado en el código

**Corregido.** `assessConflict` resuelve la medida con `measureOf(config)`
(`src/core/dempster-shafer/conflict-measures.ts`) y alimenta a la regla con
`measureConflict`; `DEFAULT_FUSION_CONFIG.measure = 'D2'`. Las tres medidas
siguen disponibles por configuración (`FusionConfig.measure`) y los experimentos
aceptan `--measure` para reproducir cualquier número publicado bajo una medida
anterior (`npm run exp:all:d0`, `npm run exp:hindcast:d0`). `FusionResult` expone
`measure`, `measureConflict`, `measureMatrix` y `floorMatrix`, y esos campos
viajan a `out/<escenario>/result.json` y a las columnas `measure` y `K_measure`
de `summary.csv`.

**Los dos ejes son ortogonales y están separados en el código.** Solo C1 —la
regla del sistema— consulta la medida; C0, C2 y C3 están **congeladas sobre el K
crudo**, porque existen para reproducir números publicados y una regla congelada
que cambiara de significado al cambiar la medida no reproduciría nada.
`fusionConfigFor` hace que `--rule C0` implique D0 por ese motivo.

**(P1), (P2) y (P2′) intactas.** Son propiedades del K crudo y la guardia no ha
cambiado; sus property tests siguen verdes, y `global-conflict.property.test.ts`
fija ahora la medida a D0 explícitamente para que el eje que verifica sea el de
la regla. La afirmación «ninguna regla es menos conservadora que el K_máx del
paper» es cierta bajo D0 y **deliberadamente falsa** bajo D1 —que existe para
descontar el suelo—, y eso queda anotado allí.

**κ₁ y κ₂ no se han movido.** Siguen valiendo 0,3 y 0,7 (`src/lib/constants.ts`).

**Impacto en los cuatro escenarios del harness:** ninguno cambia de método de
fusión, de veredicto ni de decisión. s2 sigue dando plUpper = 1,559438e-4
exactamente, y los cuatro conservan su `credal`, su `reachable`, su `belLower` y
su `plUpper`. Lo único que cambia en `summary.csv` son las columnas nuevas
(`measure`, `K_measure`) y el valor de `K_decision`, que ahora es d_J: s1
0,0256 → 0,0545, s2 0,1576 → 0,1534, s3 0,9159 → 0,8847, s4 3,2e-9 → 0,0447.
**s3 sigue llegando a la envolvente por dos vías independientes**: la guardia
(K_global = 0,9512 ≥ κ_deg = 0,95) y la comparación con κ₂ (d_J = 0,8847 > 0,7).

**Impacto en el barrido `smoke`** (200 escenarios, semilla 20260804): las
estrategias pasan de 126/65/9 a **138/52/10** (D/C/E) — 14 escenarios suben de
cautelosa a Dempster, 2 bajan de Dempster a cautelosa y **1 escala de cautelosa a
envolvente**. Las decisiones pasan de 184/16 a **181/19** critical/warning: 4
bajan a warning y 1 sube a critical. Sin violaciones de bounds (0 antes y
después).

**Impacto en el hindcast de verificación** (24 h del pico de E1, en
`snapshots/`): el reparto pasa de 0/18/6 a **6/16/2** (D/C/E).

**Verificación.** `npm run exp:conflict-floor` (Fase A, semilla 20261007),
`npm run exp:all` (Fase B, semilla 20260804) y `npm run exp:hindcast` (Fase C);
`out/experiments/conflict-floor/results.json` lleva el criterio, la traza de la
selección paso a paso, la tabla del suelo recomputada por cada candidata y las
métricas de las tres.

---

## Resumen de estados

| # | Entrada | Clase | Paper | Código |
|---|---------|-------|-------|--------|
| 1 | Ec. (7), pesos de la media cautelosa | ERRATA | pendiente | corregido |
| 2 | Def. 3.6, conflicto global n-ario | EXTENSIÓN *(regla de decisión revisada por la entrada 9)* | pendiente | implementado |
| 3 | Prop. 4.1, redondeo IEEE-754 | SALVEDAD | pendiente | documentado |
| 4 | Def. 4.1 vs Ec. (24), error aditivo | ERRATA | pendiente | explícito |
| 5 | Def. 3.9 / Ec. (10), cola infinita del marco | EXTENSIÓN *(→ Def. 3.1 y Teo. 6.1 en v3)* | pendiente | corregido |
| 6 | Teo. 5.1, jacobiana numérica | SALVEDAD | pendiente | corregido |
| 7 | Def. 5.2 / Ec. (27), lifting en coma flotante | SALVEDAD | pendiente | corregido |
| 8 | Def. 3.9 / Ec. (10), "el bound externo es suficiente" | EXTENSIÓN *(→ Def. 3.9′ y Def. 5.5′ en v3)* | pendiente | **implementado** |
| 9 | Def. 3.5-3.6, la magnitud Y la escala con que se comparan κ₁/κ₂ | ERRATA DE DISEÑO, **tres capas** *(→ sección propia en v3: regla C1 + medida D2)* | pendiente | **corregido** *(dos experimentos pre-registrados)* |
