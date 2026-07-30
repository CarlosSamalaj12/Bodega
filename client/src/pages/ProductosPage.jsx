import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Pagination } from '@/components/ui/Pagination';
import { toast } from '@/components/ui/Toast';
import { ProductosFilters } from '@/components/productos/ProductosFilters';
import { ProductoForm } from '@/components/productos/ProductoForm';
import { useDebounce } from '@/hooks/useDebounce';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { ColumnSelectorModal } from '@/components/ui/ColumnSelectorModal';
import { downloadCSV, downloadXLSX, downloadPDF } from '@/utils/export';
import { productosService } from '@/services/productos.service';
import { catalogosService } from '@/services/catalogos.service';
import { useAuthStore } from '@/stores/auth.store';
import { hasPermission } from '@/utils/permissions';
import { EmptyState } from '@/components/ui/EmptyState';
import './ProductosPage.scss';

const ORDER_KEY = 'prod-order-v1';

function loadOrder() {
  try { const r = localStorage.getItem(ORDER_KEY); return r ? JSON.parse(r) : []; }
  catch { return []; }
}
function saveOrder(ids) {
  try { localStorage.setItem(ORDER_KEY, JSON.stringify(ids)); } catch { /* */ }
}

// ================== DragItem ==================
function DragItem({ row, children, onReorder }) {
  const ref = useRef(null);
  const rowId = Number(row.id_producto);

  const onStart = useCallback((e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(rowId));
    requestAnimationFrame(() => ref.current?.classList.add('productos-page__item--dragging'));
  }, [rowId]);

  const onOver = useCallback((e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }, []);
  const onEnd = useCallback(() => { ref.current?.classList.remove('productos-page__item--dragging'); }, []);
  const onDrop = useCallback((e) => {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData('text/plain'));
    if (id && id !== rowId) onReorder(id, rowId);
  }, [rowId, onReorder]);

  return (
    <div ref={ref} draggable="true" className="productos-page__item"
      onDragStart={onStart} onDragOver={onOver} onDragEnd={onEnd} onDrop={onDrop}>
      {children}
    </div>
  );
}

