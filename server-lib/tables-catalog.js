// server-lib/tables-catalog.js  —  Catalog deactivation validation function
import { pool } from "./core.js";

async function ensureCatalogCanDeactivate(conn, { entity, id }) {
  if (entity === "PRODUCTO") {
    const [[orderRow]] = await conn.query(`SELECT COUNT(*) AS c FROM pedido_detalle pd JOIN pedido_encabezado pe ON pe.id_pedido=pd.id_pedido WHERE pd.id_producto=:id AND pe.estado IN ('PENDIENTE','PARCIAL')`, { id });
    if (Number(orderRow?.c || 0) > 0) return { ok: false, status: 409, code: "PRODUCT_IN_OPEN_ORDER", error: "No se puede desactivar el producto porque tiene pedidos abiertos" };
  }
  if (entity === "MOTIVO") {
    const [[movRow]] = await conn.query(`SELECT COUNT(*) AS c FROM movimiento_encabezado WHERE id_motivo=:id AND estado NOT IN ('CONFIRMADO','CANCELADO','COMPLETADO')`, { id });
    if (Number(movRow?.c || 0) > 0) return { ok: false, status: 409, code: "MOTIVO_IN_OPEN_MOVEMENT", error: "No se puede desactivar el motivo porque tiene movimientos abiertos" };
  }
  return { ok: true };
}

export { ensureCatalogCanDeactivate };
