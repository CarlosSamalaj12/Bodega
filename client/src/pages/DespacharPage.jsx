import { useCallback, useEffect, useMemo, useState } from 'react';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Badge } from '@/components/ui/Badge';
import { DataList } from '@/components/ui/DataList';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { toast } from '@/components/ui/Toast';
import { pedidosService } from '@/services/pedidos.service';
import { DespachoForm } from '@/components/despachos/DespachoForm';
import './DespacharPage.scss';

const ESTADO_LABELS = {
  PENDIENTE: { label: 'Pendiente', variant: 'warning' },
  PARCIAL: { label: 'Parcial', variant: 'info' },
  APROBADO: { label: 'Aprobado', variant: 'info' },
  COMPLETADO: { label: 'Completado', variant: 'success' },
  COMPLETADO_JUSTIFICADO: { label: 'Justificado', variant: 'success' },
  CANCELADO: { label: 'Cancelado', variant: 'danger' },
};

export function DespacharPage() {
  const isMobile = !useMediaQuery('(min-width: 768px)');

  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [activeDetails, setActiveDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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

  useEffect(() => {
    loadPedidos();
  }, [loadPedidos]);

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
    return pedidos.filter((p) => {
      const est = String(p.estado || '').toUpperCase();
      return ['PENDIENTE', 'APROBADO', 'PARCIAL'].includes(est);
    });
  }, [pedidos]);

  const renderActions = (p) => (
    <Button size="sm" onClick={() => handleOpen(p.id_pedido)}>
      Despachar
    </Button>
  );

  const columns = useMemo(() => [
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
      render: (p) => p.creado_en ? new Date(p.creado_en).toLocaleString() : '—',
    },
    {
      key: 'requester_name',
      label: 'Solicitante',
      render: (p) => p.requester_name || '—',
    },
    {
      key: 'requester_warehouse',
      label: 'Su bodega',
      render: (p) => p.requester_warehouse || '—',
    },
    {
      key: 'observaciones',
      label: 'Observaciones',
      hideOnMobile: true,
      render: (p) => p.observaciones ? (
        <span className="despachar-page__obs">{p.observaciones}</span>
      ) : '—',
    },
    {
      key: 'estado',
      label: 'Estado',
      width: 140,
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
      width: 130,
      align: 'right',
      hideOnMobile: true,
      render: () => null,
    },
  ], []);

  return (
    <>
      <Header
        title="Pedidos por despachar"
        subtitle={`${visibles.length} pedido${visibles.length === 1 ? '' : 's'} pendiente${visibles.length === 1 ? '' : 's'}`}
        actions={
          <Button variant="ghost" size="sm" onClick={loadPedidos}>
            Refrescar
          </Button>
        }
      />

      <div className="despachar-page">
        <DataList
          columns={columns}
          rows={visibles}
          loading={loading}
          keyField="id_pedido"
          emptyTitle="Sin pedidos por despachar"
          emptyMessage="Cuando recibas pedidos de otras bodegas aparecerán aquí."
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
          <DespachoForm
            pedido={activeDetails}
            submitting={submitting}
            onSubmittingChange={setSubmitting}
            onDone={handleDone}
            onCancel={handleClose}
          />
        )}
      </Modal>
    </>
  );
}
