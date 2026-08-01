require('dotenv/config');
const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASS, database: process.env.DB_NAME });
  const t = async (name, sql) => { const [r] = await c.query(sql); console.log(name + ':', JSON.stringify(r)); };
  await t('ME_COLS', `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='movimiento_encabezado' ORDER BY ORDINAL_POSITION`);
  await t('MD_COLS', `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='movimiento_detalle' ORDER BY ORDINAL_POSITION`);
  await t('PE_COLS', `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pedido_encabezado' ORDER BY ORDINAL_POSITION`);
  await t('PD_COLS', `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pedido_detalle' ORDER BY ORDINAL_POSITION`);
  await t('MOTIVOS', `SELECT id_motivo, nombre_motivo, tipo_movimiento FROM motivos_movimiento GROUP BY tipo_movimiento LIMIT 10`);
  await t('BODEGAS', `SELECT id_bodega, nombre_bodega, puede_despachar, maneja_stock, puede_recibir FROM bodegas ORDER BY id_bodega LIMIT 5`);
  await t('USER_WH', `SELECT id_user, username, id_warehouse FROM users LIMIT 5`);
  await c.end();
})().catch(e => { console.log('ERR:', e.code || e.message); process.exit(1); });
