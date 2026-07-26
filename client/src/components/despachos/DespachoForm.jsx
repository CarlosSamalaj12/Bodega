import { useCallback, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { LinesEditor } from '@/components/ui/LinesEditor';
import { Spinner } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/Toast';
import { pedidosService } from '@/services/pedidos.service';
import './DespachoForm.scss';

const STATUS_LABELS = {
  PENDIENTE: { label: 'Pendiente', variant: 'pending' },
  PARCIAL: { label: 'Parcial', variant: 'partial' },
  DESPACHADO: { label: 'Despachado', variant: 'done' },
  ANULADO: { label: 'Anulado', variant: 'void' },
};

export function DespachoForm({ pedido, submitting, onSubmittingChange, onDone, onCancel }) {
  const [lines, setLines] = useState([]);
  const [justificacion, setJustificacion] = useState('');
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    if (pedido?.lines) {
      setLines(
        pedido.lines.map((l) => ({
          id_pedido_detalle: l.id_pedido_detalle,
          id_producto: l.id_producto,
          nombre_producto: l.nombre_producto,
          solicitada: Number(l.cantidad_solicitada || 0),
          surtida_anterior: Number(l.cantidad_surtida || 0),
          pendiente: Number(l.pendiente || 0),
          stock: Number(l.stock || 0),
          estado: l.estado_linea,
          cantidad: Number(l.pendiente || 0),
          anulada: false,
        }))
      );
    }
  }, [pedido]);

  const totales = useMemo(() => {
    let surtir = 0;
    let anuladas = 0;
    for (const l of lines) {
      surtir += Number(l.cantidad) || 0;
      if (l.anulada) anuladas += Number(l.pendiente) || 0;
    }
    const pendienteTotal = lines.reduce((a, l) => a + (Number(l.pendiente) || 0), 0);
    const esParcial = surtir < pendienteTotal || anuladas > 0;
    return { surtir, anuladas, esParcial };
  }, [lines]);

  const canSubmit = !submitting && (totales.surtir > 0 || totales.anuladas > 0);

  const setLine = useCallback((idx, patch) =>
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l))),
  []);

  const setCantidad = useCallback((idx, value) => {
    const v = String(value).replace(/[^\d]/g, '');
    const num = v === '' ? 0 : Math.min(parseInt(v, 10) || 0, lines[idx].pendiente);
    setLine(idx, { cantidad: num });
  }, [lines, setLine]);

  const anularLinea = useCallback((idx) => {
    setLine(idx, { cantidad: 0, anulada: true });
  }, [setLine]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError(null);

    if (totales.esParcial && !justificacion.trim()) {
      setSubmitError('Si anulas o no surtirás todo, debes escribir una justificación.');
      return;
    }

    const linesAFulfill = lines.filter((l) => l.cantidad > 0 && !l.anulada);
    const linesAnuladas = lines.filter((l) => l.anulada);

    if (linesAFulfill.length === 0 && linesAnuladas.length === 0) {
      setSubmitError('Surtí al menos una línea o anula alguna para justificar.');
      return;
    }

    onSubmittingChange?.(true);
    try {
      // 1. Enviar las líneas a surtir
      if (linesAFulfill.length > 0) {
        await pedidosService.fulfill(pedido.id_pedido, {
          justificacion: justificacion.trim() || null,
          lines: linesAFulfill.map((l) => ({
            id_pedido_detalle: l.id_pedido_detalle,
            qty: l.cantidad,
          })),
        });
      }

      // 2. Anular las líneas marcadas como anuladas (una por una)
      const cancelErrors = [];
      for (const l of linesAnuladas) {
        try {
          await pedidosService.cancelLine(pedido.id_pedido, {
            id_pedido_detalle: l.id_pedido_detalle,
            justificacion: justificacion.trim() || 'Anulado manualmente',
          });
        } catch (err) {
          cancelErrors.push(`${l.nombre_producto}: ${err?.response?.data?.error || err.message}`);
        }
      }

      if (cancelErrors.length > 0) {
        toast.warn(
          `Despacho registrado, pero algunas líneas no se pudieron anular:\n${cancelErrors.join('\n')}`
        );
      } else {
        toast.success('Despacho registrado');
      }

      onDone?.();
    } catch (e) {
      setSubmitError(e?.response?.data?.error || 'No se pudo despachar');
    } finally {
      onSubmittingChange?.(false);
    }
  };

  if (!pedido) {
    return <div className="despacho-form__empty">Sin datos del pedido.</div>;
  }

  const columns = [
    {
      key: 'producto',
      label: 'Producto',
      primary: true,
      minWidth: 240,
      render: (l) => <div className="despacho-form__product">{l.nombre_producto}</div>,
    },
    {
      key: 'solicitada',
      label: 'Solicitada',
      width: 90,
      align: 'right',
      hideOnMobile: true,
      render: (l) => <span className="despacho-form__num">{l.solicitada}</span>,
    },
    {
      key: 'surtida_anterior',
      label: 'Ya surtida',
      width: 90,
      align: 'right',
      hideOnMobile: true,
      render: (l) => <span className="despacho-form__num">{l.surtida_anterior}</span>,
    },
    {
      key: 'stock',
      label: 'Stock',
      width: 90,
      align: 'right',
      hideOnMobile: true,
      render: (l) => (
        <span className={l.stock <= 0 ? 'despacho-form__num--warn' : 'despacho-form__num'}>
          {l.stock}
        </span>
      ),
    },
    {
      key: 'cantidad',
      label: 'A surtir',
      width: 110,
      align: 'right',
      mobileFullWidth: true,
      render: (l, idx) => {
        if (l.anulada) {
          return <span className="despacho-form__pill despacho-form__pill--void">Anulada</span>;
        }
        const overStock = l.cantidad > l.stock;
        return (
          <div className="despacho-form__cantidad-cell">
            <input
              type="number"
              className={`input despacho-form__input ${overStock ? 'despacho-form__input--warn' : ''}`}
              min="0"
              step="1"
              pattern="[0-9]*"
              max={l.pendiente}
              value={l.cantidad}
              onChange={(e) => setCantidad(idx, e.target.value)}
              disabled={l.pendiente === 0 || l.anulada}
            />
            {overStock && (
              <div className="despacho-form__warn">Sin stock suficiente</div>
            )}
          </div>
        );
      },
    },
    {
      key: 'estado',
      label: 'Estado',
      width: 100,
      render: (l) => {
        if (l.anulada) {
          return <span className="despacho-form__pill despacho-form__pill--void">Anulada</span>;
        }
        const cfg = STATUS_LABELS[l.estado] || { label: l.estado, variant: 'pending' };
        return <span className={`despacho-form__pill despacho-form__pill--${cfg.variant}`}>{cfg.label}</span>;
      },
    },
    {
      key: '__remove',
      label: '',
      width: 40,
      hideOnMobile: true,
      render: (l, idx) =>
        l.pendiente > 0 && !l.anulada ? (
          <button
            type="button"
            className="despacho-form__anular"
            onClick={() => anularLinea(idx)}
            title="Anular esta línea"
            aria-label="Anular línea"
          >
            ✕
          </button>
        ) : l.anulada ? (
          <button
            type="button"
            className="despacho-form__anular despacho-form__anular--undo"
            onClick={() => setLine(idx, { anulada: false, cantidad: Number(l.pendiente) || 0 })}
            title="Rehabilitar línea"
            aria-label="Rehabilitar línea"
          >
            ↺
          </button>
        ) : null,
    },
  ];

  return (
    <form className="despacho-form" onSubmit={handleSubmit}>
      {submitError && <div className="despacho-form__error">{submitError}</div>}

      <div className="despacho-form__header">
        <div>
          <div className="despacho-form__label">Pedido #{pedido.id_pedido}</div>
          <div className="despacho-form__sub">Solicitante: {pedido.requester_name || '—'}</div>
          <div className="despacho-form__sub">Bodega: {pedido.from_warehouse || '—'}</div>
          {pedido.justificacion_despacho && (
            <div className="despacho-form__sub despacho-form__justificacion-existente">
              Justificación anterior: {pedido.justificacion_despacho}
            </div>
          )}
        </div>
        <div className="despacho-form__totals">
          <div className="despacho-form__total-item">
            <span className="despacho-form__total-label">Pendiente:</span>
            <span className="despacho-form__total-value">{lines.reduce((a, l) => a + (Number(l.pendiente) || 0), 0)}</span>
          </div>
          <div className="despacho-form__total-item">
            <span className="despacho-form__total-label">A surtir:</span>
            <span className="despacho-form__total-value despacho-form__total-value--accent">{totales.surtir}</span>
          </div>
        </div>
      </div>

      <LinesEditor
        lines={lines}
        columns={columns}
        onRemove={() => {}}
        canRemove={() => false}
        keyField="id_pedido_detalle"
      />

      {/* En móvil, anulación rápida por línea */}
      <div className="despacho-form__anular-mobile">
        {lines.map((l, idx) =>
          l.pendiente > 0 && !l.anulada ? (
            <button
              key={l.id_pedido_detalle}
              type="button"
              className="despacho-form__anular-mobile-btn"
              onClick={() => anularLinea(idx)}
            >
              Anular: {l.nombre_producto}
            </button>
          ) : l.anulada ? (
            <button
              key={l.id_pedido_detalle}
              type="button"
              className="despacho-form__rehabilitar-mobile-btn"
              onClick={() => setLine(idx, { anulada: false, cantidad: Number(l.pendiente) || 0 })}
            >
              Rehabilitar: {l.nombre_producto}
            </button>
          ) : null
        )}
      </div>

      {totales.esParcial && (
        <Input
          label="Justificación (requerida para despacho parcial o con anulaciones)"
          value={justificacion}
          onChange={(e) => setJustificacion(e.target.value)}
          placeholder="Ej. Sin stock de 2 productos, se coordina para mañana"
          required
        />
      )}

      <div className="despacho-form__footer">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" disabled={!canSubmit}>
          {submitting ? (
            <Spinner size={14} />
          ) : (
            `Confirmar despacho${totales.surtir > 0 ? ` (${totales.surtir} u.)` : ''}${totales.anuladas > 0 ? ` + ${totales.anuladas} anulada(s)` : ''}`
          )}
        </Button>
      </div>
    </form>
  );
}

DespachoForm.propTypes = {
  pedido: PropTypes.object,
  submitting: PropTypes.bool,
  onSubmittingChange: PropTypes.func,
  onDone: PropTypes.func,
  onCancel: PropTypes.func,
};
