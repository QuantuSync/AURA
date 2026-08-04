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
  contradice. La ruta de alto conflicto usa la BPA sintética de
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

## 9 · Definición 3.6 — κ₁ y κ₂ están declarados para K_máx y se reutilizan para K_global

**Clase:** SALVEDAD
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
cobertura ha medido y que el paper no declara en ninguna parte.

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

Medido (`npm run exp:coverage`, 10.000 mundos, semilla 20260804; ver
`scripts/experiments/README.md`), sobre los 7.258 mundos **sin fallo de fuente y
sin conflicto físico**:

| estrategia elegida | fracción |
|---|---:|
| Dempster (K_decision ≤ 0,3) | 54,1 % |
| cautelosa (0,3 < K_decision ≤ 0,7) | 30,3 % |
| envolvente (K_decision > 0,7) | 15,6 % |

Casi la mitad de los mundos *tranquilos* no llegan al Nivel 1. Los cuatro
escenarios de `fixtures/` sugieren lo contrario (K_global = 0,027 / 0,184 /
0,951 / 3,3e-9: Dempster en tres de cuatro), porque fijan mediciones que
concuerdan dentro de ±0,75 mm/h — media desviación estándar de la fuente más
precisa.

Consecuencia práctica, no de soundness: en la mitad de los casos ordinarios la
salida es la BPA sintética de la envolvente o una media cautelosa, y la banda de
evidencia al 95 % pasa de una mediana de 30 mm/h a los 500 mm/h del marco
entero. El sistema **no se equivoca** —pierde informatividad, que es la
dirección conservadora— pero lo hace mucho más a menudo de lo que el paper deja
suponer.

### Corrección propuesta

No tocar κ₁ ni κ₂: ajustarlos a la vista de esta medición sería exactamente el
error que la campaña prohíbe. Lo que hay que añadir a §3.4.2 es la **declaración
del régimen de validez de los umbrales**:

1. Decir explícitamente que κ₁ = 0,3 y κ₂ = 0,7 fueron elegidos para el K por
   pares de la Definición 3.5, y que aplicarlos a K_decision los vuelve más
   estrictos de un modo que **depende de n y de la granularidad del marco**.
2. Declarar la dependencia: para un mismo escenario físico, K_global crece con
   el número de fuentes y con la anchura relativa de las hipótesis frente a σ_i.
   Un marco más fino con la misma evidencia produce MÁS conflicto aparente, no
   menos.
3. Anotar en §7 que los escenarios de la demo tienen una concordancia
   inter-fuente muy por encima de la que implica su propia caracterización de
   σ_i, y no deben leerse como el caso medio.

Una v3 que quiera recuperar el punto de operación tiene dos vías legítimas, y
ninguna es mover κ: normalizar K_global por n (p. ej. `1 − (1−K_global)^{1/(n−1)}`,
que lo devuelve a la escala del K por pares) o descontar la parte del conflicto
atribuible a la discretización. Las dos son cambios de **definición**, no de
umbral, y las dos exigen rehacer (P1)/(P2).

### Estado en el código

**Sin cambios, deliberadamente.** `assessConflict` sigue comparando K_decision
con κ₁ y κ₂ tal cual (`src/lib/constants.ts`: `DEFAULT_KAPPA1 = 0.3`,
`DEFAULT_KAPPA2 = 0.7`). La regla dura de la campaña de cobertura es que ningún
parámetro de AURA se ajusta a la vista de sus resultados: esto se **reporta**,
no se corrige aquí.

**Verificación.** El reparto está en
`out/experiments/coverage/results.json → fusionByCondition`, reproducible con
`npm run exp:coverage`, y el desglose por γ del conflicto físico en
`out/experiments/virga/results.json → fusion.byGamma`.

---

## Resumen de estados

| # | Entrada | Clase | Paper | Código |
|---|---------|-------|-------|--------|
| 1 | Ec. (7), pesos de la media cautelosa | ERRATA | pendiente | corregido |
| 2 | Def. 3.6, conflicto global n-ario | EXTENSIÓN | pendiente | implementado |
| 3 | Prop. 4.1, redondeo IEEE-754 | SALVEDAD | pendiente | documentado |
| 4 | Def. 4.1 vs Ec. (24), error aditivo | ERRATA | pendiente | explícito |
| 5 | Def. 3.9 / Ec. (10), cola infinita del marco | EXTENSIÓN *(→ Def. 3.1 y Teo. 6.1 en v3)* | pendiente | corregido |
| 6 | Teo. 5.1, jacobiana numérica | SALVEDAD | pendiente | corregido |
| 7 | Def. 5.2 / Ec. (27), lifting en coma flotante | SALVEDAD | pendiente | corregido |
| 8 | Def. 3.9 / Ec. (10), "el bound externo es suficiente" | EXTENSIÓN *(→ Def. 3.9′ y Def. 5.5′ en v3)* | pendiente | **implementado** |
| 9 | Def. 3.6, κ₁/κ₂ declarados para K_máx y usados con K_global | SALVEDAD | pendiente | sin cambios *(se reporta, no se ajusta)* |
