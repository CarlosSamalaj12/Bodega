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

export function DespachoForm({ pedido, submitting, onSubmittingChange, onDone, onCancel, onDetailsChange }) {
  const [lines, setLines] = useState([]);
  const [justificacion, setJustificacion] = useState('');
  const [submitError, setSubmitError] = useState(null);

  // Mapea las líneas del servidor al estado local del formulario.
  const mapLine = useCallback((l) => ({
    id_pedido_detalle: l.id_pedido_detalle,
    id_producto: l.id_producto,
    nombre_producto: l.nombre_producto,
    solicitada: Number(l.cantidad_solicitada || 0),
    surtida_anterior: Number(l.cantidad_surtida || 0),
    pendiente: Number(l.pendiente || 0),
    // stock del surtidor (mi bodega): se usa para validar que puedo despachar
    stock: Number(l.stock_surtidor || 0),
    // stock de la bodega del solicitante: información para el despachador
    stock_solicitante: Number(l.stock_solicitante || 0),
    estado: l.estado_linea,
    cantidad: Number(l.pendiente || 0),
    anulada: false,
  }), []);

  useEffect(() => {
    if (pedido?.lines) {
      setLines(pedido.lines.map(mapLine));
    }
  }, [pedido, mapLine]);

  const totales = useMemo(() => {
    let surtir = 0;
    let anuladas = 0;
    let sobreDespacho = 0;
    for (const l of lines) {
      surtir += Number(l.cantidad) || 0;
      if (l.anulada) anuladas += Number(l.pendiente) || 0;
      const cant = Number(l.cantidad) || 0;
      const pend = Number(l.pendiente) || 0;
      if (cant > pend) sobreDespacho += cant - pend;
    }
    const pendienteTotal = lines.reduce((a, l) => a + (Number(l.pendiente) || 0), 0);
    // Requiere justificación si: se sub-despacha, se anulan líneas, o se sobre-despacha.
    const esParcial = surtir !== pendienteTotal || anuladas > 0 || sobreDespacho > 0;
    return { surtir, anuladas, sobreDespacho, esParcial };
  }, [lines]);

  const canSubmit = !submitting && (totales.surtir > 0 || totales.anuladas > 0);

  const setLine = useCallback((idx, patch) =>
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l))),
  []);

  const setCantidad = useCallback((idx, value) => {
    // Guardamos la cadena cruda para preservar lo que el usuario tipea
    // (ej. "1.", "1.5"). El navegador ya bloquea caracteres no numéricos
    // con type="number" + step="0.001", así que no hace falta sanear.
    setLine(idx, { cantidad: value });
  }, [setLine]);

  const anularLinea = useCallback((idx) => {
    setLine(idx, { cantidad: 0, anulada: true });
  }, [setLine]);

  // Líneas pendientes de despachar (para las acciones rápidas por producto / todo)
  const pendingLines = useMemo(
    () => lines.filter((l) => Number(l.pendiente || 0) > 0 && !l.anulada),
    [lines]
  );
  // "Despachar todo" solo se habilita si TODAS las pendientes tienen stock vigente.
  const canDispatchAll =
    pendingLines.length > 0 &&
    pendingLines.every((l) => Number(l.stock || 0) >= Number(l.pendiente || 0));

  // Refresca el detalle del pedido desde el servidor y sincroniza el estado local
  // (y opcionalmente el del padre) tras un despacho rápido.
  const refreshDetails = useCallback(async () => {
    try {
      const fresh = await pedidosService.getDetails(pedido.id_pedido);
      if (fresh?.lines) {
        setLines(fresh.lines.map(mapLine));
        onDetailsChange?.(fresh);
      }
      return fresh;
    } catch {
      return null;
    }
  }, [pedido, mapLine, onDetailsChange]);

  // Cancela las líneas marcadas como anuladas en el formulario. Compartido por
  // el submit normal y por el despacho rápido para no dejar líneas huérfanas.
  const cancelAnuladas = useCallback(
    async (linesAnuladas) => {
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
      return cancelErrors;
    },
    [pedido, justificacion]
  );

  // Despacho rápido: envía al servidor SOLO las líneas indicadas (por producto
  // o todas). El backend valida stock vigente y vencimiento (FEFO). Tras
  // despachar refresca el detalle; si ya no queda pendiente, cierra el modal.
  //
  // Importante: la cantidad a despachar es la que el usuario tipeó en el
  // input (`l.cantidad`), NO el pendiente. Esto permite hacer un despacho
  // parcial desde el botón ⚡ sin tener que usar el submit principal.
  // Antes se mandaba siempre el pendiente completo, lo que confundía al
  // operador (veía "1" en el input pero el sistema despachaba 50).
  //
  // Opciones:
  //   - usePendingQty=true  → usa SIEMPRE el pendiente (caso "Despachar todo")
  //   - usePendingQty=false → usa la cantidad tipeada (caso botón ⚡ por línea)
  const quickDispatch = useCallback(
    async (targetLines, { usePendingQty = false } = {}) => {
      const linesAFulfill = targetLines.filter((l) => !l.anulada).map((l) => {
        if (usePendingQty) {
          return { ...l, _qty: Number(l.pendiente || 0) };
        }
        const typed = Number(l.cantidad);
        const hasTyped = Number.isFinite(typed) && typed > 0;
        const qty = hasTyped ? typed : Number(l.pendiente || 0);
        return { ...l, _qty: qty };
      }).filter((l) => l._qty > 0 && Number(l.pendiente || 0) > 0);
      if (!linesAFulfill.length) return;
      onSubmittingChange?.(true);
      setSubmitError(null);
      try {
        const res = await pedidosService.fulfill(pedido.id_pedido, {
          justificacion: justificacion.trim() || null,
          lines: linesAFulfill.map((l) => ({
            id_pedido_detalle: l.id_pedido_detalle,
            qty: l._qty,
          })),
        });
        const skipped = Array.isArray(res?.skipped) ? res.skipped : [];
        // Cancelar líneas marcadas como anuladas (mismo comportamiento que el submit normal)
        const cancelErrors = await cancelAnuladas(lines.filter((l) => l.anulada));
        const fresh = await refreshDetails();
        if (skipped.length > 0) {
          const nombreDe = new Map(lines.map((l) => [Number(l.id_producto), l.nombre_producto]));
          const motivoText = skipped
            .map((s) => {
              const nombre = nombreDe.get(Number(s.id_producto)) || `#${s.id_producto}`;
              if (s.motivo === 'SIN_STOCK_PARCIAL') {
                return `${nombre} (solo ${s.despachado} de ${s.solicitado})`;
              }
              return nombre;
            })
            .join(', ');
          toast.warn(`Despacho registrado, pero ${skipped.length} línea(s) sin stock completo: ${motivoText}`);
        } else if (cancelErrors.length > 0) {
          toast.warn(
            `Despacho registrado, pero algunas líneas no se pudieron anular:\n${cancelErrors.join('\n')}`
          );
        } else {
          toast.success('Despacho registrado');
        }
        const siguePendiente = (fresh?.lines || []).some(
          (l) => Number(l.pendiente || 0) > 0 && String(l.estado_linea || '').toUpperCase() !== 'ANULADO'
        );
        if (!siguePendiente) onDone?.();
      } catch (e) {
        setSubmitError(e?.response?.data?.error || 'No se pudo despachar');
      } finally {
        onSubmittingChange?.(false);
      }
    },
    [pedido, lines, justificacion, refreshDetails, cancelAnuladas, onDone, onSubmittingChange]
  );

  const dispatchLine = useCallback(
    (l) => {
      if (l.anulada) return;
      const cant = Number(l.cantidad);
      const pend = Number(l.pendiente || 0);
      const stock = Number(l.stock || 0);
      // Bloqueos:
      //  - línea sin pendiente
      //  - cantidad tipeada vacía o 0
      //  - cantidad tipeada mayor al stock disponible
      if (pend <= 0) return;
      if (!Number.isFinite(cant) || cant <= 0) return;
      if (cant > stock) return;
      quickDispatch([l]);
    },
    [quickDispatch]
  );

  const dispatchAll = useCallback(() => {
    if (!canDispatchAll) return;
    // "Despachar todo" siempre despacha el pendiente completo de cada
    // línea, sin importar lo que el usuario haya tipeado individualmente.
    quickDispatch(pendingLines, { usePendingQty: true });
  }, [canDispatchAll, pendingLines, quickDispatch]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError(null);

    const linesAFulfill = lines.filter((l) => l.cantidad > 0 && !l.anulada);
    const linesAnuladas = lines.filter((l) => l.anulada);

    if (linesAFulfill.length === 0 && linesAnuladas.length === 0) {
      setSubmitError('Surtí al menos una línea o anula alguna para justificar.');
      return;
    }

    // Bloquear el despacho si alguna línea supera el stock disponible (vigente).
    // Se evalúa ANTES de la justificación: el error de stock es más concreto.
    const sinStock = linesAFulfill.filter((l) => l.cantidad > Number(l.stock || 0));
    if (sinStock.length > 0) {
      setSubmitError(
        `Stock insuficiente para: ${sinStock.map((l) => l.nombre_producto).join(', ')}. Ajusta la cantidad o anula la línea.`
      );
      return;
    }

    if (totales.esParcial && !justificacion.trim()) {
      setSubmitError('Si anulas líneas, despacharás de menos o de más, debes escribir una justificación.');
      return;
    }

    onSubmittingChange?.(true);
    try {
      // 1. Enviar las líneas a surtir
      let skipped = [];
      if (linesAFulfill.length > 0) {
        const res = await pedidosService.fulfill(pedido.id_pedido, {
          justificacion: justificacion.trim() || null,
          lines: linesAFulfill.map((l) => ({
            id_pedido_detalle: l.id_pedido_detalle,
            qty: l.cantidad,
          })),
        });
        skipped = Array.isArray(res?.skipped) ? res.skipped : [];
      }

      // 2. Anular las líneas marcadas como anuladas (una por una)
      const cancelErrors = await cancelAnuladas(linesAnuladas);

      if (skipped.length > 0) {
        const nombreDe = new Map(lines.map((l) => [Number(l.id_producto), l.nombre_producto]));
        const motivoText = skipped
          .map((s) => {
            const nombre = nombreDe.get(Number(s.id_producto)) || `#${s.id_producto}`;
            if (s.motivo === 'SIN_STOCK_PARCIAL') {
              return `${nombre} (solo ${s.despachado} de ${s.solicitado})`;
            }
            return nombre;
          })
          .join(', ');
        toast.warn(`Despacho registrado, pero ${skipped.length} línea(s) sin stock completo: ${motivoText}`);
      } else if (cancelErrors.length > 0) {
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
      key: 'stock_solicitante',
      label: 'Stock solicitante',
      width: 120,
      align: 'right',
      hideOnMobile: true,
      render: (l) => (
        <div className="despacho-form__stock-cell">
          <span
            className={l.stock_solicitante <= 0 ? 'despacho-form__num--warn' : 'despacho-form__num'}
            title={`Stock en bodega del solicitante: ${l.stock_solicitante}`}
          >
            {l.stock_solicitante}
          </span>
          {l.stock > 0 && (
            <span
              className="despacho-form__stock-hint"
              title={`Stock disponible en tu bodega (surtidor): ${l.stock}`}
            >
              disp. {l.stock}
            </span>
          )}
        </div>
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
        const cant = Number(l.cantidad) || 0;
        const pend = Number(l.pendiente) || 0;
        const overStock = cant > Number(l.stock || 0);
        const sobreDespacho = cant > pend;
        return (
          <div className="despacho-form__cantidad-cell">
            <input
              type="number"
              className={`input despacho-form__input ${overStock ? 'despacho-form__input--warn' : ''} ${sobreDespacho ? 'despacho-form__input--info' : ''}`}
              min="0"
              step="0.001"
              inputMode="decimal"
              value={l.cantidad}
              onChange={(e) => setCantidad(idx, e.target.value)}
              disabled={l.pendiente === 0 || l.anulada}
              title={sobreDespacho ? `Estás despachando ${(cant - pend).toFixed(3)} sobre lo solicitado` : ''}
            />
            {overStock && (
              <div className="despacho-form__warn">Sin stock suficiente — disp. {l.stock}</div>
            )}
            {!overStock && sobreDespacho && (
              <div className="despacho-form__hint">+{cant - pend} sobre lo solicitado</div>
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
      width: 76,
      hideOnMobile: true,
      render: (l, idx) => {
        const cant = Number(l.cantidad);
        const pend = Number(l.pendiente || 0);
        const stock = Number(l.stock || 0);
        const cantValida = Number.isFinite(cant) && cant > 0;
        const sobreStock = cantValida && cant > stock;
        const quickDisabled =
          submitting ||
          l.anulada ||
          pend <= 0 ||
          !cantValida ||
          sobreStock;
        const quickTitle = (() => {
          if (l.anulada) return 'Línea anulada';
          if (pend <= 0) return 'Línea ya despachada';
          if (!cantValida) return 'Escribe una cantidad mayor a 0';
          if (sobreStock) return `Sin stock suficiente (disp. ${stock})`;
          return `Despachar ${cant} u. de ${l.nombre_producto}`;
        })();
        return (
        <div className="despacho-form__row-actions">
          {l.pendiente > 0 && !l.anulada && (
            <button
              type="button"
              className="despacho-form__quick"
              onClick={() => dispatchLine(l)}
              disabled={quickDisabled}
              title={quickTitle}
              aria-label={`Despachar ${l.nombre_producto}`}
            >
              ⚡
            </button>
          )}
          {l.pendiente > 0 && !l.anulada ? (
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
          ) : null}
        </div>
        );
      },
    },
  ];

  return (
    <form className="despacho-form" onSubmit={handleSubmit} noValidate>
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
            {totales.sobreDespacho > 0 && (
              <span className="despacho-form__total-badge" title={`${totales.sobreDespacho} unidad(es) extra sobre lo solicitado`}>
                +{totales.sobreDespacho}
              </span>
            )}
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

      {/* En móvil, acciones rápidas por línea (despachar / anular / rehabilitar) */}
      <div className="despacho-form__anular-mobile">
        {lines.map((l, idx) => {
          const cant = Number(l.cantidad);
          const pend = Number(l.pendiente || 0);
          const stock = Number(l.stock || 0);
          const cantValida = Number.isFinite(cant) && cant > 0;
          const sobreStock = cantValida && cant > stock;
          const quickDisabled =
            submitting ||
            l.anulada ||
            pend <= 0 ||
            !cantValida ||
            sobreStock;
          return (
          <div key={l.id_pedido_detalle} className="despacho-form__mobile-row">
            {l.pendiente > 0 && !l.anulada && (
              <button
                type="button"
                className="despacho-form__quick-mobile-btn"
                onClick={() => dispatchLine(l)}
                disabled={quickDisabled}
                title={
                  sobreStock
                    ? `Sin stock suficiente (disp. ${stock})`
                    : !cantValida
                    ? 'Escribe una cantidad mayor a 0'
                    : `Despachar ${cant} u.`
                }
              >
                ⚡ Despachar: {l.nombre_producto} ({cantValida ? cant : pend} u.)
              </button>
            )}
            {l.pendiente > 0 && !l.anulada ? (
              <button
                type="button"
                className="despacho-form__anular-mobile-btn"
                onClick={() => anularLinea(idx)}
              >
                Anular: {l.nombre_producto}
              </button>
            ) : l.anulada ? (
              <button
                type="button"
                className="despacho-form__rehabilitar-mobile-btn"
                onClick={() => setLine(idx, { anulada: false, cantidad: Number(l.pendiente) || 0 })}
              >
                Rehabilitar: {l.nombre_producto}
              </button>
            ) : null}
          </div>
          );
        })}
      </div>

      {totales.esParcial && (
        <Input
          label={
            totales.sobreDespacho > 0
              ? 'Justificación (requerida: despacho parcial, con anulaciones o sobre-despacho)'
              : 'Justificación (requerida para despacho parcial o con anulaciones)'
          }
          value={justificacion}
          onChange={(e) => setJustificacion(e.target.value)}
          placeholder={
            totales.sobreDespacho > 0
              ? 'Ej. Cliente pidió 2 pero se le entregan 3 por reposición de stock'
              : 'Ej. Sin stock de 2 productos, se coordina para mañana'
          }
          required
        />
      )}

      <div className="despacho-form__footer">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancelar
        </Button>
        {pendingLines.length > 0 && (
          <Button
            type="button"
            variant="secondary"
            onClick={dispatchAll}
            disabled={submitting || !canDispatchAll}
            title={
              canDispatchAll
                ? `Despachar todas las líneas pendientes (${pendingLines.length})`
                : 'No hay stock suficiente en todas las líneas pendientes. Despacha por producto o ajusta cantidades.'
            }
          >
            ⚡ Despachar todo ({pendingLines.length})
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={!canSubmit}>
          {submitting ? (
            <Spinner size={14} />
          ) : (
            `Confirmar despacho${totales.surtir > 0 ? ` (${totales.surtir} u.)` : ''}${totales.anuladas > 0 ? ` + ${totales.anuladas} anulada(s)` : ''}${totales.sobreDespacho > 0 ? ` (+${totales.sobreDespacho} extra)` : ''}`
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
  onDetailsChange: PropTypes.func,
};
