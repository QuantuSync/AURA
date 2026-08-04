/**
 * AURA v2 — Constantes del sistema
 */

import { FrameOfDiscernment } from '@/core/dempster-shafer/types';
import { createFrame } from '@/core/dempster-shafer/frame';

/**
 * P_máx de la precipitación: **500 mm/h**.
 *
 * Cierra la hipótesis de cola *torrencial* del marco de la Definición 3.1,
 * que el paper deja abierta en [60, ∞). Ver docs/ERRATA.md §5.
 *
 * QUÉ ES: un bound conservador de PLAUSIBILIDAD FÍSICA, elegido muy por encima
 * de los récords mundiales registrados de intensidad horaria de precipitación
 * (que están en el orden de las decenas a ~300 mm en una hora, en eventos
 * tropicales extremos; para latitudes medias como la de la demo, un orden de
 * magnitud menos). 500 mm/h deja por tanto un margen amplio sobre cualquier
 * evento observado, que es lo que exige una hipótesis de la que depende la
 * validez del certificado: se prefiere un bound holgado y creíble a uno ceñido
 * y frágil.
 *
 * QUÉ NO ES: una calibración. No sale de ningún dataset ni de ninguna
 * estimación estadística sobre la serie local, y no debe leerse como "el máximo
 * esperable en Madrid-Chamartín". Es una declaración explícita de dominio de
 * validez — la hipótesis H0 del certificado— y como tal es sustituible: quien
 * despliegue el sistema en una región con climatología distinta debe
 * redeclararla, y el certificado mostrará el valor que se usó.
 *
 * Consecuencia operativa: con la cola plausible, el intervalo credal llega
 * hasta 500 mm/h y el certificado resultante será casi siempre
 * 'unsafe-possible'. Eso NO es un defecto del bound: es la señal correcta de
 * que la evidencia disponible no descarta un evento extremo. Estrechar el
 * intervalo es tarea de la evidencia (fuentes que quiten plausibilidad a la
 * cola), no del bound.
 */
export const PRECIPITATION_DOMAIN_BOUND = 500;

/**
 * V_máx del viento: **500 km/h**.
 *
 * Cierra la hipótesis de cola *huracán*. Mismo criterio que
 * {@link PRECIPITATION_DOMAIN_BOUND}: muy por encima de la ráfaga superficial
 * más alta jamás registrada (≈ 400 km/h), bound de plausibilidad física y no
 * calibración.
 */
export const WIND_DOMAIN_BOUND = 500;

export const PRECIPITATION_FRAME: FrameOfDiscernment = createFrame({
  variable: 'precipitation',
  unit: 'mm/h',
  hypotheses: [
    { label: 'nula', lower: 0, upper: 5 },
    { label: 'ligera', lower: 5, upper: 15 },
    { label: 'moderada', lower: 15, upper: 30 },
    { label: 'intensa', lower: 30, upper: 60 },
    // Def. 3.1 la escribe como [60, ∞); H0 la cierra en el bound declarado.
    { label: 'torrencial', lower: 60, upper: PRECIPITATION_DOMAIN_BOUND },
  ],
  domainBound: PRECIPITATION_DOMAIN_BOUND,
});

export const WIND_FRAME: FrameOfDiscernment = createFrame({
  variable: 'wind_speed',
  unit: 'km/h',
  hypotheses: [
    { label: 'calma', lower: 0, upper: 20 },
    { label: 'brisa', lower: 20, upper: 50 },
    { label: 'viento_fuerte', lower: 50, upper: 90 },
    { label: 'tempestad', lower: 90, upper: 120 },
    { label: 'huracan', lower: 120, upper: WIND_DOMAIN_BOUND },
  ],
  domainBound: WIND_DOMAIN_BOUND,
});

export const DEFAULT_KAPPA1 = 0.3;
export const DEFAULT_KAPPA2 = 0.7;
