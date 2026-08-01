require('dotenv/config');
const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASS, database: process.env.DB_NAME });
  const t = async (name, sql) => { const [r] = await c.query(sql); console.log(name + ':', JSON.stringify(r)); };
  await t('TABLES', `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('users','usuarios','configuracion_bodega')`);
  await t('FK_ME', `SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='movimiento_encabezado' AND REFERENCED_TABLE_NAME IS NOT NULL`);
  await t('FK_MD', `SELECT COLUMN_NAME, REFERENCED_TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='movimiento_detalle' AND REFERENCED_TABLE_NAME IS NOT NULL`);
  await t('CB', `SELECT * FROM configuracion_bodega LIMIT 8`);
  await t('USUARIOS', `SELECT id_usuario, usuario, id_bodega, activo FROM usuarios WHERE activo=1 LIMIT 6`);
  await c.end();
})().catch(e => { console.log('ERR:', e.code || e.message); process.exit(1); });
