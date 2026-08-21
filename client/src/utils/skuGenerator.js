/**
 * skuGenerator — generador de SKUs sugerido para productos nuevos.
 *
 * Formato: `<PREFIJO>-XXXX`
 *   - PREFIJO: 3 letras derivadas del nombre de la categoría
 *     (en mayúsculas, sin acentos ni caracteres no alfabéticos).
 *     Si la categoría no tiene letras útiles → "PRD".
 *   - XXXX: 4 caracteres alfanuméricos aleatorios (A-Z, 0-9)
 *     usando crypto.getRandomValues cuando esté disponible
 *     (en navegadores modernos), Math.random como fallback.
 *
 * La unicidad NO se garantiza aquí — el server valida con el
 * índice único sobre `productos.sku` y devuelve ER_DUP_ENTRY
 * si choca. Para reducir el riesgo de colisión en catálogos
 * grandes, podés pasar `existingSkus` (Set o array) y el
 * generador reintentará hasta 10 veces antes de devolver
 * `null` (en ese caso, el caller decide si usar un fallback
 * o pedirle al usuario que lo escriba a mano).
 */

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const FALLBACK_PREFIX = 'PRD';
const RANDOM_LEN = 4;
const MAX_ATTEMPTS = 10;

/**
 * Genera un SKU sugerido. Si se pasa `existingSkus` (Set o array),
 * se asegura de que el valor retornado NO esté en él.
 *
 * @param {string} [categoryName] nombre de la categoría (opcional)
 * @param {Set<string>|string[]} [existingSkus] SKUs ya usados (opcional)
 * @returns {string|null} SKU generado, o null si no se pudo evitar colisión
 */
export function generateSKU(categoryName, existingSkus) {
  const prefix = derivePrefix(categoryName);
  const taken = toSet(existingSkus);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = `${prefix}-${randomCode(RANDOM_LEN)}`;
    if (!taken || !taken.has(candidate)) return candidate;
  }
  // No hubo suerte en 10 intentos: improbable con 36^4 = 1.7M combinaciones
  // por prefijo, pero por si el catálogo tiene colisiones masivas,
  // devolvemos null para que el caller sepa que no pudo autogenerar.
  return null;
}

/**
 * Igual que `generateSKU` pero garantiza devolver un string: si
 * no logra evitar colisión, devuelve un código con un sufijo
 * numérico extra (poco probable, pero a prueba de balas).
 */
export function generateSKUForced(categoryName, existingSkus) {
  const direct = generateSKU(categoryName, existingSkus);
  if (direct) return direct;
  const prefix = derivePrefix(categoryName);
  const taken = toSet(existingSkus);
  // Segundo intento: prefijo + random + sufijo numérico 00..99
  for (let i = 0; i < 100; i++) {
    const candidate = `${prefix}-${randomCode(RANDOM_LEN)}-${String(i).padStart(2, '0')}`;
    if (!taken || !taken.has(candidate)) return candidate;
  }
  // Realmente no se pudo: cae al fallback más simple.
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

// ──────────────────────────────────────────────────────────────────────

function derivePrefix(categoryName) {
  if (!categoryName) return FALLBACK_PREFIX;
  // Eliminar acentos y caracteres no alfabéticos; mayúsculas.
  // El rango \u00C0-\u00FF cubre las letras acentuadas latinas.
  const cleaned = String(categoryName)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z]/g, '');
  if (cleaned.length === 0) return FALLBACK_PREFIX;
  return cleaned.substring(0, 3).toUpperCase();
}

function randomCode(length) {
  const arr = new Uint32Array(length);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < length; i++) arr[i] = Math.floor(Math.random() * 0x100000000);
  }
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CHARS[arr[i] % CHARS.length];
  }
  return out;
}

function toSet(value) {
  if (!value) return null;
  if (value instanceof Set) return value;
  if (Array.isArray(value)) return new Set(value);
  return null;
}
