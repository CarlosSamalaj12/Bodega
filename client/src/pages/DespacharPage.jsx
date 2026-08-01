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
import { ConfirmarRecepcionModal } from '@/components/pedidos/ConfirmarRecepcionModal';
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

// Pedido despachado por completo, de una bodega que exige PIN de recepcion,
// y aun sin confirmar.
function needsConfirmation(p) {
  return (
    Number(p?.confirmacion_requerida) === 1 &&
    !p?.confirmado_en &&
    ['COMPLETADO', 'COMPLETADO_JUSTIFICADO'].includes(String(p?.estado || '').toUpperCase())
  );
}

function isReceiptConfirmed(p) {
  return Number(p?.confirmacion_requerida) === 1 && Boolean(p?.confirmado_en);
}

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
  const [confirmPedido, setConfirmPedido] = useState(null);
  const debouncedSearch = useDebounce(search, 250);
  const [searchParams, setSearchParams] = useSearchParams();
  const loadingRef = useRef(false);

  // Fecha local (evita el corrimiento UTC: con toISOString, de noche en
  // zonas UTC-x el "hoy" caería en el día siguiente y no se verían pedidos).
  const todayStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  // Por defecto se muestran solo los pedidos de la fecha actual.
  // El usuario puede ampliar el rango o vaciarlo (botón ✕ Todos) para ver
  // todos los pendientes sin importar cuándo se crearon.
  const [dateFrom, setDateFrom] = useState(todayStr);
  const [dateTo, setDateTo] = useState(todayStr);

  const loadPedidos = useCallback(async () => {
    setLoading(true);
    try {
      const params = { scope: 'dispatch', limit: 500 };
      if (dateFrom) params.from = dateFrom;
      if (dateTo) params.to = dateTo;
      const data = await pedidosService.list(params);
      setPedidos(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error(e?.response?.data?.error || 'No se pudieron cargar los pedidos');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

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

  // Ref para acceder a `visibles` desde el socket handler sin problemas
  // de orden de declaración ni de stale closure. El handler del socket
  // se suscribe una sola vez al montar, y esta ref siempre apunta al
  // valor actual de `visibles`.
  const visiblesRef = useRef([]);
  // Lo actualizamos en cada render (después del useMemo de visibles).
  // Verifico que se setee más abajo; por ahora declaro solo el ref.

  // Socket.IO: Actualización en tiempo real.
  // IMPORTANTE: NO recargamos la lista completa en cada evento. Eso causaba
  // esperas de ~40s porque el listado pesa aunque el query esté optimizado
  // (cada refresco fuerza re-render + re-cálculo de stocks). En lugar de eso:
  //   - Si el pedido cambió a un estado "abierto" (PENDIENTE/PARCIAL/APROBADO)
  //     y NO está visible en la lista, lo agregamos optimistamente.
  //   - Si cambió a un estado "cerrado" (COMPLETADO/CANCELADO) y está visible,
  //     lo removemos optimistamente.
  //   - Solo si el usuario hace clic en "Refrescar" o después del propio
  //     despacho (handleDone) se recarga la lista completa.
  useEffect(() => {
    const socket = getSocket();

    const handler = (payload) => {
      const idPedido = Number(payload?.id_pedido || 0);
      const status = String(payload?.status || '').toUpperCase();
      if (!idPedido || !status) return;

      setLastUpdate(new Date());

      const visibleIds = new Set((visiblesRef.current || []).map((p) => Number(p.id_pedido)));
      const isVisible = visibleIds.has(idPedido);
      const isOpenState = ['PENDIENTE', 'APROBADO', 'PARCIAL'].includes(status);
      const isClosedState = ['COMPLETADO', 'COMPLETADO_JUSTIFICADO', 'CANCELADO'].includes(status);

      if (isOpenState && !isVisible) {
        // Hay un pedido nuevo/abierto que no estaba visible → refrescar para traerlo
        safeLoadPedidos();
      } else if (isClosedState && isVisible) {
        // El pedido se cerró/canceló → removerlo de la lista local sin recargar
        setPedidos((prev) => prev.filter((p) => Number(p.id_pedido) !== idPedido));
        toast.info(`Pedido #${idPedido} ${status === 'CANCELADO' ? 'cancelado' : 'completado'}`);
      } else if (isOpenState && isVisible) {
        // Sigue abierto pero cambió (ej. PARCIAL → PENDIENTE). Actualizar local
        setPedidos((prev) =>
          prev.map((p) =>
            Number(p.id_pedido) === idPedido ? { ...p, estado: status } : p
          )
        );
      }

      // Si el modal abierto es este pedido y se cerró, cerrarlo
      if (activeId === idPedido && isClosedState) {
        handleClose();
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

  const handleDone = async () => {
    const id = activeId;
    handleClose();
    if (!id) return;

    // Actualización optimista LOCAL: marcamos el pedido como "completado" o
    // "parcial" según lo que el backend nos indique. Si quedó completado,
    // lo removemos de la lista para limpiar la vista. Esto evita el
    // loadPedidos() completo que tardaba ~40s.
    try {
      const det = await pedidosService.getDetails(id);
      const newStatus = String(det?.estado || '').toUpperCase();
      const isClosed = ['COMPLETADO', 'COMPLETADO_JUSTIFICADO', 'CANCELADO'].includes(newStatus);
      if (isClosed) {
        setPedidos((prev) => prev.filter((p) => Number(p.id_pedido) !== id));
      } else {
        setPedidos((prev) =>
          prev.map((p) =>
            Number(p.id_pedido) === id ? { ...p, estado: newStatus, ...(det?.total_lineas ? { total_lineas: det.total_lineas } : {}) } : p
          )
        );
      }
      // Si la bodega exige confirmación, ofrecerla de inmediato.
      if (needsConfirmation(det)) {
        setConfirmPedido({ ...det, id_pedido: id });
      }
    } catch {
      // Si falla la carga optimista, fallback: recargar la lista completa.
      // (Mejor mostrar datos viejos que quedarse colgado)
      safeLoadPedidos();
    }
  };

  const handleOpenConfirm = async (p) => {
    try {
      const det = await pedidosService.getDetails(p.id_pedido);
      setConfirmPedido({ ...det, id_pedido: p.id_pedido });
    } catch (e) {
      toast.error(e?.response?.data?.error || 'No se pudo cargar el pedido');
    }
  };

  const handleConfirmed = () => {
    setConfirmPedido(null);
    safeLoadPedidos();
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

  // Sincronizar el ref con el valor actual de `visibles` para que el
  // handler del socket (suscrito una sola vez al montar) siempre vea
  // el valor más reciente sin re-suscribirse.
  useEffect(() => {
    visiblesRef.current = visibles;
  }, [visibles]);

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
      {needsConfirmation(p) && (
        <Button size="sm" variant="primary" onClick={() => handleOpenConfirm(p)} title="El solicitante confirma la recepción con su PIN">
          ✓ Confirmar recepción
        </Button>
      )}
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
      key: 'mi_stock',
      label: 'Mi stock',
      width: 95,
      align: 'right',
      hideOnMobile: true,
      render: (p) => {
        const mi = Number(p.mi_stock_total || 0);
        const pend = Number(p.cantidad_pendiente_total || 0);
        const alcanza = mi >= pend && pend > 0;
        const sinSuficiente = mi < pend && pend > 0;
        return (
          <div className="despachar-page__stock-cell">
            <span
              className={
                sinSuficiente
                  ? 'despachar-page__stock despachar-page__stock--warn'
                  : alcanza
                  ? 'despachar-page__stock despachar-page__stock--ok'
                  : 'despachar-page__stock'
              }
              title={
                sinSuficiente
                  ? `Stock en tu bodega: ${mi} — necesitas ${pend} para surtir. Te faltan ${pend - mi}.`
                  : alcanza
                  ? `Stock en tu bodega: ${mi} — alcanzaría para surtir todo.`
                  : `Stock en tu bodega: ${mi}`
              }
            >
              {mi.toFixed(2)}
            </span>
            {sinSuficiente && (
              <span className="despachar-page__stock-hint" title="Faltan unidades en tu bodega para surtir todo">
                faltan {(pend - mi).toFixed(2)}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'su_stock',
      label: 'Su stock',
      width: 95,
      align: 'right',
      hideOnMobile: true,
      render: (p) => {
        const su = Number(p.su_stock_total || 0);
        return (
          <div className="despachar-page__stock-cell">
            <span
              className="despachar-page__stock despachar-page__stock--info"
              title={`Stock en la bodega del solicitante: ${su}. Útil para saber cuánto ya tiene antes de despachar.`}
            >
              {su.toFixed(2)}
            </span>
          </div>
        );
      },
    },
    {
      key: 'estado',
      label: 'Estado',
      width: 100,
      render: (p) => {
        const est = ESTADO_LABELS[p.estado] || { label: p.estado, variant: 'default' };
        return (
          <span style={{ display: 'inline-flex', gap: '4px', flexWrap: 'wrap' }}>
            <Badge variant={est.variant}>{est.label}</Badge>
            {isReceiptConfirmed(p) && <Badge variant="success">✓ Recibido</Badge>}
            {needsConfirmation(p) && <Badge variant="warning">Por confirmar</Badge>}
          </span>
        );
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
            <div className="despachar-page__date-group">
              <input
                type="date"
                className="input"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  if (e.target.value && dateTo && e.target.value > dateTo) setDateTo(e.target.value);
                }}
                max={dateTo || undefined}
                placeholder="Desde"
                title="Desde (opcional — dejar vacío para ver todos)"
              />
              <span className="despachar-page__sep">→</span>
              <input
                type="date"
                className="input"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  if (e.target.value && dateFrom && e.target.value < dateFrom) setDateFrom(e.target.value);
                }}
                min={dateFrom || undefined}
                placeholder="Hasta"
                title="Hasta (opcional — dejar vacío para ver todos)"
              />
              <button
                type="button"
                className="despachar-page__today-btn"
                onClick={() => { setDateFrom(todayStr); setDateTo(todayStr); }}
                title="Filtrar solo por hoy"
              >
                Hoy
              </button>
              {(dateFrom || dateTo) && (
                <button
                  type="button"
                  className="despachar-page__today-btn despachar-page__today-btn--danger"
                  onClick={() => { setDateFrom(''); setDateTo(''); }}
                  title="Quitar filtro de fecha — ver todos los pendientes"
                >
                  ✕ Todos
                </button>
              )}
            </div>
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
            <li>Si tu bodega tiene <strong>PIN de recepción</strong> activo (se configura en Bodegas), el solicitante revisa el detalle y confirma con su PIN como fe de recibido.</li>
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
          { key: 'mi_stock', label: 'Mi stock' },
          { key: 'su_stock', label: 'Su stock' },
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
              onDetailsChange={setActiveDetails}
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

      {/* Confirmación de recepción con PIN del solicitante */}
      <ConfirmarRecepcionModal
        open={!!confirmPedido}
        pedido={confirmPedido}
        onClose={() => setConfirmPedido(null)}
        onConfirmed={handleConfirmed}
      />
    </>
  );
}
