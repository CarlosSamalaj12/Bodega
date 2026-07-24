import { useEffect, useMemo, useState, useCallback } from 'react';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/Toast';
import { ProductosFilters } from '@/components/productos/ProductosFilters';
import { ProductosTable } from '@/components/productos/ProductosTable';
import { ProductoForm } from '@/components/productos/ProductoForm';
import { useDebounce } from '@/hooks/useDebounce';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { productosService } from '@/services/productos.service';
import { catalogosService } from '@/services/catalogos.service';
import { useAuthStore } from '@/stores/auth.store';
import './ProductosPage.scss';

export function ProductosPage() {
  const user = useAuthStore((s) => s.user);
  const permisos = user?.permisos || {};
  const canCreate = permisos['action.create_update'] !== false;
  const canEdit = permisos['action.create_update'] !== false;
  const isMobile = !useMediaQuery('(min-width: 768px)');

  // Filtros
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 350);
  const [showInactive, setShowInactive] = useState(false);
  const [categoriaId, setCategoriaId] = useState(null);
  const [medidaId, setMedidaId] = useState(null);

  // Datos
  const [productos, setProductos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Catálogos
  const [categorias, setCategorias] = useState([]);
  const [subcategorias, setSubcategorias] = useState([]);
  const [medidas, setMedidas] = useState([]);
  const [bodegas, setBodegas] = useState([]);

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

  // Carga productos cuando cambian filtros
  const fetchProductos = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const data = await productosService.list({
        q: debouncedSearch,
        all: showInactive,
        limit: 500,
      });
      setProductos(data || []);
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Error al cargar productos');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [debouncedSearch, showInactive]);

  useEffect(() => {
    fetchProductos();
  }, [fetchProductos]);

  // Filtro client-side por categoría/medida (el backend ya filtra por q)
  const productosFiltrados = useMemo(() => {
    return productos.filter((p) => {
      if (categoriaId && Number(p.id_categoria) !== Number(categoriaId)) return false;
      if (medidaId && Number(p.id_medida) !== Number(medidaId)) return false;
      return true;
    });
  }, [productos, categoriaId, medidaId]);

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

  return (
    <>
      <Header
        title="Productos"
        subtitle={`${productosFiltrados.length} producto${productosFiltrados.length === 1 ? '' : 's'}${
          hasActiveFilters ? ' (filtrado)' : ''
        }`}
        actions={
          <div className="productos-page__header-actions">
            {refreshing && <Spinner size={14} />}
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

        <ProductosTable
          productos={productosFiltrados}
          loading={loading}
          onEdit={canEdit ? handleEdit : undefined}
          onToggleVisibilidad={handleToggleVisibilidad}
          onCreate={handleCreate}
          canEdit={canEdit}
          canToggle={Boolean(user?.id_warehouse)}
        />
      </div>

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
