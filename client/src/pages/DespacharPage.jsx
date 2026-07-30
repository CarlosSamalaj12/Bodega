import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Badge } from '@/components/ui/Badge';
import { SearchInput } from '@/components/ui/SearchInput';
import { DataList } from '@/components/ui/DataList';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useDebounce } from '@/hooks/useDebounce';
import { toast } from '@/components/ui/Toast';
import { useAuthStore } from '@/stores/auth.store';
import { hasPermission } from '@/utils/permissions';
import { useDispatchStore } from '@/stores/dispatch.store';
import { ColumnSelectorModal } from '@/components/ui/ColumnSelectorModal';
import { downloadCSV, downloadXLSX, downloadPDF } from '@/utils/export';
import { printPedidoPos80mm, printPedidoLetterSize, printOrderListPos80mm } from '@/utils/print';
import { formatDate } from '@/utils/format';
import api from '@/services/api';
import { pedidosService } from '@/services/pedidos.service';
import { getSocket } from '@/services/socket';
import { DespachoForm } from '@/components/despachos/DespachoForm';
import { RevertPanel } from '@/components/despachos/RevertPanel';
import './DespacharPage.scss';

const ESTADO_LABELS = {
  PENDIENTE: { label: 'Pendiente', variant: 'warning' },
  PARCIAL: { label: 'Parcial', variant: 'info' },
  APROBADO: { label: 'Aprobado', variant: 'info' },
  COMPLETADO: { label: 'Completado', variant: 'success' },
  COMPLETADO_JUSTIFICADO: { label: 'Justificado', variant: 'success' },
  CANCELADO: { label: 'Cancelado', variant: 'danger' },
};

const STATUS_OPTIONS = [
  { value: '', label: 'Todos' },
  { value: 'PENDIENTE', label: 'Pendiente', variant: 'warning' },
  { value: 'APROBADO', label: 'Aprobado', variant: 'info' },
  { value: 'PARCIAL', label: 'Parcial', variant: 'info' },
  { value: 'COMPLETADO', label: 'Completado', variant: 'success' },
  { value: 'COMPLETADO_JUSTIFICADO', label: 'Justificado', variant: 'success' },
  { value: 'CANCELADO', label: 'Cancelado', variant: 'danger' },
];

