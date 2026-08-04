import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    // Los 5 s por defecto están calibrados para tests unitarios, y la suite
    // incluye los ficheros de `__tests__/properties/` con FC_NUM_RUNS = 1000:
    // B10 ejecuta ≥ 500 muestras Monte Carlo por caso generado y roza ese
    // límite. Al corregir ERRATA §9 lo cruzó, no por haberse roto nada sino
    // porque la regla nueva manda más escenarios a la rama de Dempster, que es
    // la cara. 30 s deja margen y sigue siendo un cortafuegos real: nada de lo
    // que hay aquí pasa hoy de 6 s. La campaña larga
    // (`npm run test:properties`, 20.000 casos) lo sube a 600 s por su cuenta.
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
