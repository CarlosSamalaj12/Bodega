// Test: muestra cómo se filtran las entradas/salidas por usuario en la práctica.
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
    // 1) Listar usuarios con bodega
    const [users] = await conn.query(`
      SELECT u.id_usuario, u.nombre_completo, u.usuario, u.id_bodega, b.nombre_bodega, r.nombre_rol
      FROM usuarios u
      LEFT JOIN bodegas b ON b.id_bodega=u.id_bodega
      LEFT JOIN roles r ON r.id_rol=u.id_rol
      WHERE u.activo=1 AND u.id_bodega IS NOT NULL
      ORDER BY u.id_bodega, u.id_usuario
    `);

    console.log('\n=== Usuarios con bodega asignada ===\n');
    for (const u of users) {
      console.log(`  #${u.id_usuario} ${u.nombre_completo} (${u.usuario}) — Bodega: ${u.nombre_bodega} — Rol: ${u.nombre_rol || '?'}`);
    }

    // 2) Para CADA usuario, contar entradas y salidas que ha CREADO en su bodega
    //    y total de entradas/salidas en su bodega (independiente de quién las creó)
    console.log('\n=== ¿Qué ve cada usuario? ===\n');
    for (const u of users.slice(0, 6)) {
      // Entradas en su bodega creadas por ÉL
      const [[{ creadas_por_el_entradas }]] = await conn.query(`
        SELECT COUNT(*) AS creadas_por_el_entradas
        FROM movimiento_encabezado me
        WHERE me.tipo_movimiento='ENTRADA'
          AND me.estado<>'ANULADO'
          AND me.id_bodega_destino=?
          AND me.creado_por=?
      `, [u.id_bodega, u.id_usuario]);

      // Total de entradas en su bodega (de cualquier usuario)
      const [[{ total_bodega_entradas }]] = await conn.query(`
        SELECT COUNT(*) AS total_bodega_entradas
        FROM movimiento_encabezado me
        WHERE me.tipo_movimiento='ENTRADA'
          AND me.estado<>'ANULADO'
          AND me.id_bodega_destino=?
      `, [u.id_bodega]);

      // Salidas en su bodega creadas por ÉL
      const [[{ creadas_por_el_salidas }]] = await conn.query(`
        SELECT COUNT(*) AS creadas_por_el_salidas
        FROM movimiento_encabezado me
        WHERE me.tipo_movimiento='SALIDA'
          AND me.estado<>'ANULADO'
          AND me.id_bodega_origen=?
          AND me.creado_por=?
      `, [u.id_bodega, u.id_usuario]);

      // Total de salidas en su bodega
      const [[{ total_bodega_salidas }]] = await conn.query(`
        SELECT COUNT(*) AS total_bodega_salidas
        FROM movimiento_encabezado me
        WHERE me.tipo_movimiento='SALIDA'
          AND me.estado<>'ANULADO'
          AND me.id_bodega_origen=?
      `, [u.id_bodega]);

      console.log(`  #${u.id_usuario} ${u.nombre_completo} (${u.nombre_bodega}):`);
      console.log(`    ENTRADAS: ${creadas_por_el_entradas} creadas por él, ${total_bodega_entradas} totales en su bodega`);
      console.log(`    SALIDAS:  ${creadas_por_el_salidas} creadas por él, ${total_bodega_salidas} totales en su bodega`);
    }
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await conn.end();
  }
})();
