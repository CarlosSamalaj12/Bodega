import { pool } from './db.js';

async function main() {
  const [estados] = await pool.query("SELECT estado, COUNT(*) AS cnt FROM movimiento_encabezado GROUP BY estado");
  console.log("ESTADOS:", JSON.stringify(estados));

  const [anulados] = await pool.query(
    "SELECT me.estado, COUNT(*) AS cnt, SUM(k.delta_cantidad) AS total_delta FROM movimiento_encabezado me JOIN kardex k ON k.id_movimiento=me.id_movimiento WHERE me.estado = 'ANULADO' GROUP BY me.estado"
  );
  console.log("ANULADOS:", JSON.stringify(anulados));

  const [borradores] = await pool.query(
    "SELECT me.estado, COUNT(*) AS cnt, SUM(k.delta_cantidad) AS total_delta FROM movimiento_encabezado me JOIN kardex k ON k.id_movimiento=me.id_movimiento WHERE me.estado = 'BORRADOR' GROUP BY me.estado"
  );
  console.log("BORRADORES:", JSON.stringify(borradores));

  const [dupes] = await pool.query(
    "SELECT id_movimiento, id_detalle, id_bodega, id_producto, COUNT(*) AS cnt FROM kardex GROUP BY id_movimiento, id_detalle, id_bodega, id_producto HAVING cnt > 1"
  );
  console.log("DUPES count:", dupes.length);
  if (dupes.length > 0) console.log("DUPES:", JSON.stringify(dupes.slice(0, 10)));

  const [transfers] = await pool.query(
    "SELECT k.id_producto, k.id_bodega, COUNT(*) AS cnt, SUM(CASE WHEN k.delta_cantidad > 0 THEN 1 ELSE 0 END) AS pos, SUM(CASE WHEN k.delta_cantidad < 0 THEN 1 ELSE 0 END) AS neg FROM kardex k JOIN movimiento_encabezado me ON me.id_movimiento = k.id_movimiento WHERE me.tipo_movimiento = 'TRANSFERENCIA' AND k.id_bodega = 1 GROUP BY k.id_producto, k.id_bodega HAVING cnt > 2 ORDER BY cnt DESC LIMIT 10"
  );
  console.log("TRANSFERs:", JSON.stringify(transfers));

  process.exit(0);
}
main();
