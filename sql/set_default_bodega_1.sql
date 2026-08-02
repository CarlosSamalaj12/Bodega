-- ============================================================
-- Migración: productos en "Todas" (sin reglas) → bodega 1
-- ============================================================
-- Reglas:
--   • Productos SIN reglas en producto_bodegas_visibilidad
--     (estado "Todas") → se les crea regla (id_bodega=1, visible=1)
--   • Productos CON reglas existentes (incluyendo los que tienen
--     bodegas 5 y 1) → NO se tocan
--
-- ⚠️  HACER BACKUP DE LA TABLA ANTES DE EJECUTAR:
--     CREATE TABLE producto_bodegas_visibilidad_bkp AS
--     SELECT * FROM producto_bodegas_visibilidad;
-- ============================================================

-- 0) Sanity check: confirmar que la bodega 1 existe y está activa
SELECT id_bodega, nombre_bodega, tipo_bodega, activo
FROM bodegas
WHERE id_bodega = 1;
-- Si no devuelve 1 fila, cambiá el "1" de los pasos siguientes
-- por el id_bodega correcto (p.ej. la primera bodega PRINCIPAL).

-- 1) PROTECTED: lista los productos que NO se van a tocar.
--    Incluye los que tienen bodegas 5 y 1 explícitamente.
SELECT 'Productos con reglas para bodega 1' AS tipo, COUNT(*) AS n
FROM producto_bodegas_visibilidad WHERE id_bodega = 1
UNION ALL
SELECT 'Productos con reglas para bodega 5', COUNT(*)
FROM producto_bodegas_visibilidad WHERE id_bodega = 5
UNION ALL
SELECT 'Productos con reglas para 5 y 1 (ambos)', COUNT(*)
FROM producto_bodegas_visibilidad pb1
JOIN producto_bodegas_visibilidad pb5
  ON pb5.id_producto = pb1.id_producto
WHERE pb1.id_bodega = 1 AND pb5.id_bodega = 5;

-- 1.b) Detalle de los productos con bodegas 5 y 1 (snapshot ANTES)
SELECT p.id_producto, p.sku, p.nombre_producto
FROM productos p
JOIN producto_bodegas_visibilidad pb1 ON pb1.id_producto = p.id_producto AND pb1.id_bodega = 1
JOIN producto_bodegas_visibilidad pb5 ON pb5.id_producto = p.id_producto AND pb5.id_bodega = 5
ORDER BY p.id_producto;
-- ⚠️ Guardá este listado: lo vas a comparar con el paso 4.b después
--    de aplicar la migración. Los IDs y nombres deben ser idénticos.

-- 2) Dry-run: cuántos productos en "Todas" van a migrarse
SELECT COUNT(*) AS productos_en_todas_a_migrar
FROM productos p
WHERE NOT EXISTS (
  SELECT 1 FROM producto_bodegas_visibilidad pbv
  WHERE pbv.id_producto = p.id_producto
);
-- Esto te dice exactamente cuántas filas se van a insertar en el paso 3.

-- 3) Aplicar la migración
--    SOLO toca productos que NO tienen ninguna regla en
--    producto_bodegas_visibilidad. Los que tienen bodega 5 y/o
--    bodega 1 (o cualquier otra) quedan INTACTOS.
INSERT INTO producto_bodegas_visibilidad (id_producto, id_bodega, visible)
SELECT p.id_producto, 1, 1
FROM productos p
WHERE NOT EXISTS (
  SELECT 1 FROM producto_bodegas_visibilidad pbv
  WHERE pbv.id_producto = p.id_producto
)
AND EXISTS (
  SELECT 1 FROM bodegas b
  WHERE b.id_bodega = 1 AND b.activo = 1
);
-- Filas afectadas esperadas: mismo número que el SELECT del paso 2.

-- 4) Verificación POST-migración

-- 4.a) Distribución de productos activos por estado
SELECT
  CASE
    WHEN pbv.id_bodega IS NOT NULL
      THEN 'Asignados a bodega 1'
    WHEN EXISTS (
        SELECT 1 FROM producto_bodegas_visibilidad pbv2
        WHERE pbv2.id_producto = p.id_producto
      )
      THEN 'Con reglas (sin bodega 1)'
    ELSE 'Sin reglas (Todas)'
  END AS estado,
  COUNT(*) AS n_productos
FROM productos p
LEFT JOIN producto_bodegas_visibilidad pbv
  ON pbv.id_producto = p.id_producto AND pbv.id_bodega = 1
WHERE p.activo = 1
GROUP BY estado
ORDER BY n_productos DESC;

-- 4.b) Verificación de seguridad: los productos con bodegas 5 y 1
--      deben seguir EXACTAMENTE iguales que en el paso 1.b.
--      Compará los IDs con el listado que guardaste.
SELECT p.id_producto, p.sku, p.nombre_producto
FROM productos p
JOIN producto_bodegas_visibilidad pb1 ON pb1.id_producto = p.id_producto AND pb1.id_bodega = 1
JOIN producto_bodegas_visibilidad pb5 ON pb5.id_producto = p.id_producto AND pb5.id_bodega = 5
ORDER BY p.id_producto;
-- Debe devolver el MISMO listado que el paso 1.b.

-- 4.c) Los productos que se acaban de migrar: ahora SOLO tienen
--      regla para bodega 1 (no para otras bodegas)
SELECT p.id_producto, p.sku, p.nombre_producto
FROM productos p
JOIN producto_bodegas_visibilidad pbv
  ON pbv.id_producto = p.id_producto AND pbv.id_bodega = 1
WHERE NOT EXISTS (
  SELECT 1 FROM producto_bodegas_visibilidad pbv2
  WHERE pbv2.id_producto = p.id_producto AND pbv2.id_bodega <> 1
);
-- Esta es la lista de productos que pasaron de "Todas" a "1 bodega".

-- ============================================================
-- ROLLBACK (solo si algo sale mal)
-- ============================================================
-- Borra las reglas que se acaban de insertar. Solo elimina las
-- reglas de bodega 1 para productos que NO tienen otras reglas
-- (o sea, exactamente los que migró este script).
--
-- DELETE pbv FROM producto_bodegas_visibilidad pbv
-- INNER JOIN (
--   SELECT id_producto
--   FROM producto_bodegas_visibilidad
--   WHERE id_bodega = 1
--   GROUP BY id_producto
--   HAVING COUNT(*) = 1
-- ) solo_migrados ON solo_migrados.id_producto = pbv.id_producto
-- WHERE pbv.id_bodega = 1;
-- ============================================================
