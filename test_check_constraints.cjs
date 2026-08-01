// Test: muestra la estructura de movimiento_detalle, sus CHECK constraints
// y los triggers asociados. Sirve para identificar qué restricción bloquea
// el UPDATE de fecha_vencimiento.
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
    // 1) SHOW CREATE TABLE
    const [create] = await conn.query(`SHOW CREATE TABLE movimiento_detalle`);
    console.log('\n=== CREATE TABLE movimiento_detalle ===\n');
    console.log(create[0]['Create Table']);

    // 2) CHECK constraints específicos
    const [checks] = await conn.query(`
      SELECT cc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
      FROM information_schema.CHECK_CONSTRAINTS cc
      JOIN information_schema.TABLE_CONSTRAINTS tc
        ON tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
       AND tc.TABLE_NAME = cc.TABLE_NAME
      WHERE cc.TABLE_NAME='movimiento_detalle'
    `);
    if (checks.length) {
      console.log('\n=== CHECK constraints ===\n');
      for (const c of checks) console.log(`  ${c.CONSTRAINT_NAME}: ${c.CHECK_CLAUSE}`);
    } else {
      console.log('\n=== Sin CHECK constraints a nivel tabla ===');
    }

    // 3) Triggers
    const [triggers] = await conn.query(`
      SELECT TRIGGER_NAME, EVENT_MANIPULATION, ACTION_TIMING, ACTION_STATEMENT
      FROM information_schema.TRIGGERS
      WHERE EVENT_OBJECT_TABLE='movimiento_detalle'
    `);
    if (triggers.length) {
      console.log('\n=== Triggers ===\n');
      for (const t of triggers) console.log(`  ${t.TRIGGER_NAME} (${t.ACTION_TIMING} ${t.EVENT_MANIPULATION}):\n    ${t.ACTION_STATEMENT.slice(0, 200)}...`);
    } else {
      console.log('\n=== Sin triggers en movimiento_detalle ===');
    }

    // 4) Probar el UPDATE que el usuario quiere hacer
    console.log('\n=== Probando UPDATE de fecha_vencimiento ===\n');
    // Tomamos una fila que NO esté vencida (ej. 2027-09-23) y tratamos de ponerla en una fecha anterior
    const [[row]] = await conn.query(`
      SELECT id_detalle, id_movimiento, id_producto, lote, fecha_vencimiento
      FROM movimiento_detalle
      WHERE fecha_vencimiento IS NOT NULL
        AND fecha_vencimiento >= CURDATE()
      ORDER BY id_detalle DESC LIMIT 1
    `);
    if (!row) {
      console.log('No hay filas con fecha futura para probar.');
    } else {
      console.log(`Fila a probar: id_detalle=${row.id_detalle}, fecha actual=${row.fecha_vencimiento?.toISOString().slice(0,10)}`);
      // Intentar poner fecha anterior a hoy
      const nuevaFecha = '2026-01-01';
      console.log(`Intentando UPDATE a fecha anterior (${nuevaFecha})...`);
      try {
        await conn.query(
          `UPDATE movimiento_detalle SET fecha_vencimiento = ? WHERE id_detalle = ?`,
          [nuevaFecha, row.id_detalle]
        );
        console.log('  ✅ El UPDATE funcionó sin restricción');
        // Revertir
        await conn.query(
          `UPDATE movimiento_detalle SET fecha_vencimiento = ? WHERE id_detalle = ?`,
          [row.fecha_vencimiento, row.id_detalle]
        );
        console.log(`  ↩️  Revertido a fecha original`);
      } catch (e) {
        console.log(`  ❌ BLOQUEADO: ${e.message}`);
      }
    }

    // 5) Probar también intentando una fecha futura
    if (row) {
      const nuevaFecha = '2030-12-31';
      console.log(`\nIntentando UPDATE a fecha futura (${nuevaFecha})...`);
      try {
        await conn.query(
          `UPDATE movimiento_detalle SET fecha_vencimiento = ? WHERE id_detalle = ?`,
          [nuevaFecha, row.id_detalle]
        );
        console.log('  ✅ El UPDATE funcionó');
        await conn.query(
          `UPDATE movimiento_detalle SET fecha_vencimiento = ? WHERE id_detalle = ?`,
          [row.fecha_vencimiento, row.id_detalle]
        );
        console.log(`  ↩️  Revertido a fecha original`);
      } catch (e) {
        console.log(`  ❌ BLOQUEADO: ${e.message}`);
      }
    }
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await conn.end();
  }
})();
