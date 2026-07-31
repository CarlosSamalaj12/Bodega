// Test: inspecciona la estructura y datos de motivos_movimiento en la BD.
require('dotenv/config');
const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
  });

  try {
    // 1) Estructura de la tabla
    const [cols] = await conn.query(`SHOW COLUMNS FROM motivos_movimiento`);
    console.log('\n=== Columnas de motivos_movimiento ===');
    for (const c of cols) {
      console.log(`  ${c.Field.padEnd(25)} ${c.Type.padEnd(40)} ${c.Null} ${c.Default ?? ''} ${c.Key}`);
    }

    // 2) Datos
    const [rows] = await conn.query(`SELECT * FROM motivos_movimiento ORDER BY tipo_movimiento, nombre_motivo`);
    console.log(`\n=== ${rows.length} motivos ===`);
    for (const r of rows) {
      console.log(`  #${r.id_motivo} [${r.tipo_movimiento}] ${r.nombre_motivo} (activo=${r.activo}, signo=${r.signo_cantidad})`);
      // Mostrar todas las props que tengan
      for (const k of Object.keys(r)) {
        if (!['id_motivo','nombre_motivo','tipo_movimiento','signo_cantidad','activo'].includes(k)) {
          console.log(`     extra: ${k} = ${JSON.stringify(r[k])}`);
        }
      }
    }
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await conn.end();
  }
})();
