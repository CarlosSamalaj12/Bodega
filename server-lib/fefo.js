// server-lib/fefo.js  —  FEFO lot picking and unit cost utilities
import { pool } from "./core.js";

async function pickLotsFEFO(conn, id_bodega, id_producto, qtyNeeded, opts = {}) {
  const allowExpired = opts.allowExpired !== false;
  const whereVenc = allowExpired ? "" : "AND (fecha_vencimiento IS NULL OR fecha_vencimiento >= CURDATE())";
  const [lots] = await conn.query(`SELECT lote, fecha_vencimiento, stock FROM v_stock_disponible WHERE id_bodega=:id_bodega AND id_producto=:id_producto ${whereVenc} ORDER BY (fecha_vencimiento IS NULL), fecha_vencimiento ASC`, { id_bodega, id_producto });
  const picks = []; let remaining = Number(qtyNeeded);
  for (const l of lots) { if (remaining <= 0) break; const take = Math.min(remaining, Number(l.stock)); picks.push({ lote: l.lote, fecha_vencimiento: l.fecha_vencimiento, qty: take }); remaining -= take; }
  if (!picks.length && allowExpired) { const [[r]] = await conn.query(`SELECT stock FROM v_stock_resumen WHERE id_bodega=:id_bodega AND id_producto=:id_producto LIMIT 1`, { id_bodega, id_producto }); const stock = Number(r?.stock || 0); if (stock > 0) { const take = Math.min(stock, Number(qtyNeeded)); return { picks: [{ lote: null, fecha_vencimiento: null, qty: take }], remaining: Number(qtyNeeded) - take }; } }
  return { picks, remaining };
}

async function getLastUnitCost(conn, id_bodega, id_producto, lote) {
  const [rows] = await conn.query(`SELECT costo_unitario FROM kardex WHERE id_bodega=:id_bodega AND id_producto=:id_producto AND lote=:lote AND delta_cantidad > 0 ORDER BY creado_en DESC LIMIT 1`, { id_bodega, id_producto, lote });
  return rows[0]?.costo_unitario ?? 0;
}

export { pickLotsFEFO, getLastUnitCost };
