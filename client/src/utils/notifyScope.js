/**
 * notifyScope — helper para decidir si un evento de Socket.IO
 * (stock:changed, pedido:changed, movimiento:changed) debe generar
 * una notificación para el usuario actual.
 *
 * Reglas:
 *   - Admin/reportes sin restricción de bodegas (`canAllBodegas=true` y
 *     `allowedBodegaIds` vacío) → siempre notificar.
 *   - Admin/reportes con bodegas restringidas (REPORTE) → solo si alguna
 *     de las bodegas del evento está en `allowedBodegaIds`.
 *   - Bodegueros (`canAllBodegas=false`) → solo si alguna de las bodegas
 *     del evento coincide con su `id_warehouse`.
 *   - Si el evento no trae NINGÚN identificador de bodega → NO notificar
 *     (era el bug original: "!payloadBodega" se trataba como "permitir").
 *   - Si el usuario no tiene `id_warehouse` → no notificar (defensivo).
 *
 * Esta función es pura (no accede a hooks/estado) para poder usarla
 * desde handlers de socket dentro de useEffect.
 */

/**
 * Extrae todos los identificadores de bodega presentes en un payload
 * de socket. Soporta los campos que actualmente emiten el server:
 *   - id_bodega (stock:changed)
 *   - requester_warehouse_id / requested_from_warehouse_id (pedido:changed)
 *   - id_bodega_origen / id_bodega_destino (movimiento:changed)
 */
export function extractBodegaIdsFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const candidates = [
    payload.id_bodega,
    payload.requester_warehouse_id,
    payload.requested_from_warehouse_id,
    payload.id_bodega_origen,
    payload.id_bodega_destino,
  ];
  const out = [];
  const seen = new Set();
  for (const raw of candidates) {
    const n = Number(raw || 0);
    if (n > 0 && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

/**
 * Devuelve true si el evento involucra la bodega del usuario o, si es
 * admin/reportes, sus bodegas permitidas.
 *
 * @param {object} payload            Event payload del socket
 * @param {object} ctx
 * @param {number} ctx.userBodegaId   id_warehouse del usuario actual
 * @param {boolean} ctx.canAllBodegas true si el rol ve todas las bodegas
 * @param {number[]} [ctx.allowedBodegaIds] bodegas permitidas (REPORTE)
 */
export function isEventForCurrentBodega(payload, { userBodegaId, canAllBodegas, allowedBodegaIds } = {}) {
  const ids = extractBodegaIdsFromPayload(payload);
  const myId = Number(userBodegaId || 0);

  // Usuario sin bodega asignada: tampoco notificamos (defensivo).
  if (!myId) return false;

  if (canAllBodegas) {
    // Si tiene restricciones (rol REPORTE con lista), filtrar por esa.
    if (Array.isArray(allowedBodegaIds) && allowedBodegaIds.length > 0) {
      // Sin info de bodega: no mostrar (preferimos no notificar antes
      // que mostrar algo de una bodega no permitida).
      if (ids.length === 0) return false;
      const allowed = allowedBodegaIds.map((n) => Number(n || 0)).filter(Boolean);
      return ids.some((id) => allowed.includes(id));
    }
    // Admin sin restricciones: cualquier bodega le interesa, incluso
    // eventos sin bodega explícita (p.ej. catalog_changed) porque
    // supervisan todo el catálogo.
    return true;
  }

  // Bodeguero: el evento debe tocar SU bodega.
  // Sin info de bodega: NO mostrar (era el bypass del bug original
  // "!payloadBodega || !myBodega" que dejaba pasar todo).
  if (ids.length === 0) return false;
  return ids.includes(myId);
}
