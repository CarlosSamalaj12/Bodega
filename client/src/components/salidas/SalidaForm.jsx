import { useCallback, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { ProductPicker } from '@/components/ui/ProductPicker';
import { LinesEditor } from '@/components/ui/LinesEditor';
import { Spinner } from '@/components/ui/Spinner';
import { PinModal } from '@/components/ui/PinModal';
import { toast } from '@/components/ui/Toast';
import { salidasService } from '@/services/salidas.service';
import { existenciasService } from '@/services/existencias.service';
import './SalidaForm.scss';

const EMPTY_LINE = {
  id_producto: null,
  nombre_producto: '',
  sku: null,
  cantidad: '',
  precio: '',
  // El lote se asigna automáticamente con FEFO (First-Expiry, First-Out)
  // en el backend. No se pide al usuario.
};

export function SalidaForm({
  motivos = [],
  bodegaNombre = '',
  submitting = false,
  onSubmittingChange,
  onCreated,
  onCancel,
}) {
  const [cabecera, setCabecera] = useState({
    id_motivo: '',
    no_documento: '',
    observaciones: '',
  });
  const [lines, setLines] = useState([{ ...EMPTY_LINE }]);
  const [submitError, setSubmitError] = useState(null);
  // Errores de validación por línea: { [idx]: { id_producto?, cantidad?, precio? } }
  const [lineErrors, setLineErrors] = useState({});
  // Stock por índice de línea (para mostrar "X en existencia" en el chip)
  const [stockMap, setStockMap] = useState({});

  // Fetch stock cuando se selecciona un producto
  const fetchStock = useCallback(async (lineIdx, idProducto) => {
    if (!idProducto) {
      setStockMap((prev) => {
        const next = { ...prev };
        delete next[lineIdx];
        return next;
      });
      return;
    }
    try {
      const info = await existenciasService.getStockByProduct(idProducto);
      setStockMap((prev) => ({ ...prev, [lineIdx]: info }));
    } catch {
      // Silencioso — no bloqueamos la selección
    }
  }, []);

  // PIN de supervisor (cuando el motivo es AJUSTE)
  const [pinRequired, setPinRequired] = useState(false);
  const [pinSubmitting, setPinSubmitting] = useState(false);
  const [pendingPayload, setPendingPayload] = useState(null);

  const setCab = (k, v) => setCabecera((p) => ({ ...p, [k]: v }));
  const setLine = (idx, patch) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };
  const addLine = () => setLines((prev) => [...prev, { ...EMPTY_LINE }]);
  const removeLine = (idx) => {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));
    // Reindex stockMap para mantener sincronizados los índices de línea
    setStockMap((prev) => {
      const keys = Object.keys(prev).map(Number).sort((a, b) => a - b);
      const next = {};
      for (const k of keys) {
        if (k === idx) continue; // elimina el removido
        next[k > idx ? k - 1 : k] = prev[k];
      }
      return next;
    });
  };

  const totales = useMemo(() => {
    let total = 0;
    let lineasValidas = 0;
    for (const l of lines) {
      const c = Number(l.cantidad) || 0;
      const p = Number(l.precio) || 0;
      total += c * p;
      if (c > 0) lineasValidas += 1;
    }
    return { total, lineasValidas };
  }, [lines]);

  // Validar una línea: producto, cantidad > 0 y precio de salida son obligatorios
  const validateLine = (l) => {
    const errors = {};
    if (!l.id_producto) errors.id_producto = 'Selecciona un producto';
    if (!l.cantidad || Number(l.cantidad) <= 0) errors.cantidad = 'Cantidad > 0';
    if (l.precio === '' || l.precio == null || Number(l.precio) < 0) errors.precio = 'Precio requerido';
    return errors;
  };

  const validateAll = useCallback(() => {
    const errs = {};
    let ok = true;
    lines.forEach((l, idx) => {
      const e = validateLine(l);
      if (Object.keys(e).length) {
        errs[idx] = e;
        ok = false;
      }
    });
    setLineErrors(errs);
    return ok;
  }, [lines]);

  const canSubmit =
    cabecera.id_motivo &&
    cabecera.no_documento.trim() &&
    lines.every((l) => l.id_producto && Number(l.cantidad) > 0) &&
    lines.every((l) => l.precio !== '' && Number(l.precio) >= 0) &&
    !submitting;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError(null);

    // Validar todas las líneas
    if (!validateAll()) {
      setSubmitError('Completa todos los campos obligatorios de cada línea (producto, cantidad y precio de salida).');
      return;
    }

    const payload = {
      id_motivo: Number(cabecera.id_motivo),
      no_documento: cabecera.no_documento.trim() || null,
      observaciones: cabecera.observaciones.trim() || null,
      lines: lines.map((l) => ({
        id_producto: l.id_producto,
        cantidad: Number(l.cantidad),
        // El backend distingue costo_unitario (autocalculado) de
        // precio_salida (lo que pone el usuario al despachar).
        precio_salida: Number(l.precio) || 0,
      })),
    };

    onSubmittingChange?.(true);
    try {
      const data = await salidasService.create(payload);
      toast.success(`Salida registrada (movimiento #${data.id_movimiento})`);
      onCreated?.(data);
    } catch (e) {
      const errData = e?.response?.data;
      // Si el motivo es AJUSTE, el backend exige PIN de supervisor.
      if (errData?.code === 'SUPERVISOR_PIN_REQUIRED') {
        setPendingPayload(payload);
        setPinRequired(true);
        onSubmittingChange?.(false);
        return;
      }
      const msg = errData?.error || 'No se pudo registrar la salida';
      setSubmitError(msg);
    } finally {
      onSubmittingChange?.(false);
    }
  };

  // Reintenta el envío con el PIN de supervisor capturado.
  const handlePinConfirm = async (pin) => {
    if (!pendingPayload) {
      setPinRequired(false);
      return;
    }
    setPinSubmitting(true);
    try {
      const data = await salidasService.create({
        ...pendingPayload,
        supervisor_pin: pin,
      });
      toast.success(`Salida registrada (movimiento #${data.id_movimiento})`);
      setPinRequired(false);
      setPendingPayload(null);
      onCreated?.(data);
    } catch (e) {
      const errData = e?.response?.data;
      // PIN inválido: mantener el modal abierto con un toast de error.
      if (errData?.code === 'INVALID_SUPERVISOR_PIN') {
        toast.error('PIN de supervisor inválido. Intenta de nuevo.');
        return;
      }
      // Otro error: cerrar el modal y mostrar en el form.
      toast.error(errData?.error || 'No se pudo registrar la salida');
      setPinRequired(false);
      setPendingPayload(null);
    } finally {
      setPinSubmitting(false);
    }
  };

  const handlePinCancel = () => {
    setPinRequired(false);
    setPendingPayload(null);
  };

  // Helper para mostrar el asterisco de campo obligatorio en la cabecera de columna
  const requiredLabel = (text) => (
    <span>
      {text} <span className="salida-form__required" aria-label="obligatorio">*</span>
    </span>
  );

  const columns = [
    {
      key: 'producto',
      label: requiredLabel('Producto'),
      primary: true,
      minWidth: 240,
      render: (l, idx) => {
        const err = lineErrors[idx]?.id_producto;
        return (
          <div className="salida-form__cell">
            <ProductPicker
              value={l.id_producto ? { id_producto: l.id_producto, nombre_producto: l.nombre_producto, sku: l.sku } : null}
              onChange={(p) => {
                setLine(idx, {
                  id_producto: p?.id_producto || null,
                  nombre_producto: p?.nombre_producto || '',
                  sku: p?.sku || null,
                });
                fetchStock(idx, p?.id_producto || null);
              }}
              placeholder="Buscar producto…"
              stockInfo={stockMap[idx] || null}
              ultimoPrecio={stockMap[idx]?.ultimo_precio_salida || 0}
            />
            {err && <span className="salida-form__field-error">{err}</span>}
          </div>
        );
      },
    },
    {
      key: 'cantidad',
      label: requiredLabel('Cantidad'),
      width: 100,
      render: (l, idx) => {
        const err = lineErrors[idx]?.cantidad;
        return (
          <div className="salida-form__cell">
            <input
              type="number"
              className={`input salida-form__num ${err ? 'input--error' : ''}`}
              min="0"
              step="0.001"
              inputMode="decimal"
              value={l.cantidad}
              onChange={(e) => setLine(idx, { cantidad: e.target.value })}
              placeholder="0"
              required
            />
            {err && <span className="salida-form__field-error">{err}</span>}
          </div>
        );
      },
    },
    {
      key: 'precio',
      label: requiredLabel('Precio de salida'),
      width: 120,
      render: (l, idx) => {
        const err = lineErrors[idx]?.precio;
        return (
          <div className="salida-form__cell">
            <input
              type="number"
              className={`input salida-form__num ${err ? 'input--error' : ''}`}
              min="0"
              step="0.01"
              value={l.precio}
              onChange={(e) => setLine(idx, { precio: e.target.value })}
              placeholder="0.00"
              title="Precio unitario al que se registra la salida. Si la bodega lo requiere, es obligatorio."
              required
            />
            {err && <span className="salida-form__field-error">{err}</span>}
          </div>
        );
      },
    },
    {
      key: 'subtotal',
      label: 'Subtotal',
      width: 100,
      align: 'right',
      hideOnMobile: true,
      render: (l) => {
        const sub = (Number(l.cantidad) || 0) * (Number(l.precio) || 0);
        return <span className="salida-form__subtotal">{sub > 0 ? sub.toFixed(2) : '—'}</span>;
      },
    },
  ];

  return (
    <form className="salida-form" onSubmit={handleSubmit} noValidate>
      {submitError && <div className="salida-form__error">{submitError}</div>}

      <div className="salida-form__section">
        <h3 className="salida-form__section-title">Cabecera</h3>

        <div className="salida-form__row">
          <Select
            label={requiredLabel('Motivo')}
            value={cabecera.id_motivo}
            onChange={(e) => setCab('id_motivo', e.target.value)}
            options={[
              { value: '', label: 'Seleccionar motivo…' },
              ...motivos.map((m) => ({ value: m.id_motivo, label: m.nombre_motivo })),
            ]}
            required
          />
          <Input
            label={requiredLabel('No. documento')}
            value={cabecera.no_documento}
            onChange={(e) => setCab('no_documento', e.target.value)}
            placeholder="Ej. S-12345"
            required
          />
        </div>

        <Input
          label="Observaciones"
          value={cabecera.observaciones}
          onChange={(e) => setCab('observaciones', e.target.value)}
          placeholder="Notas adicionales"
        />

        {bodegaNombre && (
          <div className="salida-form__bodega">
            <span className="salida-form__bodega-label">Bodega origen:</span>
            <strong>{bodegaNombre}</strong>
          </div>
        )}

        <p className="salida-form__hint">
          ℹ️ El lote se asigna automáticamente del más antiguo disponible (FEFO).
          Al expandir el movimiento en la lista verás qué lote se usó en cada línea.
        </p>
      </div>

      <div className="salida-form__section">
        <h3 className="salida-form__section-title">Líneas</h3>

        <LinesEditor
          lines={lines}
          columns={columns}
          onAdd={addLine}
          onRemove={removeLine}
          canRemove={() => lines.length > 1}
          addLabel="+ Agregar línea"
          renderFooter={() => (
            <tr>
              <td colSpan={4} style={{ textAlign: 'right' }} className="salida-form__total-label">
                Total
              </td>
              <td style={{ textAlign: 'right' }} className="salida-form__total">
                {totales.total.toFixed(2)}
              </td>
              <td></td>
            </tr>
          )}
        />

        <div className="salida-form__total-mobile">
          <span>Total</span>
          <strong>{totales.total.toFixed(2)}</strong>
        </div>
      </div>

      <div className="salida-form__footer">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancelar
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={addLine}
          disabled={submitting}
          title="Agregar otra línea a este movimiento"
        >
          + Agregar línea
        </Button>
        <Button type="submit" variant="primary" disabled={!canSubmit}>
          {submitting ? <Spinner size={14} /> : `Registrar salida${totales.lineasValidas ? ` (${totales.lineasValidas})` : ''}`}
        </Button>
      </div>

      {/* Modal de PIN para motivos tipo AJUSTE (salida de inventario) */}
      <PinModal
        open={pinRequired}
        title="PIN de supervisor"
        description="Este motivo requiere autorización de un supervisor. Ingresa el PIN para registrar el ajuste."
        submitting={pinSubmitting}
        onConfirm={handlePinConfirm}
        onCancel={handlePinCancel}
      />
    </form>
  );
}

SalidaForm.propTypes = {
  motivos: PropTypes.array,
  bodegaNombre: PropTypes.string,
  submitting: PropTypes.bool,
  onSubmittingChange: PropTypes.func,
  onCreated: PropTypes.func,
  onCancel: PropTypes.func,
};
