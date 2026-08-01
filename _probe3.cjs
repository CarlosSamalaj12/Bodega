require('dotenv/config');
const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASS, database: process.env.DB_NAME });
  const [cols] = await c.query("SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kardex' AND COLUMN_NAME IN ('creado_en','delta_cantidad') ");
  console.log('KARDEX_COLS:', JSON.stringify(cols));
  const [sc] = await c.query("SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='stock_actual' ORDER BY ORDINAL_POSITION");
  console.log('STOCK_ACTUAL_COLS:', JSON.stringify(sc));
  // Equivalencia de la expresion MIN(IF(delta>0, DATE(creado_en), NULL)) vs derived table
  const [eq] = await c.query(`
    SELECT COUNT(*) AS grupos,
           SUM(IF(a.fecha_entrada_lote IS NULL, 1, 0)) AS nulos
    FROM (
      SELECT id_bodega, id_producto, lote, fecha_vencimiento, MIN(DATE(creado_en)) AS fel
      FROM kardex WHERE delta_cantidad > 0
      GROUP BY id_bodega, id_producto, lote, fecha_vencimiento
    ) a`);
  console.log('EQ_PREVIEW:', JSON.stringify(eq));
  const [v] = await c.query(`SELECT COUNT(*) AS c FROM kardex WHERE delta_cantidad > 0`);
  console.log('KARDEX_POS:', JSON.stringify(v));
  await c.end();
})().catch(e => { console.log('ERR:', e.code || e.message); process.exit(1); });
