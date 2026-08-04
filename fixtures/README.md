# Fixtures

Respuestas de API congeladas que alimentan el modo offline
(`src/data/sources/offline.ts`) y el pipeline reproducible (`npm run repro`).

Cada escenario contiene la respuesta de las tres fuentes **en el formato real de
su API**, más un `manifest.json` con descripción, procedencia, fecha y los
valores de precipitación que debe producir la ingesta.

## Escenarios

| Escenario | Precipitación (mm/h): aemet / open-meteo / nasa-power | Qué ejercita |
|---|---|---|
| `s1-normal` | 0,0 / 0,0 / 0,0 | Día seco; toda la masa en *nula* |
| `s2-light-rain` | 8,0 / 9,0 / 7,5 | Escenario de referencia de §7. Reproduce `plUpper ≈ 1,559e-4` |
| `s3-virga-conflict` | 3,0 / 18,0 / 25,0 | Conflicto tipo virga (Ejemplo 3.1): satélite ~25 mm/h en altura contra pluviómetro ~3 mm/h en superficie. `K_global = 0,95` → rama de envolvente |
| `s4-extreme` | 45,0 / 46,0 / 44,5 | **Sintético.** Torrencial concordante; `Bel(E) ≈ 1` |

## Procedencia

| Fichero | Procedencia |
|---|---|
| `s1-normal/open-meteo.json` | **Real**: capturado de la API el 2026-08-04 |
| `s1-normal/nasa-power.json` | **Real**: capturado de la API el 2026-08-04, día 2026-08-01 |
| Resto de `open-meteo.json` y `nasa-power.json` | **Sintético**: estructura real de la API, valores fijados |
| Todos los `aemet-*.json` | **Sintético**: estructura documentada de AEMET OpenData. No se pudo capturar una respuesta real porque el endpoint exige API key |

`s4-extreme` está etiquetado como sintético también en su `manifest.json`: no
corresponde a ninguna observación y existe solo para ejercitar el régimen de
`Bel(E) ≈ 1`.

## Estructura por fuente

- **Open-Meteo** — `open-meteo.json`, respuesta de `/v1/forecast` con
  `current=precipitation,wind_speed_10m,temperature_2m`.
  `current.precipitation` es el acumulado de la hora precedente en mm, que sobre
  una hora es mm/h.
- **AEMET OpenData** — dos ficheros, porque la API responde en dos pasos:
  `aemet-metadata.json` es el sobre (`estado`, `descripcion`, URL `datos`) y
  `aemet-observacion.json` el array de observaciones convencionales que se
  descarga de esa URL. Se toma la estación más cercana al punto pedido; en todos
  los escenarios es `3129 MADRID, CIUDAD UNIVERSITARIA`. `prec` son mm
  acumulados en la última hora = mm/h.
- **NASA POWER** — `nasa-power.json`, respuesta de `/api/temporal/hourly/point`.
  `PRECTOTCORR` viene en **mm/day** también en el endpoint horario: es la tasa
  instantánea expresada por día, y se convierte a mm/h dividiendo por 24.
  Verificado contra la API (Madrid-Chamartín, 2026-03-10): las 24 horas suman
  85,22 y su **media**, 3,551, es exactamente el valor diario 3,55.
  `s3` y `s4` dejan las dos últimas horas con `fill_value` (−999) para ejercitar
  la latencia del reanálisis: el cliente retrocede hasta la última hora con dato
  válido simultáneo en las tres variables.

## Uso

```bash
AURA_OFFLINE=1 AURA_FIXTURE_SCENARIO=s2-light-rain npm run dev
```

O explícitamente, sin depender del entorno:

```ts
const measurements = await ingestAll({ offline: true, scenario: 's2-light-rain' });
```

## Re-capturar los datos reales

```bash
curl "https://api.open-meteo.com/v1/forecast?latitude=40.4718&longitude=-3.6828\
&current=precipitation,wind_speed_10m,temperature_2m&wind_speed_unit=kmh"

curl "https://power.larc.nasa.gov/api/temporal/hourly/point?parameters=PRECTOTCORR,WS10M,T2M\
&community=RE&longitude=-3.6828&latitude=40.4718&start=20260801&end=20260801&format=JSON"

# AEMET exige clave; el segundo paso descarga la URL que devuelve el primero.
curl "https://opendata.aemet.es/opendata/api/observacion/convencional/todas/?api_key=$AEMET_API_KEY"
```

Recapturar cambia los números del pipeline. Después hay que ejecutar
`npm run repro`, revisar el diff y regenerar los snapshots **deliberadamente**
con `npm run snapshots:update`.
