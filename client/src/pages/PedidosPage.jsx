import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { SearchInput } from '@/components/ui/SearchInput';
import { DataList } from '@/components/ui/DataList';
import { KeyboardKey } from '@/components/ui/KeyboardKey';
import { Select } from '@/components/ui/Select';
import { Shortcuts } from '@/hooks/useShortcut.jsx';
import { useShortcutsStore } from '@/stores/shortcuts.store';
import { useDebounce } from '@/hooks/useDebounce';
import { useStockScope } from '@/hooks/useStockScope';
import { toast } from '@/components/ui/Toast';
import { useAuthStore } from '@/stores/auth.store';
import { hasPermission } from '@/utils/permissions';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { ColumnSelectorModal } from '@/components/ui/ColumnSelectorModal';
import { downloadCSV, downloadXLSX, downloadPDF } from '@/utils/export';
import { formatDate } from '@/utils/format';
import { catalogosService } from '@/services/catalogos.service';
import { pedidosService } from '@/services/pedidos.service';
import { printPedidoPos80mm } from '@/utils/print';
import { PedidoForm } from '@/components/pedidos/PedidoForm';
import { getSocket } from '@/services/socket';
import { ConfirmarRecepcionModal } from '@/components/pedidos/ConfirmarRecepcionModal';
import './PedidosPage.scss';

// Vistas disponibles en "Realizar pedidos".
//   - mine    : pedidos que YO creé (default, también para bodegueros).
//   - dispatch: pedidos que MI BODEGA despachó (útil para que el bodeguero
//               vea lo que salió de su bodega sin entrar a "Despachar").
//   - all     : todas las bodegas. Solo visible para admin/reportes; el
//               backend devuelve 403 si un bodeguero intenta usarla.
const VIEW_OPTIONS_BASE = [
  { value: 'mine', label: 'Mis pedidos' },
  { value: 'dispatch', label: 'Despachados por mi bodega' },
];
const VIEW_OPTION_ALL = { value: 'all', label: 'Todas las bodegas' };

const ESTADO_LABELS = {
  PENDIENTE: { label: 'Pendiente', variant: 'warning' },
  APROBADO: { label: 'Aprobado', variant: 'info' },
  PARCIAL: { label: 'Parcial', variant: 'info' },
  COMPLETADO: { label: 'Completado', variant: 'success' },
  COMPLETADO_JUSTIFICADO: { label: 'Completado (justificado)', variant: 'success' },
  CANCELADO: { label: 'Cancelado', variant: 'danger' },
};

// Un pedido puede confirmarse cuando la bodega surtidora lo exige,
// ya se despacho por completo y aun no se confirma la recepcion.
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

