import { useCallback, useEffect, useMemo, useState } from 'react';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Badge } from '@/components/ui/Badge';
import { SearchInput } from '@/components/ui/SearchInput';
import { DataList } from '@/components/ui/DataList';
import { useDebounce } from '@/hooks/useDebounce';
import { toast } from '@/components/ui/Toast';
import { useAuthStore } from '@/stores/auth.store';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { ColumnSelectorModal } from '@/components/ui/ColumnSelectorModal';
import { downloadCSV, downloadXLSX, downloadPDF } from '@/utils/export';
import { formatDate } from '@/utils/format';
import { catalogosService } from '@/services/catalogos.service';
import { pedidosService } from '@/services/pedidos.service';
import { PedidoForm } from '@/components/pedidos/PedidoForm';
import './PedidosPage.scss';

const ESTADO_LABELS = {
  PENDIENTE: { label: 'Pendiente', variant: 'warning' },
  APROBADO: { label: 'Aprobado', variant: 'info' },
  PARCIAL: { label: 'Parcial', variant: 'info' },
  COMPLETADO: { label: 'Completado', variant: 'success' },
  COMPLETADO_JUSTIFICADO: { label: 'Completado (justificado)', variant: 'success' },
  CANCELADO: { label: 'Cancelado', variant: 'danger' },
};

