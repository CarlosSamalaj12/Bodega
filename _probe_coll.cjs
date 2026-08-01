require('dotenv/config');
const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASS, database: process.env.DB_NAME });
  const [col] = await c.query(`SELECT TABLE_NAME, COLUMN_NAME, COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('kardex','stock_actual') AND COLUMN_NAME IN ('lote','lote_key') ORDER BY TABLE_NAME, COLUMN_NAME`);
  console.log('COLLATIONS:', JSON.stringify(col));
  const [db] = await c.query("SELECT DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=DATABASE()");
  console.log('DB_DEFAULT:', JSON.stringify(db));
  const [[mv]] = await c.query('SELECT id_movimiento FROM movimiento_encabezado ORDER BY id_movimiento LIMIT 1');
  const [[md]] = await c.query('SELECT id_detalle FROM movimiento_detalle ORDER BY id_detalle LIMIT 1');
  const [[prod]] = await c.query('SELECT id_producto FROM productos WHERE activo=1 ORDER BY id_producto LIMIT 1');
  const [[bod]] = await c.query('SELECT id_bodega FROM bodegas ORDER BY id_bodega LIMIT 1');
  const ts = Date.now();
  const lote = `ZZPROBE_${ts}`;
  await c.beginTransaction();
  try {
    const [r] = await c.query(
      `INSERT INTO kardex (id_movimiento, id_detalle, id_bodega, id_producto, lote, fecha_vencimiento, delta_cantidad, costo_unitario, creado_en)
       VALUES (?,?,?,?,?,NULL,100,0,'2026-06-01 10:00:00')`,
      [mv.id_movimiento, md.id_detalle, bod.id_bodega, prod.id_producto, lote]);
    const id = r.insertId;
    console.log('INSERT_OK id_kardex=', id);
    try {
      await c.query(`UPDATE kardex SET delta_cantidad = 50 WHERE id_kardex = ?`, [id]);
      console.log('UPDATE_OK');
    } catch (e) { console.log('UPDATE_ERR:', e.code, '|', e.message.split('\n')[0]); }
    try {
      await c.query(`DELETE FROM kardex WHERE id_kardex = ?`, [id]);
      console.log('DELETE_OK');
    } catch (e) { console.log('DELETE_ERR:', e.code, '|', e.message.split('\n')[0]); }
  } finally {
    await c.rollback().catch(() => {});
  }
  await c.end();
})().catch(e => { console.log('ERR:', e.code || e.message); process.exit(1); });
