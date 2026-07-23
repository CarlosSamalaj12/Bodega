import { pool } from './db.js';

async function main() {
  try {
    // Get total stock per product/warehouse from raw kardex
    const [rows] = await pool.query(`
      SELECT 
        k.id_producto,
        p.nombre_producto,
        k.id_bodega,
        SUM(k.delta_cantidad) AS stock_sum,
        COUNT(*) AS kardex_count,
        SUM(CASE WHEN k.delta_cantidad > 0 THEN k.delta_cantidad ELSE 0 END) AS total_entradas,
        SUM(CASE WHEN k.delta_cantidad < 0 THEN ABS(k.delta_cantidad) ELSE 0 END) AS total_salidas
      FROM kardex k
      JOIN productos p ON p.id_producto = k.id_producto
      WHERE p.activo = 1
      GROUP BY k.id_producto, p.nombre_producto, k.id_bodega
      HAVING ABS(stock_sum) > 0
      ORDER BY stock_sum DESC
      LIMIT 30
    `);
    console.log("=== STOCK ACTUAL (RAW SUM) ===");
    console.log(JSON.stringify(rows, null, 2));

    // Check for ANULADO entries per product+warehouse
    const [anulados] = await pool.query(`
      SELECT k.id_producto, p.nombre_producto, k.id_bodega, 
             SUM(k.delta_cantidad) AS anulado_stock, 
             COUNT(*) AS anulado_count,
             SUM(CASE WHEN k.delta_cantidad > 0 THEN k.delta_cantidad ELSE 0 END) AS anulado_entradas,
             SUM(CASE WHEN k.delta_cantidad < 0 THEN ABS(k.delta_cantidad) ELSE 0 END) AS anulado_salidas
      FROM kardex k
      JOIN movimiento_encabezado me ON me.id_movimiento = k.id_movimiento
      JOIN productos p ON p.id_producto = k.id_producto
      WHERE me.estado = 'ANULADO'
      GROUP BY k.id_producto, p.nombre_producto, k.id_bodega
      HAVING COUNT(*) > 0
      ORDER BY ABS(anulado_stock) DESC
      LIMIT 20
    `);
    console.log("\n=== ANULADOS ===");
    console.log(JSON.stringify(anulados, null, 2));

    // Check for BORRADOR entries
    const [borradores] = await pool.query(`
      SELECT k.id_producto, p.nombre_producto, k.id_bodega, 
             SUM(k.delta_cantidad) AS borrador_stock, 
             COUNT(*) AS borrador_count
      FROM kardex k
      JOIN movimiento_encabezado me ON me.id_movimiento = k.id_movimiento
      JOIN productos p ON p.id_producto = k.id_producto
      WHERE me.estado = 'BORRADOR'
      GROUP BY k.id_producto, p.nombre_producto, k.id_bodega
      HAVING COUNT(*) > 0
      ORDER BY ABS(borrador_stock) DESC
      LIMIT 20
    `);
    console.log("\n=== BORRADORES ===");
    console.log(JSON.stringify(borradores, null, 2));

    // Check for duplicate kardex entries (same id_movimiento, id_detalle, id_bodega, id_producto)
    const [dupes] = await pool.query(`
      SELECT id_movimiento, id_detalle, id_bodega, id_producto, 
             COUNT(*) AS cnt, 
             SUM(delta_cantidad) AS total_delta,
             GROUP_CONCAT(CAST(id_kardex AS CHAR)) AS ids
      FROM kardex
      GROUP BY id_movimiento, id_detalle, id_bodega, id_producto
      HAVING COUNT(*) > 1
      ORDER BY cnt DESC
      LIMIT 20
    `);
    console.log("\n=== DUPLICADOS (mismo mov+det+bod+prod) ===");
    console.log(JSON.stringify(dupes, null, 2));

  } catch(e) {
    console.error("Error:", e.message);
  }
  process.exit(0);
}
main();
