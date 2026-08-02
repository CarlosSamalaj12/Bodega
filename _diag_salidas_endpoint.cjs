// _diag_salidas_endpoint.cjs
// Simula la misma query que /api/reportes/salidas con los params del usuario:
//   product 525 (LECHE ENTERA CORONADO)
//   from 2026-07-01 to 2026-08-01
//   sin warehouse, sin motivo
const m = require('./db.js');

async function main() {
  const pool = m.pool;
  const id_producto = 525;
  const from_dt = '2026-07-01 00:00:00';
  const to_dt = '2026-08-01 23:59:59';

  // 1) ¿Cuántos movimientos tiene LECHE CORONADO (525) en ese rango (SIN filtro bodega)?
  const [[r1]] = await pool.query(
    `SELECT COUNT(DISTINCT me.id_movimiento) AS total
     FROM movimiento_encabezado me
     JOIN movimiento_detalle md ON md.id_movimiento=me.id_movimiento
     WHERE me.tipo_movimiento IN ('SALIDA','TRANSFERENCIA')
       AND me.estado<>'ANULADO'
       AND md.id_producto=?
       AND me.creado_en >= ?
       AND me.creado_en <= ?`,
    [id_producto, from_dt, to_dt]
  );
  console.log('1) COUNT(DISTINCT) con filtro producto:', r1.total);

  // 2) ¿Cuántas filas detalle tiene?
  const [[r2]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM movimiento_encabezado me
     JOIN movimiento_detalle md ON md.id_movimiento=me.id_movimiento
     WHERE me.tipo_movimiento IN ('SALIDA','TRANSFERENCIA')
       AND me.estado<>'ANULADO'
       AND md.id_producto=?
       AND me.creado_en >= ?
       AND me.creado_en <= ?`,
    [id_producto, from_dt, to_dt]
  );
  console.log('2) COUNT filas detalle con filtro producto:', r2.total);

  // 3) ¿Y sin filtro de producto? Solo el tipo y la fecha
  const [[r3]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM movimiento_encabezado me
     WHERE me.tipo_movimiento IN ('SALIDA','TRANSFERENCIA')
       AND me.estado<>'ANULADO'
       AND me.creado_en >= ?
       AND me.creado_en <= ?`,
    [from_dt, to_dt]
  );
  console.log('3) COUNT sin filtro producto (solo tipo+fecha):', r3.total);

  // 4) ¿Cuántos movimientos TOTALES hay en la tabla movimiento_encabezado?
  const [[r4]] = await pool.query(`SELECT COUNT(*) AS total FROM movimiento_encabezado`);
  console.log('4) COUNT total movimiento_encabezado:', r4.total);

  // 5) ¿Cuántas filas detalle TOTALES hay?
  const [[r5]] = await pool.query(`SELECT COUNT(*) AS total FROM movimiento_detalle`);
  console.log('5) COUNT total movimiento_detalle:', r5.total);

  // 6) Verificar tipo de me.creado_en y si hay fechas en julio-agosto 2026
  const [[r6]] = await pool.query(
    `SELECT MIN(creado_en) AS min_fecha, MAX(creado_en) AS max_fecha, COUNT(*) AS total
     FROM movimiento_encabezado
     WHERE creado_en >= ? AND creado_en <= ?`,
    [from_dt, to_dt]
  );
  console.log('6) Rango creado_en (todos los tipos):', r6);

  // 7) Ver el tamaño del id_movimiento — quizá el id_movimiento no es único por alguna razón
  const [r7] = await pool.query(
    `SELECT me.id_movimiento, COUNT(*) AS cnt
     FROM movimiento_encabezado me
     JOIN movimiento_detalle md ON md.id_movimiento=me.id_movimiento
     WHERE me.tipo_movimiento IN ('SALIDA','TRANSFERENCIA')
       AND me.estado<>'ANULADO'
       AND md.id_producto=?
       AND me.creado_en >= ?
       AND me.creado_en <= ?
     GROUP BY me.id_movimiento
     ORDER BY cnt DESC
     LIMIT 5`,
    [id_producto, from_dt, to_dt]
  );
  console.log('7) Top 5 movimientos (count lineas):', r7);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