export default function PedidosPage() {
  const user = useAuthStore((s) => s.user);
  const permisos = user?.permisos || {};
  const canCreate = hasPermission(permisos, 'action.create_update');
  const isMobile = !useMediaQuery('(min-width: 768px)');

  // Scope de bodegas del usuario (admin/reportes → canAllBodegas=true).
  // Se usa para decidir si mostrar la vista "Todas las bodegas" y el
  // selector de bodega, y para alimentar ese selector con las bodegas
  // permitidas (respeta hasWarehouseRestrictions del rol REPORTE).
  const { scope: stockScope, bodegas: scopeBodegas, loading: loadingScope } = useStockScope();
  const canAllBodegas = Boolean(stockScope?.can_all_bodegas);
  const userBodegaId = Number(user?.id_warehouse || 0);

  // Vista activa. 'mine' es la default y se aplica a todos los roles;
  // 'all' se suma a la lista solo si el usuario es admin o tiene rol
  // con acceso a múltiples bodegas. 'dispatch' está disponible para
  // todos y siempre filtra por la bodega del usuario.
  const [view, setView] = useState('mine');
  // Filtro de bodega solicitante. Solo se aplica a las vistas donde
  // tiene sentido acotar (todas); para 'mine' y 'dispatch' la bodega
  // ya está implícita en el filtro del backend.
  const [filterBodegaId, setFilterBodegaId] = useState('');

  const viewOptions = useMemo(() => {
    const opts = [...VIEW_OPTIONS_BASE];
    if (canAllBodegas) opts.push(VIEW_OPTION_ALL);
    return opts;
  }, [canAllBodegas]);

  const [modalOpen, setModalOpen] = useState(false);
  const [createdPedido, setCreatedPedido] = useState(null);
  const [confirmPedido, setConfirmPedido] = useState(null);

  const [bodegas, setBodegas] = useState([]);
  const [catalogError, setCatalogError] = useState(null);
  const [loadingCatalogs, setLoadingCatalogs] = useState(true);

  const [pedidos, setPedidos] = useState([]);
  const [loadingPedidos, setLoadingPedidos] = useState(true);
  const [search, setSearch] = useState('');
  const [showColumnSelector, setShowColumnSelector] = useState(false);
  const debouncedSearch = useDebounce(search, 250);
  const fetchIdRef = useRef(0);

  const todayStr = new Date().toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(todayStr);
  const [dateTo, setDateTo] = useState(todayStr);

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

  // loadPedidos: usa refetch ID para evitar race conditions
  const loadPedidos = useCallback(async () => {
    setLoadingPedidos(true);
    const fetchId = ++fetchIdRef.current;
    try {
      const params = { from: dateFrom, to: dateTo, limit: 500 };
      // Mapear la vista UI → scope del backend. El filtro ?warehouse se
      // manda solo cuando hay una bodega explícita seleccionada (vista
      // 'all' con un dropdown aplicado); en el resto el backend ya filtra
      // por el usuario o por la bodega del usuario según corresponda.
      params.scope = view;
      if (view === 'all' && filterBodegaId) {
        params.warehouse = Number(filterBodegaId);
      }
      const data = await pedidosService.list(params);
      if (fetchId !== fetchIdRef.current) return; // descartamos respuesta de fetch anterior
      setPedidos(Array.isArray(data) ? data : []);
    } catch (e) {
      if (fetchId === fetchIdRef.current) {
        toast.error(e?.response?.data?.error || 'No se pudieron cargar los pedidos');
      }
    } finally {
      if (fetchId === fetchIdRef.current) setLoadingPedidos(false);
    }
  }, [dateFrom, dateTo, view, filterBodegaId]);

  useEffect(() => {
    loadCatalogs();
    loadPedidos();
  }, [loadCatalogs, loadPedidos]);

  // Defensivo: si la vista actual desaparece de las opciones (p.ej. el
  // usuario perdió el permiso can_all_bodegas entre montajes), caemos a
  // 'mine' para no dejar un valor que el Select no pueda representar.
  useEffect(() => {
    if (!loadingScope && viewOptions.length > 0) {
      const allowed = viewOptions.some((o) => o.value === view);
      if (!allowed) {
        setView('mine');
        setFilterBodegaId('');
      }
    }
  }, [loadingScope, viewOptions, view]);

  useEffect(() => {
    let socket;
    try {
      socket = getSocket();
    } catch { return; }

    const onPedidosChanged = () => {
      loadPedidos();
    };
    socket.on('pedido:changed', onPedidosChanged);
    socket.on('stock:changed', onPedidosChanged);

    return () => {
      socket.off('pedido:changed', onPedidosChanged);
      socket.off('stock:changed', onPedidosChanged);
    };
  }, [loadPedidos]);

  const handleCreated = async (data) => {
    setModalOpen(false);
    // Obtener detalles para poder imprimir
    if (data?.id_pedido || data?.id_order) {
      try {
        const id = data.id_pedido || data.id_order;
        const detalles = await pedidosService.getDetails(id);
        // Prepend optimístico:插入 nuevo pedido al inicio de la lista sin reload completo
        setPedidos((prev) => {
          const exists = prev.some((p) => Number(p.id_pedido) === Number(detalles.id_pedido || id));
          if (exists) return prev;
          return [{ ...detalles, id_pedido: detalles.id_pedido || id }, ...prev];
        });
        setCreatedPedido(detalles);
      } catch (e) {
        toast.error('No se pudieron cargar los detalles del pedido para imprimir');
        // Fallback: reload completo
        loadPedidos();
      }
    } else {
      loadPedidos();
    }
  };

  const handlePrintPedido = () => {
    if (createdPedido) {
      printPedidoPos80mm(createdPedido, { autoPrint: true });
      setCreatedPedido(null);
    }
  };

  const handleDismissCreated = () => {
    setCreatedPedido(null);
  };

  const handleImprimirPedido = async (pedido) => {
    try {
      const detalles = await pedidosService.getDetails(pedido.id_pedido);
      printPedidoPos80mm(detalles, { autoPrint: true });
    } catch (e) {
      toast.error('No se pudo cargar el pedido para imprimir');
    }
  };

  const handleOpenConfirm = async (pedido) => {
    try {
      const detalles = await pedidosService.getDetails(pedido.id_pedido);
      setConfirmPedido({ ...detalles, id_pedido: pedido.id_pedido });
    } catch (e) {
      toast.error(e?.response?.data?.error || 'No se pudo cargar el pedido');
    }
  };

  const handleConfirmed = (pedidoActualizado) => {
    setConfirmPedido(null);
    if (pedidoActualizado) {
      // Update optimista del pedido confirmado
      setPedidos((prev) =>
        prev.map((p) =>
          Number(p.id_pedido) === Number(pedidoActualizado.id_pedido)
            ? { ...p, ...pedidoActualizado }
            : p
        )
      );
    } else {
      loadPedidos();
    }
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

  // -------- Atajos globales de la pantalla de Pedidos --------
  const getCombo = useShortcutsStore((s) => s.getCombo);
  const newCombo = getCombo('pedidos.new');
  const refreshCombo = getCombo('pedidos.refresh');

  const handleNewShortcut = useCallback(() => {
    if (!canCreate) return;
    if (modalOpen) return;
    setModalOpen(true);
  }, [canCreate, modalOpen]);

  const handleRefreshShortcut = useCallback(() => {
    loadPedidos();
  }, [loadPedidos]);

  const pageShortcuts = (
    <Shortcuts
      map={{
        'pedidos.new': { handler: handleNewShortcut, page: ['/pedidos'] },
        'pedidos.refresh': { handler: handleRefreshShortcut, page: ['/pedidos'] },
      }}
    />
  );

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
        // En "Mis pedidos" es la bodega a la que le pido (destino del
        // stock); en "Despachados por mi bodega" / "Todas" es la bodega
        // que despacha.
        label: view === 'mine' ? 'Bodega destino' : 'Bodega que despacha',
        render: (p) => p.nombre_bodega_surtidor || '—',
      },
      {
        key: 'nombre_bodega_solicita',
        // En "Mis pedidos" es la bodega desde la que pedí (la mía);
        // en "Despachados" / "Todas" es la bodega que está pidiendo.
        label: view === 'mine' ? 'Tu bodega' : 'Bodega solicitante',
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
        key: 'acciones',
        label: 'Acciones',
        width: 170,
        sortable: false,
        render: (p) => (
          <span style={{ display: 'inline-flex', gap: '4px' }}>
            {needsConfirmation(p) && (
              <button
                type="button"
                className="btn btn--sm btn--primary"
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenConfirm(p);
                }}
                title="Ver lo despachado y confirmar con tu PIN"
                style={{ padding: '4px 8px', fontSize: '12px' }}
              >
                ✓ Confirmar
              </button>
            )}
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={(e) => {
                e.stopPropagation();
                handleImprimirPedido(p);
              }}
              title="Imprimir ticket"
              style={{ padding: '4px 8px', fontSize: '12px' }}
            >
              🖨 Imprimir
            </button>
          </span>
        ),
      },
    ],
    [view]
  );

  // Subtítulo dinámico según la vista activa. Refleja el conteo y la
  // bodega (cuando aplica) para que el usuario tenga claro qué está viendo.
  const headerSubtitle = useMemo(() => {
    const count = pedidos.length;
    const countLabel = `${count} pedido${count === 1 ? '' : 's'}`;
    if (view === 'mine') {
      return `${countLabel} creado${count === 1 ? '' : 's'} por ti`;
    }
    if (view === 'dispatch') {
      const bodegaName =
        scopeBodegas.find((b) => Number(b.id_bodega) === userBodegaId)?.nombre_bodega ||
        'tu bodega';
      return `${countLabel} despachado${count === 1 ? '' : 's'} por ${bodegaName}`;
    }
    // view === 'all'
    if (filterBodegaId) {
      const bodegaName = scopeBodegas.find((b) => Number(b.id_bodega) === Number(filterBodegaId))?.nombre_bodega;
      return bodegaName
        ? `${countLabel} de ${bodegaName}`
        : `${countLabel} en total`;
    }
    return `${countLabel} en total`;
  }, [pedidos.length, view, filterBodegaId, scopeBodegas, userBodegaId]);

  // Etiqueta del selector de bodega del filtro. Aparece solo cuando
  // estamos en "Todas las bodegas" (admin/reportes) y queremos acotar
  // a una bodega específica.
  const filterBodegaOptions = useMemo(() => {
    const opts = [{ value: '', label: 'Todas las bodegas' }];
    for (const b of scopeBodegas || []) {
      opts.push({ value: String(b.id_bodega), label: b.nombre_bodega });
    }
    return opts;
  }, [scopeBodegas]);

  return (
    <>
      {pageShortcuts}
      <Header
        title="Realizar pedidos"
        subtitle={headerSubtitle}
        autoHide
        actions={
          <div className="pedidos-page__actions">
            {!isMobile && pedidosSorted.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setShowColumnSelector(true)}>
                Exportar CSV
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={loadPedidos}
              title={refreshCombo ? `Refrescar (${refreshCombo})` : 'Refrescar'}
            >
              Refrescar
              {refreshCombo && <KeyboardKey combo={refreshCombo} />}
            </Button>
            {canCreate && (
              <Button
                size={isMobile ? 'sm' : 'md'}
                onClick={() => setModalOpen(true)}
                title={newCombo ? `Nuevo pedido (${newCombo})` : 'Nuevo pedido'}
              >
                + Nuevo pedido
                {newCombo && <KeyboardKey combo={newCombo} />}
              </Button>
            )}
          </div>
        }
      />

      <div className="pedidos-page">
        <Card
          title="¿Cómo funciona?"
          subtitle="Pides productos a otra bodega (PRINCIPAL o RECEPTORA)"
          collapsible={isMobile}
          defaultOpen={!isMobile}
        >
          <ol className="pedidos-page__steps">
            <li>Elige la <strong>bodega</strong> a la que pides (no la tuya).</li>
            <li>Captura tu <strong>PIN de pedidos</strong> (6-12 dígitos, lo configuraste antes).</li>
            <li>Agrega las <strong>líneas</strong> con producto y cantidad.</li>
            <li>Envía — el surtidor recibe la solicitud en su panel.</li>
            <li>El estado pasa de <em>Pendiente</em> a <em>Parcial</em>/<em>Completado</em> cuando surten.</li>
            <li>Si la bodega lo exige, al recibir revisas el <strong>detalle despachado</strong> y confirmas con tu <strong>PIN</strong> (botón <em>✓ Confirmar</em>).</li>
          </ol>
        </Card>

        <Card compact>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ minWidth: 200, flex: '0 0 auto' }}>
              <Select
                aria-label="Vista de pedidos"
                value={view}
                onChange={(e) => {
                  setView(e.target.value);
                  // Al cambiar de vista limpiamos el filtro de bodega para
                  // no arrastrar uno que no tenga sentido en la nueva
                  // vista (p.ej. pasar de "Todas +X" a "Mis pedidos").
                  setFilterBodegaId('');
                }}
                options={viewOptions}
                disabled={loadingScope && viewOptions.length <= 1}
                title="Qué pedidos quieres ver"
              />
            </div>
            {view === 'all' && canAllBodegas && (
              <div style={{ minWidth: 200, flex: '0 0 auto' }}>
                <Select
                  aria-label="Filtrar por bodega"
                  value={filterBodegaId}
                  onChange={(e) => setFilterBodegaId(e.target.value)}
                  options={filterBodegaOptions}
                  disabled={loadingScope}
                  title="Acotar la vista a una sola bodega"
                />
              </div>
            )}
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Buscar por #, bodega, estado…"
            />
            <div className="pedidos-page__date-group">
              <input
                type="date"
                className="input"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  if (e.target.value > dateTo) setDateTo(e.target.value);
                }}
                max={dateTo || undefined}
                title="Desde"
              />
              <span className="pedidos-page__sep">→</span>
              <input
                type="date"
                className="input"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  if (e.target.value < dateFrom) setDateFrom(e.target.value);
                }}
                min={dateFrom || undefined}
                title="Hasta"
              />
              <button
                type="button"
                className="pedidos-page__today-btn"
                onClick={() => { setDateFrom(todayStr); setDateTo(todayStr); }}
                title="Hoy"
              >
                Hoy
              </button>
            </div>
          </div>
        </Card>

        <DataList
          columns={columns}
          rows={pedidosSorted}
          loading={loadingPedidos}
          keyField="id_pedido"
          emptyTitle={search ? 'Sin resultados' : 'Sin pedidos'}
          emptyMessage={
            search
              ? 'Intenta con otros términos.'
              : view === 'dispatch'
                ? 'Tu bodega aún no ha despachado pedidos en este rango.'
                : view === 'all'
                  ? (filterBodegaId
                      ? 'No hay pedidos para la bodega seleccionada en este rango.'
                      : 'No hay pedidos en este rango.')
                  : 'Cuando crees un pedido aparecerá aquí.'
          }
          emptyAction={!search && view === 'mine' && canCreate ? <Button onClick={() => setModalOpen(true)}>Crear primer pedido</Button> : null}
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

      <PedidoForm
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        user={user}
        bodegas={bodegas}
        loadingCatalogs={loadingCatalogs}
        catalogError={catalogError}
        onRetryCatalog={loadCatalogs}
        onCreated={handleCreated}
      />

      {/* Modal de éxito con opción de imprimir */}
      <Modal
        open={!!createdPedido}
        onClose={handleDismissCreated}
        title="✅ Pedido creado"
        size="sm"
      >
        <div style={{ textAlign: 'center', padding: '1rem 0' }}>
          <p style={{ marginBottom: '1.5rem', fontSize: '1rem' }}>
            El pedido <strong>#{createdPedido?.id_pedido}</strong> se creó exitosamente.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Button variant="primary" onClick={handlePrintPedido}>
              🖨 Imprimir ticket (80mm)
            </Button>
            <Button variant="ghost" onClick={handleDismissCreated}>
              Cerrar
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal de confirmación de recepción con PIN */}
      <ConfirmarRecepcionModal
        open={!!confirmPedido}
        pedido={confirmPedido}
        onClose={() => setConfirmPedido(null)}
        onConfirmed={handleConfirmed}
      />
    </>
  );
}
