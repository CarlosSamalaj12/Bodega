/**
 * Helper centralizado para chequear permisos del usuario.
 *
 * Convención del backend (server.js permissionDefaults + getUserPermissionsMap):
 *   - Los permisos se guardan como número: 1 (activo) o 0 (inactivo).
 *   - Si un permiso no existe en el objeto `permisos`, se considera activo
 *     por defecto (modo permisivo para usuarios sin permisos granulares).
 *
 * Esta función normaliza la comparación: oculta cuando el valor es
 * `false` o `0`, muestra en cualquier otro caso (incluyendo `true`, `1`,
 * `undefined`, ausente). Así se evita el bug clásico de
 * `permisos[key] !== false` que no captura el caso `0`.
 *
 * @param {object|undefined|null} permisos - objeto user.permisos
 * @param {string} key - clave del permiso, ej. 'section.view.ajustes'
 * @returns {boolean} true si el permiso está activo o no definido
 */
export function hasPermission(permisos, key) {
  if (!permisos || typeof permisos !== 'object') return true;
  if (Object.keys(permisos).length === 0) return true;
  const v = permisos[key];
  return !(v === false || v === 0);
}
