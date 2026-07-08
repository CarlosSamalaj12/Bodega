import { pool } from './db.js';

async function main() {
  const id_producto = 1816;
  const id_bodega = 5;

  // Check current time in MySQL
  const [[now]] = await pool.query("SELECT NOW() AS now, CURDATE() AS curdate");
  console.log("MySQL TIME:", JSON.stringify(now));

  // Check timezone
  const [[tz]] = await pool.query("SELECT @@session.time_zone AS tz");
  console.log("MySQL TZ:", JSON.stringify(tz));

  // Group entries relative to NOW() and CURDATE()
  const [analysis] = await pool.query(`
    SELECT 
      CASE 
        WHEN k.creado_en < CURDATE() THEN 'ayer'
        WHEN k.creado_en >= CURDATE() AND k.creado_en <= NOW() THEN 'hoy_hasta_ahora'
        WHEN k.creado_en > NOW() AND k.creado_en >= CURDATE() THEN 'hoy_futuro'
        WHEN k.creado_en > NOW() THEN 'futuro'
        ELSE 'otro'
      END AS periodo,
      COUNT(*) AS cnt,
      SUM(k.delta_cantidad) AS sum_delta,
      SUM(CASE WHEN k.delta_cantidad > 0 THEN k.delta_cantidad ELSE 0 END) AS sum_pos,
      SUM(CASE WHEN k.delta_cantidad < 0 THEN ABS(k.delta_cantidad) ELSE 0 END) AS sum_neg_abs
    FROM kardex k
    JOIN movimiento_encabezado me ON me.id_movimiento = k.id_movimiento
    WHERE k.id_producto = ? AND k.id_bodega = ?
    GROUP BY periodo
    ORDER BY periodo
  `, [id_producto, id_bodega]);
  
  console.log("\n=== ANALYSIS BY PERIOD ===");
  console.log(JSON.stringify(analysis, null, 2));

  // Full corte-diario query for this product+warehouse
  const [corte] = await pool.query(`
    SELECT
      COALESCE(SUM(CASE WHEN k.creado_en < CURDATE() THEN k.delta_cantidad ELSE 0 END), 0) AS existencia_ayer,
      COALESCE(SUM(CASE WHEN k.creado_en >= CURDATE() AND k.delta_cantidad > 0 THEN k.delta_cantidad ELSE 0 END), 0) AS entradas_hoy,
      COALESCE(SUM(CASE WHEN k.creado_en >= CURDATE() AND k.delta_cantidad < 0 THEN ABS(k.delta_cantidad) ELSE 0 END), 0) AS salidas_hoy,
      COALESCE(SUM(CASE WHEN k.creado_en <= NOW() THEN k.delta_cantidad ELSE 0 END), 0) AS existencia_actual
    FROM kardex k
    JOIN movimiento_encabezado me ON me.id_movimiento = k.id_movimiento
    WHERE k.id_producto = ? AND k.id_bodega = ?
  `, [id_producto, id_bodega]);
  
  console.log("\n=== CORTE-DIARIO ===");
  console.log(JSON.stringify(corte[0]));

  const c = corte[0];
  const expected = Number(c.existencia_ayer) + Number(c.entradas_hoy) - Number(c.salidas_hoy);
  console.log(`Verif: ${c.existencia_ayer} + ${c.entradas_hoy} - ${c.salidas_hoy} = ${expected} (actual=${c.existencia_actual}) ${Math.abs(expected - Number(c.existencia_actual)) < 0.001 ? 'OK' : 'DIF!'}`);

  // Now check: what if we DON'T use the time filters at all?
  const [raw] = await pool.query(`
    SELECT
      COALESCE(SUM(k.delta_cantidad), 0) AS total_stock,
      COALESCE(SUM(CASE WHEN k.delta_cantidad > 0 THEN k.delta_cantidad ELSE 0 END), 0) AS total_entradas,
      COALESCE(SUM(CASE WHEN k.delta_cantidad < 0 THEN ABS(k.delta_cantidad) ELSE 0 END), 0) AS total_salidas
    FROM kardex k
    JOIN movimiento_encabezado me ON me.id_movimiento = k.id_movimiento
    WHERE k.id_producto = ? AND k.id_bodega = ?
  `, [id_producto, id_bodega]);
  
  console.log("\n=== RAW TOTAL ===");
  console.log(JSON.stringify(raw[0]));

  process.exit(0);
}
main();
