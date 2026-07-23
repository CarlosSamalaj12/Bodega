import { pool } from './db.js';

async function main() {
  const id_producto = 1816;
  const id_bodega = 5;

  // Verify the fix: existencia_actual should be SUM of ALL deltas
  const [corte] = await pool.query(`
    SELECT
      COALESCE(SUM(CASE WHEN k.creado_en < CURDATE() THEN k.delta_cantidad ELSE 0 END), 0) AS existencia_ayer,
      COALESCE(SUM(CASE WHEN k.creado_en >= CURDATE() AND k.delta_cantidad > 0 THEN k.delta_cantidad ELSE 0 END), 0) AS entradas_hoy,
      COALESCE(SUM(CASE WHEN k.creado_en >= CURDATE() AND k.delta_cantidad < 0 THEN ABS(k.delta_cantidad) ELSE 0 END), 0) AS salidas_hoy,
      COALESCE(SUM(k.delta_cantidad), 0) AS existencia_actual
    FROM kardex k
    JOIN movimiento_encabezado me ON me.id_movimiento = k.id_movimiento
    WHERE k.id_producto = ? AND k.id_bodega = ?
  `, [id_producto, id_bodega]);
  
  console.log("=== FIXED CORTE-DIARIO ===");
  console.log(JSON.stringify(corte[0]));
  
  const c = corte[0];
  const expected = Number(c.existencia_ayer) + Number(c.entradas_hoy) - Number(c.salidas_hoy);
  const actual = Number(c.existencia_actual);
  console.log(`Verif: ${c.existencia_ayer} + ${c.entradas_hoy} - ${c.salidas_hoy} = ${expected} (actual=${actual}) ${Math.abs(expected - actual) < 0.001 ? 'OK' : 'DIF!'}`);
  console.log(`Stock esperado: ${expected}`);
  
  // Also test with the original (broken) query
  const [broken] = await pool.query(`
    SELECT
      COALESCE(SUM(CASE WHEN k.creado_en < CURDATE() THEN k.delta_cantidad ELSE 0 END), 0) AS existencia_ayer,
      COALESCE(SUM(CASE WHEN k.creado_en >= CURDATE() AND k.delta_cantidad > 0 THEN k.delta_cantidad ELSE 0 END), 0) AS entradas_hoy,
      COALESCE(SUM(CASE WHEN k.creado_en >= CURDATE() AND k.delta_cantidad < 0 THEN ABS(k.delta_cantidad) ELSE 0 END), 0) AS salidas_hoy,
      COALESCE(SUM(CASE WHEN k.creado_en <= NOW() THEN k.delta_cantidad ELSE 0 END), 0) AS existencia_actual
    FROM kardex k
    JOIN movimiento_encabezado me ON me.id_movimiento = k.id_movimiento
    WHERE k.id_producto = ? AND k.id_bodega = ?
  `, [id_producto, id_bodega]);
  
  console.log("\n=== ORIGINAL (BROKEN) ===");
  console.log(JSON.stringify(broken[0]));

  process.exit(0);
}
main();