export default function DespacharPage() {
  const isMobile = !useMediaQuery('(min-width: 768px)');
  const user = useAuthStore((s) => s.user);
  const canDispatch = hasPermission(user?.permisos, 'action.dispatch');

  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [activeDetails, setActiveDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showColumnSelector, setShowColumnSelector] = useState(false);
  const debouncedSearch = useDebounce(search, 250);
  const [searchParams, setSearchParams] = useSearchParams();
  const loadingRef = useRef(false);

  const loadPedidos = useCallback(async () => {
    setLoading(true);
    try {
      const data = await pedidosService.list({ scope: 'dispatch' });
      setPedidos(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error(e?.response?.data?.error || 'No se pudieron cargar los pedidos');
    } finally {
      setLoading(false);
    }
  }, []);

  // Evitar llamadas concurrentes a loadPedidos
  const safeLoadPedidos = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      await loadPedidos();
    } finally {
      loadingRef.current = false;
    }
  }, [loadPedidos]);

  // Limpiar notificaciones al entrar a la página
  const clearDispatchNotif = useDispatchStore((s) => s.clear);

  useEffect(() => {
    safeLoadPedidos();
    clearDispatchNotif();
  }, [safeLoadPedidos, clearDispatchNotif]);

  // Si llegamos via un toast clickeable con ?open=ID, abrir el modal automáticamente
  useEffect(() => {
    const openId = searchParams.get('open');
    if (!openId) return;

    const id = Number(openId);
    if (!Number.isFinite(id) || id <= 0) return;

    // Limpiar el parámetro de la URL
    setSearchParams({}, { replace: true });

    // Abrir el modal para este pedido (loadDetails se encarga de cargar los datos)
    handleOpen(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, pedidos]);

  // Socket.IO: Actualización en tiempo real
  useEffect(() => {
    const socket = getSocket();

    const handler = (payload) => {
      const idPedido = Number(payload?.id_pedido || 0);
      const status = String(payload?.status || '').toUpperCase();

      setLastUpdate(new Date());

      // Si es un pedido que nos interesa, refrescamos
      if (['PENDIENTE', 'APROBADO', 'PARCIAL', 'COMPLETADO', 'COMPLETADO_JUSTIFICADO', 'CANCELADO'].includes(status)) {
        safeLoadPedidos();

        // Si tenemos el modal abierto con este pedido, refrescamos detalles también
        if (activeId === idPedido && status && !['PENDIENTE', 'APROBADO', 'PARCIAL'].includes(status)) {
          handleClose();
          toast.info(`Pedido #${idPedido} actualizado a ${status}`);
        }
      }
    };

    socket.on('pedido:changed', handler);
    return () => {
      socket.off('pedido:changed', handler);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const loadDetails = useCallback(async (id) => {
    setLoadingDetails(true);
    try {
      const data = await pedidosService.getDetails(id);
      setActiveDetails({ ...data, id_pedido: id });
    } catch (e) {
      toast.error(e?.response?.data?.error || 'No se pudo cargar el pedido');
      setActiveDetails(null);
    } finally {
      setLoadingDetails(false);
    }
  }, []);

  const handleOpen = (id) => {
    setActiveId(id);
    setModalOpen(true);
    loadDetails(id);
  };

  const handleClose = () => {
    if (submitting) return;
    setModalOpen(false);
    setActiveId(null);
    setActiveDetails(null);
  };

  const handleDone = () => {
    handleClose();
    loadPedidos();
  };

  const visibles = useMemo(() => {
    let filtered = pedidos;

    // Filtro por estado (vacío = todos)
    if (statusFilter) {
      filtered = filtered.filter((p) => {
        const est = String(p.estado || '').toUpperCase();
        return est === statusFilter;
      });
    }

    // Filtro por texto de búsqueda
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      filtered = filtered.filter((p) => {
        const idStr = String(p.id_pedido || '');
        const solicitante = String(p.requester_name || '').toLowerCase();
        const bodega = String(p.requester_warehouse || '').toLowerCase();
        const obs = String(p.observaciones || '').toLowerCase();
        return (
          idStr.includes(q) ||
          solicitante.includes(q) ||
          bodega.includes(q) ||
          obs.includes(q)
        );
      });
    }

    return filtered;
  }, [pedidos, statusFilter, debouncedSearch]);

  const handlePrintPos = useCallback(async (p) => {
    try {
      const details = await pedidosService.getDetails(p.id_pedido);
      printPedidoPos80mm({ ...details, id_pedido: p.id_pedido, estado: p.estado, requester_name: p.requester_name, requester_warehouse: p.requester_warehouse, observaciones: p.observaciones });
    } catch {
      printPedidoPos80mm(p);
    }
  }, []);

  const handlePrintCarta = useCallback(async (p) => {
    try {
      const [details, logoRes] = await Promise.all([
        pedidosService.getDetails(p.id_pedido),
        user?.id_warehouse
          ? api.get(`/api/bodegas/${user.id_warehouse}/logo`).catch(() => ({ data: {} }))
          : Promise.resolve({ data: {} }),
      ]);
      const logoApp = logoRes?.data?.logo_app_data || '';
      printPedidoLetterSize(
        { ...details, id_pedido: p.id_pedido, requester_name: p.requester_name, requester_warehouse: p.requester_warehouse },
        {
          logoApp,
          dispatcherName: user?.full_name || user?.username || '',
          dispatcherRole: user?.role_name || '',
          warehouseName: user?.bodega_nombre || user?.warehouse_name || '',
        }
      );
    } catch {
      printPedidoLetterSize(p, {
        dispatcherName: user?.full_name || user?.username || '',
        dispatcherRole: user?.role_name || '',
        warehouseName: user?.bodega_nombre || user?.warehouse_name || '',
      });
    }
  }, [user]);

  const renderActions = (p) => (
    <div className="despachar-page__actions-cell">
      <div className="despachar-page__print-group">
        <button
          type="button"
          className="despachar-page__print-btn"
          onClick={() => handlePrintPos(p)}
          title="Ticket POS 80mm"
          aria-label="Imprimir ticket 80mm"
        >
          <span className="despachar-page__print-icon" aria-hidden="true">🧾</span>
        </button>
        <button
          type="button"
          className="despachar-page__print-btn"
          onClick={() => handlePrintCarta(p)}
          title="Imprimir carta (con firmas)"
          aria-label="Imprimir formato carta"
        >
          <span className="despachar-page__print-icon" aria-hidden="true">📄</span>
        </button>
      </div>
      {canDispatch && (
        <Button size="sm" onClick={() => handleOpen(p.id_pedido)}>
          Despachar
        </Button>
      )}
    </div>
  );

  const columns = useMemo(() => [
    {
      key: 'id_pedido',
      label: '#',
      width: 60,
      primary: true,
      render: (p) => <code>#{p.id_pedido}</code>,
    },
    {
      key: 'creado_en',
      label: 'Fecha',
      width: 110,
      render: (p) => <span className="despachar-page__date">{formatDate(p.creado_en)}</span>,
    },
    {
      key: 'requester_name',
      label: 'Solicitante',
      width: 170,
      render: (p) => (
        <div className="despachar-page__solicitante-cell">
          <span className="despachar-page__truncate" title={p.requester_name || ''}>
            {p.requester_name || '—'}
          </span>
          {p.observaciones && (
            <span className="despachar-page__obs-preview" title={p.observaciones}>
              {p.observaciones}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'requester_warehouse',
      label: 'Su bodega',
      width: 130,
      render: (p) => (
        <span className="despachar-page__truncate" title={p.requester_warehouse || ''}>
          {p.requester_warehouse || '—'}
        </span>
      ),
    },
    {
      key: 'estado',
      label: 'Estado',
      width: 100,
      render: (p) => {
        const est = ESTADO_LABELS[p.estado] || { label: p.estado, variant: 'default' };
        return <Badge variant={est.variant}>{est.label}</Badge>;
      },
      cardMeta: (p) => {
        const est = ESTADO_LABELS[p.estado] || { label: p.estado, variant: 'default' };
        return <Badge variant={est.variant}>{est.label}</Badge>;
      },
    },
    {
      key: '__actions',
      label: '',
      width: 170,
      align: 'right',
      hideOnMobile: true,
      render: (p) => renderActions(p),
    },
  ], []);

  return (
    <>
      <Header
        title="Pedidos por despachar"
        subtitle={`${visibles.length} pedido${visibles.length === 1 ? '' : 's'} pendiente${visibles.length === 1 ? '' : 's'}${lastUpdate ? ' • actualizado' : ''}`}
        actions={
          <div className="despachar-page__header-actions">
            {visibles.length > 0 && (
              <>
                <Button variant="ghost" size="sm" onClick={() => printOrderListPos80mm(visibles)}>
                  🖨 Imprimir
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowColumnSelector(true)}>
                  Exportar CSV
                </Button>
              </>
            )}
            {lastUpdate && (
              <span className="despachar-page__last-update" title={lastUpdate.toLocaleString()}>
                {lastUpdate.toLocaleTimeString()}
              </span>
            )}
            <Button variant="ghost" size="sm" onClick={safeLoadPedidos} disabled={loadingRef.current}>
              {loadingRef.current ? 'Cargando…' : 'Refrescar'}
            </Button>
          </div>
        }
      />

      <div className="despachar-page">
        {/* Barra de filtros */}
        <Card compact>
          <div className="despachar-page__filters">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Buscar por #, solicitante, bodega…"
            />
            <div className="despachar-page__status-chips">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={`des-opt-${opt.value}`}
                  type="button"
                  className={`despachar-page__chip ${statusFilter === opt.value ? 'despachar-page__chip--active' : ''} ${opt.variant ? `despachar-page__chip--${opt.variant}` : ''}`}
                  onClick={() => setStatusFilter(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </Card>

        <DataList
          columns={columns}
          rows={visibles}
          loading={loading}
          keyField="id_pedido"
          emptyTitle={search || statusFilter ? 'Sin resultados' : 'Sin pedidos por despachar'}
          emptyMessage={search || statusFilter ? 'Intenta con otros filtros.' : 'Cuando recibas pedidos de otras bodegas aparecerán aquí.'}
          emptyIcon="⇢"
          cardActions={isMobile ? renderActions : null}
        />

        <Card
          title="¿Cómo funciona?"
          subtitle="Surte los pedidos que otras bodegas te hacen"
        >
          <ol className="despachar-page__steps">
            <li>Solo ves los pedidos <strong>dirigidos a tu bodega</strong> con estado pendiente o parcial.</li>
            <li>Click <strong>Despachar</strong> en cualquier pedido.</li>
            <li>Edita las <strong>cantidades a surtir</strong> por línea (puedes surtir menos o anular).</li>
            <li>Si anulas algo, debes escribir una <strong>justificación</strong>.</li>
            <li>Al confirmar, se descuenta el stock de tu bodega y se crea el movimiento correspondiente.</li>
          </ol>
        </Card>
      </div>

      <ColumnSelectorModal
        open={showColumnSelector}
        onClose={() => setShowColumnSelector(false)}
        columns={[
          { key: 'id_pedido', label: '#' },
          { key: 'creado_en', label: 'Fecha' },
          { key: 'requester_name', label: 'Solicitante' },
          { key: 'requester_warehouse', label: 'Su bodega' },
          { key: 'total_lineas', label: 'Líneas' },
          { key: 'estado', label: 'Estado' },
          { key: 'observaciones', label: 'Observaciones' },
        ]}
        storageKey="export-columns-despachos"
        onConfirm={(cols, format) => {
          const fn = { csv: downloadCSV, xlsx: downloadXLSX, pdf: downloadPDF }[format] || downloadCSV;
          fn(visibles, {
            filename: `despachos_${new Date().toISOString().slice(0, 10)}`,
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
        onClose={handleClose}
        title={activeId ? `Despachar pedido #${activeId}` : 'Despachar'}
        size="xl"
      >
        {loadingDetails ? (
          <div className="despachar-page__loading">
            <Spinner size={20} label="Cargando líneas…" />
          </div>
        ) : (
          <div className="despachar-page__modal-body">
            <DespachoForm
              pedido={activeDetails}
              submitting={submitting}
              onSubmittingChange={setSubmitting}
              onDone={handleDone}
              onCancel={handleClose}
            />
            {activeDetails && (
              <RevertPanel
                pedido={activeDetails}
                onDone={handleDone}
              />
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
