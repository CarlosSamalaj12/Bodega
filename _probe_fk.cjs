require('dotenv/config');
const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASS, database: process.env.DB_NAME });
  const [fk] = await c.query(`SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kardex' AND REFERENCED_TABLE_NAME IS NOT NULL`);
  console.log('KARDEX_FKS:', JSON.stringify(fk));
  const [unq] = await c.query(`SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME) cols FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kardex' AND NON_UNIQUE=0 GROUP BY INDEX_NAME`);
  console.log('KARDEX_UNIQUE:', JSON.stringify(unq));
  const [mv] = await c.query('SELECT id_movimiento FROM movimiento_encabezado LIMIT 1');
  console.log('MOV_EXAMPLE:', JSON.stringify(mv));
  const [md] = await c.query('SELECT id_detalle FROM movimiento_detalle LIMIT 1');
  console.log('DET_EXAMPLE:', JSON.stringify(md));
  await c.end();
})().catch(e => { console.log('ERR:', e.code || e.message); process.exit(1); });
