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
import { hasPermission } from '@/utils/permissions';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { ColumnSelectorModal } from '@/components/ui/ColumnSelectorModal';
import { downloadCSV, downloadXLSX, downloadPDF } from '@/utils/export';
import { formatDate } from '@/utils/format';
import { catalogosService } from '@/services/catalogos.service';
import { pedidosService } from '@/services/pedidos.service';
import { printPedidoPos80mm } from '@/utils/print';
import { PedidoForm } from '@/components/pedidos/PedidoForm';
import { ConfirmarRecepcionModal } from '@/components/pedidos/ConfirmarRecepcionModal';
import './PedidosPage.scss';

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

  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
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

  const handleCreated = async (data) => {
    setModalOpen(false);
    loadPedidos();
    // Obtener detalles para poder imprimir
    if (data?.id_pedido || data?.id_order) {
      try {
        const id = data.id_pedido || data.id_order;
        const detalles = await pedidosService.getDetails(id);
        // Los campos ya vienen del endpoint en el formato correcto
        setCreatedPedido(detalles);
      } catch (e) {
        toast.error('No se pudieron cargar los detalles del pedido para imprimir');
      }
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

  const handleConfirmed = () => {
    setConfirmPedido(null);
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
    []
  );

  return (
    <>
      <Header
        title="Realizar pedidos"
        subtitle={`${pedidos.length} pedido${pedidos.length === 1 ? '' : 's'} en total`}
        actions={
          <div className="pedidos-page__actions">
            {!isMobile && pedidosSorted.length > 0 && (
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
