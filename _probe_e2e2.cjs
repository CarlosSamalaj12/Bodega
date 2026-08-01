require('dotenv/config');
const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASS, database: process.env.DB_NAME });
  const t = async (name, sql) => { const [r] = await c.query(sql); console.log(name + ':', JSON.stringify(r)); };
  await t('BODEGAS_COLS', `SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bodegas' ORDER BY ORDINAL_POSITION`);
  await t('CB_COLS', `SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='configuracion_bodega' ORDER BY ORDINAL_POSITION`);
  await t('PMV_COLS', `SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pedido_movimiento_vinculo' ORDER BY ORDINAL_POSITION`);
  await t('USERS_COLS', `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='usuarios' ORDER BY ORDINAL_POSITION`);
  await t('BODEGAS', `SELECT id_bodega, nombre_bodega FROM bodegas ORDER BY id_bodega LIMIT 6`);
  await t('USERS', `SELECT id_usuario, username, id_warehouse FROM usuarios LIMIT 5`);
  await c.end();
})().catch(e => { console.log('ERR:', e.code || e.message); process.exit(1); });
