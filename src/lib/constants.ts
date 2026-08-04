/**
 * AURA v2 — Constantes del sistema
 */

import { FrameOfDiscernment } from '@/core/dempster-shafer/types';

export const PRECIPITATION_FRAME: FrameOfDiscernment = {
  variable: 'precipitation',
  unit: 'mm/h',
  hypotheses: [
    { label: 'nula', lower: 0, upper: 5 },
    { label: 'ligera', lower: 5, upper: 15 },
    { label: 'moderada', lower: 15, upper: 30 },
    { label: 'intensa', lower: 30, upper: 60 },
    { label: 'torrencial', lower: 60, upper: Infinity },
  ],
};

export const WIND_FRAME: FrameOfDiscernment = {
  variable: 'wind_speed',
  unit: 'km/h',
  hypotheses: [
    { label: 'calma', lower: 0, upper: 20 },
    { label: 'brisa', lower: 20, upper: 50 },
    { label: 'viento_fuerte', lower: 50, upper: 90 },
    { label: 'tempestad', lower: 90, upper: 120 },
    { label: 'huracan', lower: 120, upper: Infinity },
  ],
};

export const DEFAULT_KAPPA1 = 0.3;
export const DEFAULT_KAPPA2 = 0.7;
