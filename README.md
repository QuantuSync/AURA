# AURA v2

**Autonomous Uncertainty-Aware Resilience Architecture**

Plataforma de fusión de datos con cuantificación formal de incertidumbre para decisiones en infraestructura crítica.

## Arquitectura

AURA integra tres capas matemáticas en un pipeline operativo:

| Capa | Función | Framework | Módulo |
|------|---------|-----------|--------|
| 1 | Fusión de datos | Dempster-Shafer + Conjuntos credales | `src/core/dempster-shafer/` |
| 2 | Modelado causal | SCM + Aritmética de intervalos | `src/core/causal-dag/` |
| 3 | Verificación | Zonotopes + Reachability | `src/core/zonotope/` |

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
- **Frontend**: Next.js 14 + React + Tailwind CSS
- **Visualización**: Recharts / D3.js
- **Tests**: Vitest
- **Despliegue**: Vercel

## Desarrollo

```bash
npm install
npm run dev              # Servidor de desarrollo (localhost:3000)
npm run test             # Tests con Vitest (watch mode)
npm run test:run         # Suite completa, incluidas las properties (1.000 casos c/u)
npm run test:properties  # Solo properties, 20.000 casos por propiedad
npm run build            # Build de producción
```

Las properties se parametrizan por entorno: `FC_NUM_RUNS` (casos por
propiedad), `FC_SEED` (semilla; fija por defecto para que CI sea
reproducible) y `FC_VERBOSE=1`. Para reproducir un fallo concreto, pasar la
semilla que fast-check reporta:

```bash
FC_SEED=20260804 FC_NUM_RUNS=50000 npx vitest run __tests__/properties
```

## Trazabilidad matemática

Cada módulo referencia definiciones, lemas y teoremas de `papers/AURA_v2.pdf`,
con su sección real:

| Módulo | Referencias normativas | Sección |
|--------|------------------------|---------|
| `dempster-shafer/types.ts` | Def. 3.1, 3.2, 3.3, 3.7, 3.8 | §3.2–3.5 |
| `dempster-shafer/bpa.ts` | Def. 3.3 y Ec. (1)-(2); Def. 3.4 y Ec. (3)-(4) | §3.2–3.3 |
| `dempster-shafer/conflict.ts` | Def. 3.5 y Ec. (6); Def. 3.6 *(+ K_global, extensión)* | §3.4 |
| `dempster-shafer/combination.ts` | Ec. (5)-(6) Dempster; Ec. (7) cautelosa; Def. 3.7 y Ec. (8)-(9) | §3.4 |
| `dempster-shafer/credal-set.ts` | Def. 3.8; Prop. 3.1, 3.2; Def. 3.9 y Ec. (10) | §3.4–3.6 |
| `intervals/` | Def. 4.2 y Ec. (20)-(23); Prop. 4.1 | §4.4.1 |
| `causal-dag/` | Def. 4.1; Def. 4.3 y Ec. (24); Def. 4.4 y Ec. (25); Teo. 4.1 | §4.2, §4.4.2, §4.5 |
| `causal-dag/demo-dag.ts` | Ec. (34) *(modelo de acumulación de la demo)* | §7.3 |
| `zonotope/types.ts` | Def. 5.1 y Ec. (26) | §5.2 |
| `zonotope/zonotope.ts` | Obs. 5.1; Def. 5.2 y Ec. (27) *(Puente 2→3)*; Obs. 5.2 (Girard) | §5.2–5.4 |
| `zonotope/propagation.ts` | Teo. 5.1 y Ec. (28)-(29) | §5.4 |
| `zonotope/linearization.ts` | Teo. 5.1 (cota de Lagrange automática) | §5.4 |
| `zonotope/reachability.ts` | Def. 5.3 | §5.5 |
| `decision/synthesis.ts` | Def. 5.5 y Ec. (31); Teo. 5.2; Teo. 6.1 (H1–H3) | §5.5, §6.3 |

> **Correcciones de numeración.** Iteraciones anteriores del código se
> escribieron sin acceso al paper y citaban referencias desalineadas: el
> conjunto credal como Def. 3.5 (es 3.8), la aritmética de intervalos como
> Def. 4.4 (es 4.2), la propagación zonotópica como Teo. 5.2 (es 5.1), la
> cobertura como Prop. 3.5 (es 3.1), un inexistente "Teo. 5.4 end-to-end" (es
> el Teo. 6.1) y las ecuaciones de la envolvente como (6)-(7) (son (8)-(9)).
> Todas corregidas.

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

Cada propiedad ejecuta `FC_NUM_RUNS` casos generados: **1.000** en `test:run`
(CI) y **20.000** en `test:properties`. Campaña de referencia: 74 propiedades ×
20.000 casos (más 7 contraejemplos deterministas de regresión), semilla 20260804
— todas pasan.

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

### Hallazgos del property-based testing

Cuatro defectos reales encontrados por las properties y la revisión que
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
4. **El intervalo credal se trunca sin respaldo formal cuando la cola del marco
   es plausible.** La Ec. (10) devuelve `+∞` para el marco de la Def. 3.1
   (última hipótesis `[60, ∞)`), y `buildCredalSet` lo sustituía en silencio
   por `a_j · 2` filtrando además por `Pl > 0,01`. Si el valor real supera ese
   corte, queda fuera del conjunto credal y **H1 del Teo. 6.1 deja de
   cumplirse**, invalidando cualquier certificado aguas abajo. *Registrado, no
   corregido*: la corrección exige que el bound superior sea un parámetro
   declarado del marco y viaje en el certificado. Ver
   [`docs/ERRATA.md`](docs/ERRATA.md) §5.

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
- El intervalo credal continuo (Def. 3.9, Ec. 10) se **trunca** cuando la
  hipótesis de cola abierta del marco es plausible, porque el paper produce
  ahí un bound `+∞` inutilizable aguas abajo. El truncamiento no es sound:
  rompe el Lema 6.1 si el valor real lo supera. Ver
  [`docs/ERRATA.md`](docs/ERRATA.md) §5 y la advertencia en `buildCredalSet`.
- `severityScore` (`decision/synthesis.ts`) es una heurística de priorización,
  **no** una probabilidad de violación. El veredicto formal lo da
  `certifySafety`.

## Licencia

Uso interno. © Dr. Lucas Alaniz Pintos.
