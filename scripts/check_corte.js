import { pool } from './db.js';

async function main() {
  // Run the actual corte-diario query for a specific product
  const id_bodega = 1;
  
  // First, let's look at products where total_entradas - total_salidas doesn't match raw stock
  const [mismatches] = await pool.query(`
    WITH product_stock AS (
      SELECT k.id_producto,
             p.nombre_producto,
             k.id_bodega,
             SUM(k.delta_cantidad) AS raw_stock,
             SUM(CASE WHEN k.delta_cantidad > 0 THEN k.delta_cantidad ELSE 0 END) AS total_entradas,
             SUM(CASE WHEN k.delta_cantidad < 0 THEN ABS(k.delta_cantidad) ELSE 0 END) AS total_salidas,
             COUNT(*) AS row_count
      FROM kardex k
      JOIN productos p ON p.id_producto = k.id_producto
      JOIN movimiento_encabezado me ON me.id_movimiento = k.id_movimiento
      WHERE k.id_bodega = ?
        AND p.activo = 1
        AND me.estado <> 'ANULADO'
      GROUP BY k.id_producto, p.nombre_producto, k.id_bodega
    )
    SELECT *,
           (total_entradas - total_salidas) AS expected_stock,
           ABS(raw_stock - (total_entradas - total_salidas)) AS discrepancy
    FROM product_stock
    WHERE ABS(raw_stock - (total_entradas - total_salidas)) > 0
    ORDER BY discrepancy DESC
    LIMIT 20
  `, [id_bodega]);
  
  console.log("=== MISMATCHES (raw_stock != entradas - salidas) ===");
  console.log(JSON.stringify(mismatches, null, 2));
  
  if (mismatches.length === 0) {
    console.log("No mismatches found - raw stock always equals entradas - salidas");
    
    // Now compare the corte-diario query with raw stock
    const [corteResults] = await pool.query(`
      SELECT p.id_producto,
             p.nombre_producto,
             COALESCE(SUM(CASE WHEN k.creado_en < CURDATE() THEN k.delta_cantidad ELSE 0 END), 0) AS existencia_ayer,
             COALESCE(SUM(CASE WHEN k.creado_en >= CURDATE() AND k.delta_cantidad > 0 THEN k.delta_cantidad ELSE 0 END), 0) AS entradas_hoy,
             COALESCE(SUM(CASE WHEN k.creado_en >= CURDATE() AND k.delta_cantidad < 0 THEN ABS(k.delta_cantidad) ELSE 0 END), 0) AS salidas_hoy,
             COALESCE(SUM(CASE WHEN k.creado_en <= NOW() THEN k.delta_cantidad ELSE 0 END), 0) AS existencia_actual,
             COALESCE(SUM(k.delta_cantidad), 0) AS raw_total
      FROM productos p
      LEFT JOIN (
        SELECT k.*
        FROM kardex k
        JOIN movimiento_encabezado me ON me.id_movimiento = k.id_movimiento AND me.estado <> 'ANULADO'
      ) k ON k.id_producto = p.id_producto AND k.id_bodega = ?
      WHERE p.activo = 1
      GROUP BY p.id_producto, p.nombre_producto
      HAVING ABS(existencia_actual) > 0
        AND ABS(existencia_actual - raw_total) > 0
      ORDER BY ABS(existencia_actual - raw_total) DESC
      LIMIT 20
    `, [id_bodega]);
    
    console.log("\n=== CORTE vs RAW_STOCK DISCREPANCIES ===");
    console.log(JSON.stringify(corteResults, null, 2));
    
    if (corteResults.length === 0) {
      console.log("No discrepancies between corte-diario and raw stock");
    }
  }

  process.exit(0);
}
main();
