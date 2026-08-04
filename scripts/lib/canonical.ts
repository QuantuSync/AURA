/**
 * AURA v2 — Serialización canónica
 *
 * Determinismo byte a byte de los artefactos de `npm run repro`. Dos
 * ejecuciones sobre el mismo commit deben producir ficheros IDÉNTICOS, y los
 * snapshots versionados desde una máquina deben coincidir con los que genera el
 * runner de CI en otra.
 *
 * Tres fuentes de no-determinismo, y cómo se cierra cada una:
 *
 *  1. ORDEN DE CLAVES. `JSON.stringify` respeta el orden de inserción del
 *     objeto, que depende de cómo se construyó. {@link canonicalize} ordena
 *     todas las claves alfabéticamente.
 *
 *  2. RUIDO EN EL ÚLTIMO BIT. La misma expresión puede diferir en unos ulp entre
 *     versiones de V8 o arquitecturas. {@link canonicalNumber} redondea a
 *     {@link SIGNIFICANT_DIGITS} cifras significativas, que están muy por encima
 *     de la precisión con que se interpretan estos resultados (el `plUpper` de
 *     referencia se cita con 4) y muy por debajo de las 17 en que vive el ruido.
 *
 *  3. VALORES NO REPRESENTABLES EN JSON. `Infinity` y `NaN` se serializan como
 *     `null`, y `safeRegion.lower = -Infinity` es un valor legítimo y con
 *     significado del pipeline. Se emiten como las cadenas `"-Infinity"`,
 *     `"Infinity"` y `"NaN"`, que sí sobreviven al viaje de ida y vuelta.
 *
 * Lo que NO se resuelve aquí, porque no se puede: cualquier `Date.now()` o
 * `Math.random()` dentro del cómputo. El pipeline los evita, y los campos que sí
 * los llevan (`CertifiedDecision.timestamp`) se excluyen explícitamente de la
 * serialización en `reproduce.ts`.
 */

/**
 * Cifras significativas conservadas. 12 deja ~5 órdenes de margen frente al
 * ruido de coma flotante (que aparece a partir de la 15.ª–17.ª) sin perder
 * ninguna cifra que se interprete.
 */
export const SIGNIFICANT_DIGITS = 12;

/** Redondea a {@link SIGNIFICANT_DIGITS}. Los no finitos pasan intactos. */
export function canonicalNumber(x: number): number {
  if (!Number.isFinite(x) || x === 0) return x;
  return Number(x.toPrecision(SIGNIFICANT_DIGITS));
}

/** Representación textual estable de un número, incluidos los no finitos. */
export function formatNumber(x: number): string {
  if (Number.isNaN(x)) return 'NaN';
  if (x === Infinity) return 'Infinity';
  if (x === -Infinity) return '-Infinity';
  return String(canonicalNumber(x));
}

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/**
 * Normaliza un valor a una forma serializable y determinista: claves ordenadas,
 * números redondeados, no finitos como cadena.
 *
 * Los arrays conservan su orden — es información, no accidente (las masas de un
 * BPA, los pasos de una reducción secuencial).
 *
 * @throws ante `undefined` dentro de un array o ante un tipo no serializable
 *         (función, símbolo, BigInt). Callarlo produciría un `null` silencioso
 *         en mitad de un resultado que se publica.
 */
export function canonicalize(value: unknown): Json {
  if (value === null) return null;

  if (typeof value === 'number') {
    return Number.isFinite(value) ? canonicalNumber(value) : formatNumber(value);
  }
  if (typeof value === 'string' || typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    return value.map((v) => {
      if (v === undefined) {
        throw new Error('canonicalize: `undefined` dentro de un array no es serializable.');
      }
      return canonicalize(v);
    });
  }

  if (typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: { [k: string]: Json } = {};
    // Orden alfabético estable e independiente del locale de la máquina.
    for (const key of Object.keys(src).sort()) {
      const v = src[key];
      if (v === undefined) continue; // campo opcional ausente: se omite, no se emite null
      out[key] = canonicalize(v);
    }
    return out;
  }

  throw new Error(`canonicalize: tipo no serializable '${typeof value}'.`);
}

/**
 * JSON canónico con indentación de 2 y salto de línea final.
 *
 * El salto final es deliberado: sin él, `git diff` marca «\ No newline at end of
 * file» en cada snapshot y el diff de una divergencia real queda enterrado.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value), null, 2) + '\n';
}

/** Escapa un campo CSV según RFC 4180 (comillas dobles duplicadas). */
export function csvField(value: string | number): string {
  const s = typeof value === 'number' ? formatNumber(value) : value;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV con terminador `\n` (no `\r\n`: debe ser idéntico en Windows y Linux). */
export function toCsv(header: readonly string[], rows: readonly (string | number)[][]): string {
  return [header, ...rows].map((r) => r.map(csvField).join(',')).join('\n') + '\n';
}
