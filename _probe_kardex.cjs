require('dotenv/config');
const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASS, database: process.env.DB_NAME });
  const [cols] = await c.query("SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kardex' ORDER BY ORDINAL_POSITION");
  console.log('KARDEX_COLS:', JSON.stringify(cols, null, 1));
  const [trg] = await c.query("SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME LIKE 'trg_kardex_stock%'");
  console.log('TRIGGERS:', JSON.stringify(trg));
  // Un producto y bodega reales para usar como base del test
  const [p] = await c.query('SELECT id_producto, nombre_producto FROM productos WHERE activo=1 LIMIT 1');
  console.log('PRODUCTO:', JSON.stringify(p));
  const [b] = await c.query('SELECT id_bodega, nombre_bodega FROM bodegas LIMIT 2');
  console.log('BODEGAS:', JSON.stringify(b));
  await c.end();
})().catch(e => { console.log('ERR:', e.code || e.message); process.exit(1); });
