-- ============================================================
-- Migración: productos en estado "Todas" → solo visible en bodega 1
-- ============================================================
-- ¿Qué hace?
--   • Productos SIN reglas en producto_bodegas_visibilidad
--     (estado "Todas" → se ven en todas las bodegas por defecto)
--     → se les crea una regla (id_bodega=1, visible=1)
--
--   • Productos que YA tienen reglas para varias bodegas
--     (visible=1 en 2+ bodegas) → se CONSOLIDAN a solo bodega 1
--     (bloque OPCIONAL, comentado más abajo)
--
--   • Productos con reglas para UNA sola bodega distinta de 1
--     (visible=1 solo en bodega X≠1) → NO se tocan
--
-- ⚠️  HACER BACKUP DE LA TABLA ANTES DE EJECUTAR:
-- ============================================================

-- 0) BACKUP — correr primero, sin falta
CREATE TABLE IF NOT EXISTS producto_bodegas_visibilidad_bkp_20260803 AS
SELECT * FROM producto_bodegas_visibilidad;
-- Verificá que tenga filas: debe coincidir con el COUNT del paso 1.

-- 1) Conteo de la tabla original (para comparar con el backup)
SELECT COUNT(*) AS filas_en_pbv_original
FROM producto_bodegas_visibilidad;

-- 2) Sanity check: confirmar que la bodega 1 existe y está activa
SELECT id_bodega, nombre_bodega, tipo_bodega, activo
FROM bodegas
WHERE id_bodega = 1;
-- Si no devuelve 1 fila, cambiá el "1" de los pasos siguientes
-- por el id_bodega correcto (p.ej. la primera bodega PRINCIPAL).

-- ============================================================
-- A) MIGRACIÓN BASE — solo productos "Todas" (sin reglas)
-- ============================================================

-- A.1) Dry-run: cuántos productos en "Todas" van a migrarse
SELECT COUNT(*) AS productos_en_todas_a_migrar
FROM productos p
WHERE p.activo = 1
  AND NOT EXISTS (
    SELECT 1 FROM producto_bodegas_visibilidad pbv
    WHERE pbv.id_producto = p.id_producto
  );
-- Esto te dice exactamente cuántas filas se van a insertar en A.2.
-- Guardá este número.

-- A.2) Vista previa de los productos a migrar (SKU + nombre)
SELECT p.id_producto, p.sku, p.nombre_producto
FROM productos p
WHERE p.activo = 1
  AND NOT EXISTS (
    SELECT 1 FROM producto_bodegas_visibilidad pbv
    WHERE pbv.id_producto = p.id_producto
  )
ORDER BY p.id_producto
LIMIT 50;
-- ↑ Revisá que la lista sea coherente. Si ves productos que NO
-- querés migrar, agregales una regla manual antes de correr A.3.

-- A.3) Aplicar la migración
--      SOLO toca productos SIN reglas en producto_bodegas_visibilidad.
--      Los que ya tienen reglas (1 o más bodegas) quedan INTACTOS.
INSERT INTO producto_bodegas_visibilidad (id_producto, id_bodega, visible)
SELECT p.id_producto, 1, 1
FROM productos p
WHERE p.activo = 1
  AND NOT EXISTS (
    SELECT 1 FROM producto_bodegas_visibilidad pbv
    WHERE pbv.id_producto = p.id_producto
  )
  AND EXISTS (
    SELECT 1 FROM bodegas b
    WHERE b.id_bodega = 1 AND b.activo = 1
  );
-- Filas afectadas esperadas: mismo número que A.1.

-- ============================================================
-- B) MIGRACIÓN OPCIONAL — consolidar productos con varias bodegas
-- ============================================================
-- ⚠️  PELIGROSO: este bloque BORRA reglas existentes y deja el
-- producto visible SOLO en bodega 1. Descomentar solo si estás
-- seguro. La lógica: cualquier producto que tenga visible=1 en
-- 2 o más bodegas → se le quitan TODAS las reglas y se le crea
-- una sola para bodega 1.
-- ============================================================

-- B.1) Dry-run: cuántos productos están en 2+ bodegas
-- SELECT COUNT(*) AS productos_a_consolidar
-- FROM (
--   SELECT id_producto
--   FROM producto_bodegas_visibilidad
--   WHERE visible = 1
--   GROUP BY id_producto
--   HAVING COUNT(*) >= 2
-- ) x;

-- B.2) Detalle antes de aplicar
-- SELECT p.id_producto, p.sku, p.nombre_producto,
--        GROUP_CONCAT(CONCAT('bodega ', pbv.id_bodega) ORDER BY pbv.id_bodega) AS bodegas_actuales
-- FROM productos p
-- JOIN producto_bodegas_visibilidad pbv ON pbv.id_producto = p.id_producto
-- WHERE pbv.visible = 1
-- GROUP BY p.id_producto, p.sku, p.nombre_producto
-- HAVING COUNT(*) >= 2
-- ORDER BY p.id_producto;

