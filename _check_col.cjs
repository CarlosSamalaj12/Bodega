const { pool } = require('./db.js');
pool.query(
  `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
   FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'usuarios'
     AND COLUMN_NAME = 'shortcuts_config'`
).then(([rows]) => {
  console.log('Column info:', JSON.stringify(rows, null, 2));
  return pool.end();
}).catch((e) => {
  console.error('Error:', e.message);
  pool.end();
});
