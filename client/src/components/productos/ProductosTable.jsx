import PropTypes from 'prop-types';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataList } from '@/components/ui/DataList';
import './ProductosTable.scss';

function formatVisibilidad(p) {
  const total = Number(p.total_bodegas_visibles) || 0;
  if (total > 0) {
    return <Badge variant="info">{total} bodega{total > 1 ? 's' : ''}</Badge>;
  }
  return <Badge>Todas</Badge>;
}

function formatEstado(p) {
  return Number(p.activo) === 1
    ? <Badge variant="success">Activo</Badge>
    : <Badge variant="danger">Inactivo</Badge>;
}

export function ProductosTable({
  productos = [],
  loading = false,
  onEdit,
  onToggleVisibilidad,
  onCreate,
  canEdit = true,
  canToggle = true,
}) {
  const isMobile = !useMediaQuery('(min-width: 768px)');

  const renderActions = (p) => (
    <div className="productos-table__actions">
      {canEdit && (
        <Button size="sm" variant="ghost" onClick={() => onEdit?.(p)}>
          Editar
        </Button>
      )}
      {canToggle && Number(p.visible_en_bodega_usuario) === 0 && (
        <Button
          size="sm"
          variant="subtle"
          onClick={() => onToggleVisibilidad?.(p, true)}
          title="Hacer visible en tu bodega"
        >
          Mostrar
        </Button>
      )}
      {canToggle && Number(p.visible_en_bodega_usuario) === 1 && Number(p.total_bodegas_visibles) > 0 && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onToggleVisibilidad?.(p, false)}
          title="Ocultar en tu bodega"
        >
          Ocultar
        </Button>
      )}
    </div>
  );

  const columns = [
    {
      key: 'nombre_producto',
      label: 'Producto',
      primary: true,
      render: (p) => <div className="productos-table__name">{p.nombre_producto}</div>,
    },
    {
      key: 'sku',
      label: 'SKU',
      render: (p) =>
        p.sku
          ? <code className="productos-table__sku">{p.sku}</code>
          : <span className="productos-table__muted">—</span>,
    },
    {
      key: 'categoria',
      label: 'Categoría',
      render: (p) => p.nombre_categoria || '—',
    },
    {
      key: 'subcategoria',
      label: 'Subcategoría',
      hideOnMobile: true,
      render: (p) => p.nombre_subcategoria || <span className="productos-table__muted">—</span>,
    },
    {
      key: 'medida',
      label: 'Medida',
      render: (p) => p.nombre_medida || '—',
    },
    {
      key: 'visibilidad',
      label: 'Visibilidad',
      render: (p) => formatVisibilidad(p),
    },
    {
      key: 'estado',
      label: 'Estado',
      render: (p) => formatEstado(p),
    },
    {
      key: 'acciones',
      label: 'Acciones',
      width: 220,
      align: 'right',
      // En móvil, esto se renderiza como barra de acciones en la card (ver cardActions abajo)
      // En desktop, dentro de la celda
      render: (p) => (isMobile ? null : renderActions(p)),
    },
  ];

  return (
    <DataList
      columns={columns}
      rows={productos}
      loading={loading}
      keyField="id_producto"
      emptyTitle="Sin productos"
      emptyMessage="No se encontraron productos con los filtros aplicados."
      emptyAction={canEdit ? <Button onClick={onCreate}>Crear primer producto</Button> : null}
      emptyIcon="◧"
      cardActions={isMobile ? renderActions : null}
    />
  );
}

ProductosTable.propTypes = {
  productos: PropTypes.array,
  loading: PropTypes.bool,
  onEdit: PropTypes.func,
  onToggleVisibilidad: PropTypes.func,
  onCreate: PropTypes.func,
  canEdit: PropTypes.bool,
  canToggle: PropTypes.bool,
};
