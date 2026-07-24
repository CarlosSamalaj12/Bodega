import { useEffect, useMemo, useState } from 'react';
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
        }))
      );
    }
  }, [pedido]);

  const totales = useMemo(() => {
    let surtir = 0;
    let saltar = 0;
    for (const l of lines) {
      surtir += Number(l.cantidad) || 0;
      saltar += l.estado === 'ANULADO' ? l.pendiente : 0;
    }
    return { surtir, saltar };
  }, [lines]);

  const parcial = totales.saltar > 0;
  const canSubmit = !submitting && (totales.surtir > 0 || totales.saltar > 0);

  const setLine = (idx, patch) =>
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const setCantidad = (idx, value) => {
    const v = String(value).replace(/[^\d]/g, '');
    const num = v === '' ? 0 : Math.min(parseInt(v, 10) || 0, lines[idx].pendiente);
    setLine(idx, { cantidad: num });
  };

  const anularLinea = (idx) => {
    setLine(idx, { cantidad: 0, anulada: true });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError(null);

    if (parcial && !justificacion.trim()) {
      setSubmitError('Si anulas o no surtiras todo, debes escribir una justificación.');
      return;
    }

    const payload = {
      justificacion: justificacion.trim() || null,
      lines: lines
        .filter((l) => l.cantidad > 0)
        .map((l) => ({
          id_pedido_detalle: l.id_pedido_detalle,
          cantidad_surtida: l.cantidad,
        })),
    };

    if (payload.lines.length === 0 && !parcial) {
      setSubmitError('Surti al menos una línea o anula alguna para justificar.');
      return;
    }

    onSubmittingChange?.(true);
    try {
      await pedidosService.fulfill(pedido.id_pedido, payload);
      toast.success('Despacho registrado');
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
              disabled={l.pendiente === 0}
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
        l.pendiente > 0 ? (
          <button
            type="button"
            className="despacho-form__anular"
            onClick={() => anularLinea(idx)}
            title="Anular esta línea"
            aria-label="Anular línea"
          >
            ✕
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
          l.pendiente > 0 ? (
            <button
              key={l.id_pedido_detalle}
              type="button"
              className="despacho-form__anular-mobile-btn"
              onClick={() => anularLinea(idx)}
            >
              Anular línea: {l.nombre_producto}
            </button>
          ) : null
        )}
      </div>

      {parcial && (
        <Input
          label="Justificación (requerida para despacho parcial)"
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
          {submitting ? <Spinner size={14} /> : `Confirmar despacho (${totales.surtir} u.)`}
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
