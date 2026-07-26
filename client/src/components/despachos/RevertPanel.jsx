import { useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { PinModal } from '@/components/ui/PinModal';
import { toast } from '@/components/ui/Toast';
import { pedidosService } from '@/services/pedidos.service';
import './RevertPanel.scss';

/**
 * RevertPanel — permite revertir despachos de un pedido (línea por línea o todo).
 * Solo funciona con movimientos del día de hoy y requiere PIN de supervisor.
 */
export function RevertPanel({ pedido, onDone }) {
  const [reverting, setReverting] = useState(null); // 'all' | id_pedido_detalle
  const [pinModalOpen, setPinModalOpen] = useState(false);
  // Guardamos la acción pendiente en una ref funcional usando useState porque
  // la necesitamos dentro del PinModal callback que se dispara asincrónicamente.
  const [pendingAction, setPendingAction] = useState(null);

  // Líneas que tienen cantidad surtida (despachada) y se pueden revertir
  const revertibleLines = useMemo(() => {
    if (!pedido?.lines) return [];
    return pedido.lines.filter((l) => Number(l.cantidad_surtida || 0) > 0);
  }, [pedido]);

  const hasRevertibles = revertibleLines.length > 0;
  const totalSurtido = useMemo(
    () => revertibleLines.reduce((a, l) => a + Number(l.cantidad_surtida || 0), 0),
    [revertibleLines]
  );

  /**
   * Ejecuta la reversa con el PIN proporcionado.
   * Se pasa action directamente para evitar problemas de stale closure.
   */
  const executeRevert = async (action, supervisorPin) => {
    if (!action) return;

    setPinModalOpen(false);
    setPendingAction(null);

    let payload = { supervisor_pin: supervisorPin };
    if (action.type === 'line') {
      payload.id_pedido_detalle = action.id_pedido_detalle;
    }

    setReverting(action.type === 'all' ? 'all' : action.id_pedido_detalle);
    try {
      if (action.type === 'all') {
        await pedidosService.revert(pedido.id_pedido, payload);
        toast.success('Despacho revertido completamente');
      } else {
        await pedidosService.revertLine(pedido.id_pedido, payload);
        toast.success('Línea revertida');
      }
      onDone?.();
    } catch (e) {
      const errData = e?.response?.data || {};
      const errMsg = errData.error || 'No se pudo revertir';
      toast.error(errMsg);
    } finally {
      setReverting(null);
    }
  };

  /**
   * Abre el modal de PIN y guarda la acción para ejecutarla con el PIN.
   */
  const requestPinAndRevert = (action) => {
    setPendingAction(action);
    setPinModalOpen(true);
  };

  const handlePinConfirm = (pin) => {
    // pendingAction se setea antes de abrir el modal, así que está actualizado
    executeRevert(pendingAction, pin);
  };

  const handlePinCancel = () => {
    setPinModalOpen(false);
    setPendingAction(null);
    setReverting(null);
  };

  if (!hasRevertibles) return null;

  return (
    <div className="revert-panel">
      <div className="revert-panel__header">
        <div>
          <div className="revert-panel__title">Despachos realizados</div>
          <div className="revert-panel__sub">
            {revertibleLines.length} línea{revertibleLines.length !== 1 ? 's' : ''} · {totalSurtido} unidad{totalSurtido !== 1 ? 'es' : ''} surtida{totalSurtido !== 1 ? 's' : ''}
          </div>
        </div>
        <Button
          size="sm"
          variant="danger"
          onClick={() => requestPinAndRevert({ type: 'all' })}
          disabled={reverting !== null}
        >
          {reverting === 'all' ? <Spinner size={14} /> : 'Revertir todo'}
        </Button>
      </div>

      <div className="revert-panel__lines">
        {revertibleLines.map((l) => {
          const isReverting = reverting === l.id_pedido_detalle;
          return (
            <div key={l.id_pedido_detalle} className="revert-panel__line">
              <div className="revert-panel__line-info">
                <span className="revert-panel__line-name">{l.nombre_producto}</span>
                <Badge variant="success">{l.cantidad_surtida} u.</Badge>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => requestPinAndRevert({ type: 'line', id_pedido_detalle: l.id_pedido_detalle })}
                disabled={reverting !== null}
              >
                {isReverting ? <Spinner size={14} /> : 'Revertir'}
              </Button>
            </div>
          );
        })}
      </div>

      <PinModal
        open={pinModalOpen}
        title="PIN de supervisor requerido"
        description="Para revertir un despacho necesitas el PIN de un supervisor autorizado."
        submitting={reverting !== null}
        onConfirm={handlePinConfirm}
        onCancel={handlePinCancel}
      />
    </div>
  );
}

RevertPanel.propTypes = {
  pedido: PropTypes.object,
  onDone: PropTypes.func,
};