export default function PedidosPage() {
  const user = useAuthStore((s) => s.user);
  const permisos = user?.permisos || {};
  const canCreate = permisos['action.create_update'] !== false;
  const isMobile = !useMediaQuery('(min-width: 768px)');

  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [bodegas, setBodegas] = useState([]);
  const [catalogError, setCatalogError] = useState(null);
  const [loadingCatalogs, setLoadingCatalogs] = useState(true);

  const [pedidos, setPedidos] = useState([]);
  const [loadingPedidos, setLoadingPedidos] = useState(true);
  const [search, setSearch] = useState('');
  const [showColumnSelector, setShowColumnSelector] = useState(false);
  const debouncedSearch = useDebounce(search, 250);

  const loadCatalogs = useCallback(async () => {
    setLoadingCatalogs(true);
    setCatalogError(null);
    try {
      const bds = await catalogosService.getBodegas();
      setBodegas((bds || []).filter((b) => Number(b.activo) === 1));
    } catch (e) {
      const msg = e?.response?.data?.error || e?.message || 'Error desconocido';
      setCatalogError(msg);
    } finally {
      setLoadingCatalogs(false);
    }
  }, []);

  const loadPedidos = useCallback(async () => {
    setLoadingPedidos(true);
    try {
      const data = await pedidosService.list();
      setPedidos(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error(e?.response?.data?.error || 'No se pudieron cargar los pedidos');
    } finally {
      setLoadingPedidos(false);
    }
  }, []);

  useEffect(() => {
    loadCatalogs();
    loadPedidos();
  }, [loadCatalogs, loadPedidos]);

  const handleCreated = () => {
    setModalOpen(false);
    loadPedidos();
  };

  const pedidosSorted = useMemo(() => {
    let filtered = [...pedidos].sort((a, b) => Number(b.id_pedido || 0) - Number(a.id_pedido || 0));
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      filtered = filtered.filter((p) => {
        const id = String(p.id_pedido || '');
        const bodegaDest = String(p.nombre_bodega_surtidor || '').toLowerCase();
        const bodegaSol = String(p.nombre_bodega_solicita || '').toLowerCase();
        const estado = String(p.estado || '').toLowerCase();
        return (
          id.includes(q) || bodegaDest.includes(q) || bodegaSol.includes(q) || estado.includes(q)
        );
      });
    }
    return filtered;
  }, [pedidos, debouncedSearch]);

  const columns = useMemo(
    () => [
      {
        key: 'id_pedido',
        label: '#',
        width: 80,
        primary: true,
        render: (p) => <code>#{p.id_pedido}</code>,
      },
      {
        key: 'creado_en',
        label: 'Fecha',
        render: (p) => <span className="pedidos-page__date">{formatDate(p.creado_en)}</span>,
      },
      {
        key: 'nombre_bodega_surtidor',
        label: 'Bodega destino',
        render: (p) => p.nombre_bodega_surtidor || '—',
      },
      {
        key: 'nombre_bodega_solicita',
        label: 'Tu bodega',
        render: (p) => p.nombre_bodega_solicita || '—',
      },
      {
        key: 'total_lineas',
        label: 'Líneas',
        width: 80,
        align: 'right',
        render: (p) => p.total_lineas ?? '—',
      },
      {
        key: 'estado',
        label: 'Estado',
        width: 180,
        render: (p) => {
          const est = ESTADO_LABELS[p.estado] || { label: p.estado, variant: 'default' };
          return <Badge variant={est.variant}>{est.label}</Badge>;
        },
        cardMeta: (p) => {
          const est = ESTADO_LABELS[p.estado] || { label: p.estado, variant: 'default' };
          return <Badge variant={est.variant}>{est.label}</Badge>;
        },
      },
    ],
    []
  );

  return (
    <>
      <Header
        title="Realizar pedidos"
        subtitle={`${pedidos.length} pedido${pedidos.length === 1 ? '' : 's'} en total`}
        actions={
          <div className="pedidos-page__actions">
            {pedidosSorted.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setShowColumnSelector(true)}>
                Exportar CSV
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={loadPedidos}>
              Refrescar
            </Button>
            {canCreate && (
              <Button size={isMobile ? 'sm' : 'md'} onClick={() => setModalOpen(true)}>
                + Nuevo pedido
              </Button>
            )}
          </div>
        }
      />

      <div className="pedidos-page">
        <Card
          title="¿Cómo funciona?"
          subtitle="Pides productos a otra bodega (PRINCIPAL o RECEPTORA)"
        >
          <ol className="pedidos-page__steps">
            <li>Elige la <strong>bodega</strong> a la que pides (no la tuya).</li>
            <li>Captura tu <strong>PIN de pedidos</strong> (6-12 dígitos, lo configuraste antes).</li>
            <li>Agrega las <strong>líneas</strong> con producto y cantidad.</li>
            <li>Envía — el surtidor recibe la solicitud en su panel.</li>
            <li>El estado pasa de <em>Pendiente</em> a <em>Parcial</em>/<em>Completado</em> cuando surten.</li>
          </ol>
        </Card>

        <Card compact>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar por #, bodega, estado…"
          />
        </Card>

        <DataList
          columns={columns}
          rows={pedidosSorted}
          loading={loadingPedidos}
          keyField="id_pedido"
          emptyTitle={search ? 'Sin resultados' : 'Sin pedidos'}
          emptyMessage={search ? 'Intenta con otros términos.' : 'Cuando crees un pedido aparecerá aquí.'}
          emptyAction={!search && canCreate ? <Button onClick={() => setModalOpen(true)}>Crear primer pedido</Button> : null}
        />
      </div>

      <ColumnSelectorModal
        open={showColumnSelector}
        onClose={() => setShowColumnSelector(false)}
        columns={[
          { key: 'id_pedido', label: '#' },
          { key: 'creado_en', label: 'Fecha' },
          { key: 'nombre_bodega_surtidor', label: 'Bodega destino' },
          { key: 'nombre_bodega_solicita', label: 'Tu bodega' },
          { key: 'total_lineas', label: 'Líneas' },
          { key: 'estado', label: 'Estado' },
          { key: 'observaciones', label: 'Observaciones' },
          { key: 'usuario_creador', label: 'Usuario' },
        ]}
        storageKey="export-columns-pedidos"
        onConfirm={(cols, format) => {
          const fn = { csv: downloadCSV, xlsx: downloadXLSX, pdf: downloadPDF }[format] || downloadCSV;
          fn(pedidosSorted, {
            filename: `pedidos_${new Date().toISOString().slice(0, 10)}`,
            columns: cols,
            format: (row, col) => {
              if (col.key === 'creado_en' && row.creado_en) {
                return new Date(row.creado_en).toLocaleString();
              }
              if (col.key === 'estado') {
                const est = ESTADO_LABELS[row.estado] || { label: row.estado };
                return est.label;
              }
              return row[col.key];
            },
          });
          setShowColumnSelector(false);
        }}
      />

      <Modal
        open={modalOpen}
        onClose={() => !submitting && setModalOpen(false)}
        title="Nuevo pedido"
        size="xl"
      >
        {catalogError ? (
          <div className="pedidos-page__catalog-error">
            <p><strong>No se pudieron cargar las bodegas.</strong></p>
            <p className="pedidos-page__catalog-error-detail">{catalogError}</p>
            <Button variant="subtle" onClick={loadCatalogs}>Reintentar</Button>
          </div>
        ) : (
          <>
            {loadingCatalogs && (
              <div className="pedidos-page__loading">
                <Spinner size={18} label="Cargando bodegas…" />
              </div>
            )}
            <PedidoForm
              bodegas={bodegas}
              user={user}
              submitting={submitting}
              onSubmittingChange={setSubmitting}
              onCreated={handleCreated}
              onCancel={() => setModalOpen(false)}
            />
          </>
        )}
      </Modal>
    </>
  );
}
