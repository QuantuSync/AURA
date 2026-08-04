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

## Cuándo entra en `npm run verify`

Un experimento entra en la verificación cuando su salida es **determinista y
barata**: se añade su script a `package.json` y su paso a `scripts/verify.ts`, y
su salida pasa a `snapshots/` con `npm run snapshots:update`. A partir de ahí,
cualquier deriva en sus números aparece como diff en el pull request.

Los experimentos **caros** (campañas Monte Carlo largas, hindcast sobre series
históricas) no entran en `verify`: se lanzan a mano y su resultado se registra en
el README o en `docs/`, citando semilla y flags.

## Experimentos previstos

Todos usarán este runner:

- **Cobertura Monte Carlo** — muestreo de mundos compatibles con H0–H3 y
  verificación empírica de `Bel(E) ≤ P(E) ≤ Pl(E)` sobre el pipeline completo.
  Extiende a un régimen largo lo que la property B10 comprueba con 20.000 casos.
- **Comparación con baselines** — el mismo escenario resuelto por media
  ponderada, filtro de Kalman y fusión bayesiana ingenua, contrastando qué
  garantía puede emitir cada uno.
- **Hindcast** — el pipeline sobre series históricas reales de AEMET, para
  calibrar por fin `ε_h` con la Def. 4.4 / Ec. (25) y sustituir los valores hoy
  **declarados** (`DEMO_H_MODEL_ERROR_BOUND`, `SOURCE_CHARACTERIZATIONS`) por
  otros calibrados.
