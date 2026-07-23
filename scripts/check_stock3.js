import { pool } from './db.js';

async function main() {
  // Check total impact of duplicates per product+warehouse
  const [dupesDetail] = await pool.query(`
    SELECT d.id_producto, p.nombre_producto, d.id_bodega, 
           COUNT(*) AS extra_rows,
           SUM(d.delta_cantidad) AS extra_stock
    FROM kardex d
    JOIN (
      SELECT id_movimiento, id_detalle, id_bodega, id_producto
      FROM kardex
      GROUP BY id_movimiento, id_detalle, id_bodega, id_producto
      HAVING COUNT(*) > 1
    ) dup ON dup.id_movimiento = d.id_movimiento 
         AND dup.id_detalle = d.id_detalle 
         AND dup.id_bodega = d.id_bodega 
         AND dup.id_producto = d.id_producto
    JOIN productos p ON p.id_producto = d.id_producto
    GROUP BY d.id_producto, p.nombre_producto, d.id_bodega
    ORDER BY extra_stock DESC
    LIMIT 20
  `);
  console.log("=== DUPLICATE IMPACT ===");
  console.log(JSON.stringify(dupesDetail, null, 2));

  // Find products with largest discrepancy between raw sum and corte-diario calculation
  const id_bodega = 1;
  const [corteCompare] = await pool.query(`
    SELECT p.id_producto, p.nombre_producto,
      COALESCE(SUM(k.delta_cantidad), 0) AS raw_stock,
      COUNT(*) AS kardex_rows,
      SUM(CASE WHEN k.delta_cantidad > 0 THEN k.delta_cantidad ELSE 0 END) AS raw_entradas,
      SUM(CASE WHEN k.delta_cantidad < 0 THEN ABS(k.delta_cantidad) ELSE 0 END) AS raw_salidas,
      ABS(
        COALESCE(SUM(k.delta_cantidad), 0) - 
        (COALESCE(SUM(CASE WHEN k.delta_cantidad > 0 THEN k.delta_cantidad ELSE 0 END), 0) -
         COALESCE(SUM(CASE WHEN k.delta_cantidad < 0 THEN ABS(k.delta_cantidad) ELSE 0 END), 0))
      ) AS diff
    FROM productos p
    LEFT JOIN kardex k ON k.id_producto = p.id_producto AND k.id_bodega = ?
    WHERE p.activo = 1
    GROUP BY p.id_producto, p.nombre_producto
    HAVING raw_entradas > 0 OR raw_salidas > 0
    ORDER BY raw_stock DESC
    LIMIT 30
  `, [id_bodega]);
  console.log("\n=== TOP 30 PRODUCTS ===");
  console.log(JSON.stringify(corteCompare, null, 2));

  process.exit(0);
}
main();