-- B.3) Aplicar consolidación
-- START TRANSACTION;
--   -- 1) Borrar todas las reglas de los productos afectados
--   DELETE pbv FROM producto_bodegas_visibilidad pbv
--   INNER JOIN (
--     SELECT id_producto
--     FROM producto_bodegas_visibilidad
--     WHERE visible = 1
--     GROUP BY id_producto
--     HAVING COUNT(*) >= 2
--   ) multi ON multi.id_producto = pbv.id_producto;
--
--   -- 2) Crear la regla única de bodega 1
--   INSERT INTO producto_bodegas_visibilidad (id_producto, id_bodega, visible)
--   SELECT multi.id_producto, 1, 1
--   FROM (
--     SELECT id_producto
--     FROM producto_bodegas_visibilidad
--     WHERE visible = 1
--     GROUP BY id_producto
--     HAVING COUNT(*) >= 2
--   ) multi;
-- COMMIT;

-- ============================================================
-- 4) Verificación POST-migración
-- ============================================================

-- 4.a) Distribución de productos activos por estado de visibilidad
SELECT
  CASE
    WHEN pbv.id_bodega IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM producto_bodegas_visibilidad pbv2
        WHERE pbv2.id_producto = p.id_producto AND pbv2.id_bodega <> 1
      )
      THEN 'Solo bodega 1'
    WHEN pbv.id_bodega IS NOT NULL
      THEN 'Bodega 1 + otras bodegas'
    WHEN EXISTS (
        SELECT 1 FROM producto_bodegas_visibilidad pbv2
        WHERE pbv2.id_producto = p.id_producto
      )
      THEN 'Otras bodegas (sin 1)'
    ELSE 'Sin reglas (Todas)'
  END AS estado,
  COUNT(*) AS n_productos
FROM productos p
LEFT JOIN producto_bodegas_visibilidad pbv
  ON pbv.id_producto = p.id_producto AND pbv.id_bodega = 1
WHERE p.activo = 1
GROUP BY estado
ORDER BY n_productos DESC;
-- Después de A.3, esperás:
--   - "Sin reglas (Todas)" → 0
--   - "Solo bodega 1"      → el número de A.1
--   - "Bodega 1 + otras bodegas" / "Otras bodegas (sin 1)" → intactos

-- 4.b) Productos que ahora SOLO tienen regla para bodega 1
--      (los que pasaron de "Todas" → "1 bodega" gracias a A.3)
SELECT p.id_producto, p.sku, p.nombre_producto
FROM productos p
JOIN producto_bodegas_visibilidad pbv
  ON pbv.id_producto = p.id_producto AND pbv.id_bodega = 1 AND pbv.visible = 1
WHERE p.activo = 1
  AND NOT EXISTS (
    SELECT 1 FROM producto_bodegas_visibilidad pbv2
    WHERE pbv2.id_producto = p.id_producto
      AND (pbv2.id_bodega <> 1 OR pbv2.visible = 0)
  )
ORDER BY p.id_producto;

-- 4.c) Listado de los productos que originalmente NO se tocaron
--      (los que ya tenían reglas) — útil para auditoría
SELECT p.id_producto, p.sku, p.nombre_producto,
       GROUP_CONCAT(CONCAT('bodega ', pbv.id_bodega,
                           IF(pbv.visible=0, ' (oculto)', ''))
                    ORDER BY pbv.id_bodega) AS bodegas_asignadas
FROM productos p
JOIN producto_bodegas_visibilidad pbv ON pbv.id_producto = p.id_producto
WHERE p.activo = 1
  AND p.id_producto IN (
    SELECT id_producto
    FROM producto_bodegas_visibilidad
    GROUP BY id_producto
    HAVING COUNT(*) > 1
  )
GROUP BY p.id_producto, p.sku, p.nombre_producto
ORDER BY p.id_producto;

-- ============================================================
-- 5) ROLLBACK (solo si algo sale mal)
-- ============================================================
-- Restaura la tabla completa desde el backup del paso 0.
-- ⚠️  ATENCIÓN: si después del INSERT hiciste cambios manuales
-- sobre producto_bodegas_visibilidad, se van a perder.
--
-- Descomentar y correr solo si necesitás volver atrás:
--
-- TRUNCATE TABLE producto_bodegas_visibilidad;
-- INSERT INTO producto_bodegas_visibilidad
--   (id_producto, id_bodega, visible, actualizado_en)
-- SELECT id_producto, id_bodega, visible, actualizado_en
-- FROM producto_bodegas_visibilidad_bkp_20260803;
-- ============================================================
