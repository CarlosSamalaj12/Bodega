import { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/Toast';
import { pedidosService } from '@/services/pedidos.service';
import { Check, X, AlertTriangle, CheckCircle2 } from 'lucide-react';
import './ConfirmarRecepcionModal.scss';

function lineaEstado(l) {
  const estado = String(l.estado_linea || 'PENDIENTE').toUpperCase();
  if (estado === 'ANULADO') return { icon: <X size={12} strokeWidth={2} />, label: 'Anulada', cls: 'void' };
  const surtida = Number(l.cantidad_surtida || 0);
  const solicitada = Number(l.cantidad_solicitada || 0);
  if (surtida >= solicitada && solicitada > 0) return { icon: <Check size={12} strokeWidth={2} />, label: 'Completa', cls: 'ok' };
  if (surtida > 0) return { icon: <AlertTriangle size={12} strokeWidth={2} />, label: 'Parcial', cls: 'warn' };
  return { icon: <AlertTriangle size={12} strokeWidth={2} />, label: 'Sin entrega', cls: 'warn' };
}

/**
 * ConfirmarRecepcionModal — preview del pedido despachado + PIN del solicitante
 * para dar fe de haber recibido el producto.
 */
export function ConfirmarRecepcionModal({ open, pedido, onClose, onConfirmed }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setPin('');
      setError('');
      setSubmitting(false);
    }
  }, [open]);

  const totales = useMemo(() => {
    const lines = pedido?.lines || [];
    let solicitada = 0;
    let surtida = 0;
    let diferencias = 0;
    for (const l of lines) {
      solicitada += Number(l.cantidad_solicitada || 0);
      surtida += Number(l.cantidad_surtida || 0);
      const est = lineaEstado(l);
      if (est.cls !== 'ok') diferencias += 1;
    }
    return { solicitada, surtida, diferencias, lineas: lines.length };
  }, [pedido]);

  if (!open || !pedido) return null;

  const handleConfirm = async () => {
    const clean = pin.replace(/\D/g, '');
    if (clean.length < 6 || clean.length > 12) {
      setError('El PIN debe tener entre 6 y 12 dígitos.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await pedidosService.confirmReceipt(pedido.id_pedido, { pin: clean });
      toast.success(`Recepción del pedido #${pedido.id_pedido} confirmada`);
      // Pasar el pedido actualizado para update optimista
      onConfirmed?.({
        id_pedido: pedido.id_pedido,
        confirmado_en: new Date().toISOString(),
        confirmacion_requerida: 0,
      });
    } catch (e) {
      setError(e?.response?.data?.error || 'No se pudo confirmar la recepción');
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !submitting) handleConfirm();
  };

  return (
    <Modal
      open={open}
      onClose={() => !submitting && onClose?.()}
      title={`Confirmar recepción — Pedido #${pedido.id_pedido}`}
      icon={<CheckCircle2 size={20} strokeWidth={1.8} />}
      size="lg"
    >
      <div className="confirmar-recepcion" onKeyDown={handleKeyDown}>
        <div className="confirmar-recepcion__meta">
          <div className="confirmar-recepcion__meta-item">
            <span className="confirmar-recepcion__meta-label">Solicitante</span>
            <strong>{pedido.requester_name || '—'}</strong>
          </div>
          <div className="confirmar-recepcion__meta-item">
            <span className="confirmar-recepcion__meta-label">De</span>
            <strong>{pedido.from_warehouse || '—'}</strong>
          </div>
          <div className="confirmar-recepcion__meta-item">
            <span className="confirmar-recepcion__meta-label">Para</span>
            <strong>{pedido.requester_warehouse || '—'}</strong>
          </div>
        </div>

        <p className="confirmar-recepcion__hint">
          Revisa que estés recibiendo todo lo despachado. Si está correcto, ingresa tu
          <strong> PIN de pedidos</strong> para dar fe de recibido.
        </p>

        <div className="confirmar-recepcion__tableWrap">
          <table className="confirmar-recepcion__table">
            <thead>
              <tr>
                <th>Producto</th>
                <th className="confirmar-recepcion__num">Solicitado</th>
                <th className="confirmar-recepcion__num">Entregado</th>
                <th className="confirmar-recepcion__center">Estado</th>
              </tr>
            </thead>
            <tbody>
              {(pedido.lines || []).map((l) => {
                const est = lineaEstado(l);
                return (
                  <tr key={l.id_pedido_detalle}>
                    <td>{l.nombre_producto}</td>
                    <td className="confirmar-recepcion__num">{Number(l.cantidad_solicitada || 0)}</td>
                    <td className="confirmar-recepcion__num">
                      <strong>{Number(l.cantidad_surtida || 0)}</strong>
                    </td>
                    <td className="confirmar-recepcion__center">
                      <span className={`confirmar-recepcion__pill confirmar-recepcion__pill--${est.cls}`}>
                        {est.icon} {est.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="confirmar-recepcion__num">{totales.solicitada}</td>
                <td className="confirmar-recepcion__num"><strong>{totales.surtida}</strong></td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        {totales.diferencias > 0 && (
          <div className="confirmar-recepcion__warn" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <AlertTriangle size={15} strokeWidth={1.8} style={{ flexShrink: 0 }} />
            <span>
              Este pedido se completó con diferencias en {totales.diferencias} línea(s)
              {pedido.justificacion_despacho ? ` — Justificación: ${pedido.justificacion_despacho}` : ''}.
              Al confirmar aceptas lo entregado.
            </span>
          </div>
        )}

        <div className="confirmar-recepcion__pinBox">
          <Input
            label={`PIN de pedidos de ${pedido.requester_name || 'el solicitante'}`}
            type="text"
            style={{ WebkitTextSecurity: 'disc' }}
            autoComplete="new-password"
            inputMode="numeric"
            pattern="[0-9]*"
            value={pin}
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, ''));
              setError('');
            }}
            placeholder="6-12 dígitos"
            error={error || undefined}
            autoFocus
            disabled={submitting}
          />
        </div>

        <div className="confirmar-recepcion__footer">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={handleConfirm}
            disabled={submitting || pin.length < 6}
          >
            {submitting ? <Spinner size={14} /> : (
              <>
                <Check size={14} strokeWidth={1.8} />
                <span>Confirmar recepción</span>
              </>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

ConfirmarRecepcionModal.propTypes = {
  open: PropTypes.bool,
  pedido: PropTypes.object,
  onClose: PropTypes.func,
  onConfirmed: PropTypes.func,
};
