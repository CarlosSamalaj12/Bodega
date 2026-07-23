import { pool } from './db.js';

async function main() {
  // Look at specific duplicate groups in detail
  const [groups] = await pool.query(`
    SELECT id_movimiento, id_detalle, id_bodega, id_producto, COUNT(*) AS cnt,
           GROUP_CONCAT(id_kardex ORDER BY id_kardex) AS ids,
           GROUP_CONCAT(delta_cantidad ORDER BY id_kardex) AS deltas,
           GROUP_CONCAT(creado_en ORDER BY id_kardex) AS created
    FROM kardex
    GROUP BY id_movimiento, id_detalle, id_bodega, id_producto
    HAVING cnt > 1
    ORDER BY cnt DESC
    LIMIT 10
  `);
  
  for (const g of groups) {
    console.log("===", JSON.stringify(g));
    // Get movimiento details for this group
    const [mov] = await pool.query(
      "SELECT me.id_movimiento, me.tipo_movimiento, me.estado, me.id_bodega_origen, me.id_bodega_destino FROM movimiento_encabezado me WHERE me.id_movimiento = ?",
      [g.id_movimiento]
    );
    console.log("  Mov:", JSON.stringify(mov));
    
    // Get pedido_movimiento_vinculo for this detalle
    const [vinculos] = await pool.query(
      "SELECT * FROM pedido_movimiento_vinculo WHERE id_detalle = ?",
      [g.id_detalle]
    );
    if (vinculos.length > 0) {
      console.log("  Vinculos:", JSON.stringify(vinculos));
    }
  }

  process.exit(0);
}
main();
