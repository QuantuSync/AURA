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

Referencia teórica: ver `docs/AURA_paper_interno.pdf`.

## Stack

- **Motor matemático**: TypeScript puro (sin dependencias, ejecutable en cliente y serverless)
- **Frontend**: Next.js 14 + React + Tailwind CSS
- **Visualización**: Recharts / D3.js
- **Tests**: Vitest
- **Despliegue**: Vercel

## Desarrollo

```bash
npm install
npm run dev        # Servidor de desarrollo (localhost:3000)
npm run test       # Tests con Vitest (watch mode)
npm run test:run   # Tests una vez
npm run build      # Build de producción
```

## Trazabilidad matemática

Cada módulo referencia las definiciones, lemas y teoremas del paper AURA interno:

- `bpa.ts` → Definiciones 3.1-3.4
- `conflict.ts` → Definición 3.6
- `combination.ts` → Ecuaciones (3)-(7)
- `credal-set.ts` → Definiciones 3.5, 3.9, Proposiciones 3.5-3.6
- `arithmetic.ts` → Definición 4.4, Proposición (soundness)
- `zonotope.ts` → Definición 5.1, Teorema 5.1
- `propagation.ts` → Teorema 5.2
- `reachability.ts` → Definición 5.3, Teorema 5.4 (end-to-end)

## Licencia

Uso interno. © Dr. Lucas Alaniz Pintos.