export default function ProductosPage() {
  const user = useAuthStore((s) => s.user);
  const permisos = user?.permisos || {};
  const canCreate = hasPermission(permisos, 'action.create_update');
  const canEdit = hasPermission(permisos, 'action.create_update');
  const isMobile = !useMediaQuery('(min-width: 768px)');

  // Filtros
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 350);
  const [showInactive, setShowInactive] = useState(false);
  const [categoriaId, setCategoriaId] = useState(null);
  const [medidaId, setMedidaId] = useState(null);

  // Paginación
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Datos
  const [productos, setProductos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Catálogos
  const [categorias, setCategorias] = useState([]);
  const [subcategorias, setSubcategorias] = useState([]);
  const [medidas, setMedidas] = useState([]);
  const [bodegas, setBodegas] = useState([]);

  // Export column selector
  const [showColumnSelector, setShowColumnSelector] = useState(false);

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  // Carga catálogos al montar
  useEffect(() => {
    const ctrl = new AbortController();
    Promise.all([
      catalogosService.getCategorias(ctrl.signal).catch(() => []),
      catalogosService.getSubcategorias(ctrl.signal).catch(() => []),
      catalogosService.getMedidas(ctrl.signal).catch(() => []),
      catalogosService.getBodegas(ctrl.signal).catch(() => []),
    ]).then(([cats, subs, meds, bds]) => {
      setCategorias(cats || []);
      setSubcategorias(subs || []);
      setMedidas(meds || []);
      setBodegas((bds || []).filter((b) => Number(b.activo) === 1));
    });
    return () => ctrl.abort();
  }, []);

  // Ref con filtros actuales para evitar recrear fetchProductos
  const filtersRef = useRef({});
  filtersRef.current = { debouncedSearch, showInactive, categoriaId, medidaId };

  // Carga productos cuando cambian filtros o página
  const fetchProductos = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const f = filtersRef.current;
      const result = await productosService.list({
        q: f.debouncedSearch,
        all: f.showInactive,
        limit: 50,
        page,
        categoria: f.categoriaId || undefined,
        medida: f.medidaId || undefined,
      });
      setProductos(result?.rows || []);
      setTotalPages(result?.totalPages || 1);
      setTotal(result?.total || 0);
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Error al cargar productos');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page]); // Solo cambia cuando cambia la página

  // Re-fetch cuando cambian filtros (leídos del ref) o página
  useEffect(() => { fetchProductos(); }, [
    fetchProductos,
    debouncedSearch,
    showInactive,
    categoriaId,
    medidaId,
  ]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, showInactive, categoriaId, medidaId]);

  // ---- Orden ----
  const ordered = useMemo(() => {
    const order = loadOrder();
    const map = new Map();
    order.forEach((id, i) => map.set(id, i));
    const known = [], unknown = [];
    for (const item of productos) {
      if (map.has(Number(item.id_producto))) known.push(item);
      else unknown.push(item);
    }
    known.sort((a, b) => map.get(Number(a.id_producto)) - map.get(Number(b.id_producto)));
    return [...known, ...unknown];
  }, [productos]);

  // Filtro ahora server-side (categoría/medida se envían al backend)

  // ---- Drag reorder ----
  const handleReorder = useCallback((fromId, toId) => {
    setProductos((prev) => {
      const next = [...prev];
      const fi = next.findIndex((r) => Number(r.id_producto) === fromId);
      const ti = next.findIndex((r) => Number(r.id_producto) === toId);
      if (fi === -1 || ti === -1) return prev;
      const [m] = next.splice(fi, 1);
      next.splice(ti, 0, m);
      saveOrder(next.map((r) => Number(r.id_producto)));
      return next;
    });
  }, []);

  const handleCreate = () => {
    setEditing(null);
    setFormError(null);
    setModalOpen(true);
  };

  const handleEdit = async (producto) => {
    try {
      // Cargamos la visibilidad completa del producto
      const vis = await productosService.getVisibilidad(producto.id_producto);
      setEditing({ ...producto, id_bodegas_visibles: vis?.ids || [] });
      setFormError(null);
      setModalOpen(true);
    } catch (e) {
      toast.error('No se pudo cargar el producto');
    }
  };

  const handleSubmit = async (values) => {
    setSubmitting(true);
    setFormError(null);
    try {
      if (editing?.id_producto) {
        await productosService.update(editing.id_producto, values);
        toast.success('Producto actualizado');
      } else {
        await productosService.create(values);
        toast.success('Producto creado');
      }
      setModalOpen(false);
      fetchProductos(true);
    } catch (e) {
      const msg = e?.response?.data?.error || 'Error al guardar';
      setFormError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleVisibilidad = async (producto, visible) => {
    try {
      await productosService.toggleVisibilidadMiBodega(producto.id_producto, visible);
      toast.success(visible ? 'Producto visible en tu bodega' : 'Producto ocultado en tu bodega');
      fetchProductos(true);
    } catch (e) {
      toast.error(e?.response?.data?.error || 'No se pudo cambiar la visibilidad');
    }
  };

  const handleClearFilters = () => {
    setSearch('');
    setCategoriaId(null);
    setMedidaId(null);
    setShowInactive(false);
  };

  const hasActiveFilters = search || categoriaId || medidaId || showInactive;

  const exportColumns = [
    { key: 'id_producto', label: '#' },
    { key: 'nombre_producto', label: 'Producto' },
    { key: 'sku', label: 'SKU' },
    { key: 'nombre_categoria', label: 'Categoría' },
    { key: 'nombre_subcategoria', label: 'Subcategoría' },
    { key: 'nombre_medida', label: 'Medida' },
    { key: 'activo', label: 'Activo' },
  ];

  return (
    <>
      <Header
        title="Productos"
        subtitle={`${total} producto${total === 1 ? '' : 's'}${
          hasActiveFilters ? ' (filtrado)' : ''
        }${page > 1 ? ` · Pág. ${page}` : ''}`}
        actions={
          <div className="productos-page__header-actions">
            {refreshing && <Spinner size={14} />}
            {ordered.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setShowColumnSelector(true)}>
                Exportar CSV
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => fetchProductos(true)}>
              Refrescar
            </Button>
            {canCreate && <Button size={isMobile ? 'sm' : 'md'} onClick={handleCreate}>Nuevo producto</Button>}
          </div>
        }
      />

      <div className="productos-page">
        <Card>
          <ProductosFilters
            search={search}
            onSearchChange={setSearch}
            showInactive={showInactive}
            onShowInactiveChange={setShowInactive}
            categoriaId={categoriaId}
            onCategoriaChange={setCategoriaId}
            categorias={categorias}
            medidaId={medidaId}
            onMedidaChange={setMedidaId}
            medidas={medidas}
          />
          {hasActiveFilters && (
            <div className="productos-page__clear">
              <Button size="sm" variant="ghost" onClick={handleClearFilters}>
                Limpiar filtros
              </Button>
            </div>
          )}
        </Card>

        {loading ? (
          <div className="productos-page__loading"><Spinner size={20} label="Cargando productos…" /></div>
        ) : ordered.length === 0 ? (
          <EmptyState
            icon="◧"
            title="Sin productos"
            message="No se encontraron productos con los filtros aplicados."
            action={canEdit ? <Button onClick={handleCreate}>Crear primer producto</Button> : null}
          />
        ) : (
          <>
            <div className="productos-page__list">
              {ordered.map((row) => (
                <DragItem key={`prd-prd-${row.id_producto}`} row={row} onReorder={handleReorder}>
                  <span className="productos-page__drag-handle" title="Arrastrar para reordenar">⠿</span>
                  <div className="productos-page__item-info">
                    <div className="productos-page__item-main">
                      <div className="productos-page__item-head">
                        <span className="productos-page__item-name">{row.nombre_producto}</span>
                        {row.sku && <code className="productos-page__item-sku">{row.sku}</code>}
                      </div>
                      <div className="productos-page__item-meta">
                        {row.nombre_categoria && <span className="productos-page__item-tag">{row.nombre_categoria}</span>}
                        {row.nombre_subcategoria && <span className="productos-page__item-tag">{row.nombre_subcategoria}</span>}
                        {row.nombre_medida && <span className="productos-page__item-tag">{row.nombre_medida}</span>}
                        <span className={`productos-page__vis-badge ${Number(row.total_bodegas_visibles) > 0 ? 'productos-page__vis-badge--limited' : ''}`}>
                          {Number(row.total_bodegas_visibles) > 0 ? `${row.total_bodegas_visibles} bodega${Number(row.total_bodegas_visibles) === 1 ? '' : 's'}` : 'Todas'}
                        </span>
                      </div>
                    </div>
                    <div className="productos-page__item-end">
                      <span className={`productos-page__item-badge ${Number(row.activo) === 1 ? 'productos-page__item-badge--active' : 'productos-page__item-badge--inactive'}`}>
                        {Number(row.activo) === 1 ? 'Activo' : 'Inactivo'}
                      </span>
                    </div>
                  </div>
                  <div className="productos-page__item-actions">
                    {canEdit && (
                      <Button size="sm" variant="ghost" onClick={() => handleEdit(row)} title="Editar">✎</Button>
                    )}
                    {Boolean(user?.id_warehouse) && Number(row.visible_en_bodega_usuario) === 0 && (
                      <Button size="sm" variant="subtle" onClick={() => handleToggleVisibilidad(row, true)} title="Hacer visible en tu bodega">Mostrar</Button>
                    )}
                    {Boolean(user?.id_warehouse) && Number(row.visible_en_bodega_usuario) === 1 && Number(row.total_bodegas_visibles) > 0 && (
                      <Button size="sm" variant="ghost" onClick={() => handleToggleVisibilidad(row, false)} title="Ocultar en tu bodega">Ocultar</Button>
                    )}
                  </div>
                </DragItem>
              ))}
            </div>
            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              onChange={setPage}
              loading={loading}
            />
          </>
        )}
      </div>

      <ColumnSelectorModal
        open={showColumnSelector}
        onClose={() => setShowColumnSelector(false)}
        columns={exportColumns}
        storageKey="export-columns-productos"
        onConfirm={(cols, format) => {
          const fn = { csv: downloadCSV, xlsx: downloadXLSX, pdf: downloadPDF }[format] || downloadCSV;
          fn(ordered, {
            filename: `productos_${new Date().toISOString().slice(0, 10)}`,
            columns: cols,
            format: (row, col) => {
              if (col.key === 'activo') return Number(row.activo) === 1 ? 'Sí' : 'No';
              return row[col.key];
            },
          });
          setShowColumnSelector(false);
        }}
      />

      <Modal
        open={modalOpen}
        onClose={() => !submitting && setModalOpen(false)}
        title={editing ? 'Editar producto' : 'Nuevo producto'}
        size="lg"
      >
        <ProductoForm
          initial={editing}
          categorias={categorias}
          subcategorias={subcategorias}
          medidas={medidas}
          bodegas={bodegas}
          onSubmit={handleSubmit}
          onCancel={() => setModalOpen(false)}
          submitting={submitting}
          error={formError}
        />
      </Modal>
    </>
  );
}
