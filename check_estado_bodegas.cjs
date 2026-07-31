const mysql = require('mysql2');
const c = mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: 'Xvfv2du1p5xyZX', database: 'bodega_hotel' });
c.query(`SELECT b.id_bodega, b.nombre_bodega, COALESCE(cb.permite_salida_conteo_final, 0) AS conteo_final, COALESCE(cb.maneja_stock, 0) AS maneja_stock, (SELECT COUNT(*) FROM kardex k WHERE k.id_bodega = b.id_bodega) AS movs FROM bodegas b LEFT JOIN configuracion_bodega cb ON cb.id_bodega = b.id_bodega WHERE b.activo = 1 ORDER BY b.id_bodega`, (e, r) => {
  if (e) { console.error(e); process.exit(1); }
  r.forEach(x => {
    const tag = x.conteo_final == 1 ? '[CONTEOfinal]' : '';
    console.log(`#${String(x.id_bodega).padEnd(2)} ${x.nombre_bodega.padEnd(30)} conteo=${x.conteo_final} stock=${x.maneja_stock} movs=${x.movs} ${tag}`);
  });
  c.end();
});
