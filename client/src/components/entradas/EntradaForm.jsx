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
import { entradasService } from '@/services/entradas.service';
import { existenciasService } from '@/services/existencias.service';
import './EntradaForm.scss';

const EMPTY_LINE = {
  id_producto: null,
  nombre_producto: '',
  sku: null,
  cantidad: '',
  precio: '',
  lote: '',
  caducidad: '',
};

export function EntradaForm({
  motivos = [],
  proveedores = [],
  bodegaNombre = '',
  submitting = false,
  onSubmittingChange,
  onCreated,
  onCancel,
}) {
  const [cabecera, setCabecera] = useState({
    id_motivo: '',
    id_proveedor: '',
    no_documento: '',
    observaciones: '',
    pagado: '',
  });
  const [lines, setLines] = useState([{ ...EMPTY_LINE }]);
  const [submitError, setSubmitError] = useState(null);
  const [duplicateWarn, setDuplicateWarn] = useState(null);
  // Errores de validación por línea: { [idx]: { cantidad?, precio?, lote?, caducidad? } }
  const [lineErrors, setLineErrors] = useState({});
  // Track si el usuario intentó enviar al menos una vez (para mostrar errores solo después de intentar)
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
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

  // Validar una línea: producto, cantidad > 0, precio, lote y caducidad son obligatorios
  const validateLine = (l) => {
    const errors = {};
    if (!l.id_producto) errors.id_producto = 'Selecciona un producto';
    if (!l.cantidad || Number(l.cantidad) <= 0) errors.cantidad = 'Cantidad > 0';
    if (l.precio === '' || l.precio == null || Number(l.precio) < 0) errors.precio = 'Costo requerido';
    if (!String(l.lote || '').trim()) errors.lote = 'Lote requerido';
    if (!l.caducidad) errors.caducidad = 'Caducidad requerida';
    return errors;
  };

  // Valida todas las líneas; retorna true si todas pasan
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
    lines.every((l) => l.id_producto && Number(l.cantidad) > 0) &&
    lines.every((l) => l.precio !== '' && Number(l.precio) >= 0) &&
    lines.every((l) => String(l.lote || '').trim()) &&
    lines.every((l) => l.caducidad) &&
    !submitting;

  const handleNoDocumentoBlur = async () => {
    setDuplicateWarn(null);
    if (!cabecera.no_documento.trim()) return;
    const res = await entradasService.existeDocumento(cabecera.no_documento.trim());
    if (res?.exists) {
      setDuplicateWarn(res);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError(null);
    setAttemptedSubmit(true);

    // Validar todas las líneas
    if (!validateAll()) {
      setSubmitError('Completa todos los campos obligatorios de cada línea (producto, cantidad, costo, lote y caducidad).');
      return;
    }

    if (duplicateWarn?.exists) {
      const ok = window.confirm(
        `El documento "${cabecera.no_documento}" ya fue registrado hoy (movimiento #${duplicateWarn.id_movimiento}). ¿Registrar de todos modos?`
      );
      if (!ok) return;
    }

    const payload = {
      id_motivo: Number(cabecera.id_motivo),
      id_proveedor: cabecera.id_proveedor ? Number(cabecera.id_proveedor) : null,
      no_documento: cabecera.no_documento.trim() || null,
      observaciones: cabecera.observaciones.trim() || null,
      pagado: cabecera.pagado.trim() || null,
      lines: lines.map((l) => ({
        id_producto: l.id_producto,
        cantidad: Number(l.cantidad),
        precio: Number(l.precio) || 0,
        lote: l.lote.trim(),
        caducidad: l.caducidad,
      })),
    };

    onSubmittingChange?.(true);
    try {
      const data = await entradasService.create(payload);
      toast.success(`Entrada registrada (movimiento #${data.id_movimiento})`);
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
      const msg = errData?.error || 'No se pudo registrar la entrada';
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
      const data = await entradasService.create({
        ...pendingPayload,
        supervisor_pin: pin,
      });
      toast.success(`Entrada registrada (movimiento #${data.id_movimiento})`);
      setPinRequired(false);
      setPendingPayload(null);
      onCreated?.(data);
    } catch (e) {
      const errData = e?.response?.data;
      // Si el PIN es inválido, mantenemos el modal abierto con un toast de error.
      if (errData?.code === 'INVALID_SUPERVISOR_PIN') {
        toast.error('PIN de supervisor inválido. Intenta de nuevo.');
        return;
      }
      // Si requiere PIN de nuevo o cualquier otro error, cerramos el modal
      // y mostramos el error en el form.
      toast.error(errData?.error || 'No se pudo registrar la entrada');
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
      {text} <span className="entrada-form__required" aria-label="obligatorio">*</span>
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
          <div className="entrada-form__cell">
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
              ultimoPrecio={stockMap[idx]?.ultimo_precio || 0}
            />
            {err && <span className="entrada-form__field-error">{err}</span>}
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
          <div className="entrada-form__cell">
            <input
              type="number"
              className={`input entrada-form__num ${err ? 'input--error' : ''}`}
              min="0"
              step="1"
              value={l.cantidad}
              onChange={(e) => setLine(idx, { cantidad: e.target.value })}
              placeholder="0"
              required
            />
            {err && <span className="entrada-form__field-error">{err}</span>}
          </div>
        );
      },
    },
    {
      key: 'precio',
      label: requiredLabel('Costo unit.'),
      width: 120,
      render: (l, idx) => {
        const err = lineErrors[idx]?.precio;
        return (
          <div className="entrada-form__cell">
            <input
              type="number"
              className={`input entrada-form__num ${err ? 'input--error' : ''}`}
              min="0"
              step="0.01"
              value={l.precio}
              onChange={(e) => setLine(idx, { precio: e.target.value })}
              placeholder="0.00"
              required
            />
            {err && <span className="entrada-form__field-error">{err}</span>}
          </div>
        );
      },
    },
    {
      key: 'lote',
      label: requiredLabel('Lote'),
      width: 120,
      render: (l, idx) => {
        const err = lineErrors[idx]?.lote;
        return (
          <div className="entrada-form__cell">
            <input
              type="text"
              className={`input entrada-form__text ${err ? 'input--error' : ''}`}
              value={l.lote}
              onChange={(e) => setLine(idx, { lote: e.target.value })}
              placeholder="Lote"
              required
            />
            {err && <span className="entrada-form__field-error">{err}</span>}
          </div>
        );
      },
    },
    {
      key: 'caducidad',
      label: requiredLabel('Caducidad'),
      width: 140,
      // En móvil, ocultamos la fecha (es un input nativo muy ancho y difícil de tocar)
      hideOnMobile: true,
      render: (l, idx) => {
        const err = lineErrors[idx]?.caducidad;
        return (
          <div className="entrada-form__cell">
            <input
              type="date"
              className={`input entrada-form__text ${err ? 'input--error' : ''}`}
              value={l.caducidad}
              onChange={(e) => setLine(idx, { caducidad: e.target.value })}
              required
            />
            {err && <span className="entrada-form__field-error">{err}</span>}
          </div>
        );
      },
    },
    {
      key: 'subtotal',
      label: 'Subtotal',
      width: 100,
      align: 'right',
      // En móvil, el subtotal va en la cabecera de la card junto al producto
      hideOnMobile: true,
      render: (l) => {
        const sub = (Number(l.cantidad) || 0) * (Number(l.precio) || 0);
        return <span className="entrada-form__subtotal">{sub > 0 ? sub.toFixed(2) : '—'}</span>;
      },
    },
  ];

  return (
    <form className="entrada-form" onSubmit={handleSubmit}>
      {submitError && <div className="entrada-form__error">{submitError}</div>}

      <div className="entrada-form__section">
        <h3 className="entrada-form__section-title">Cabecera</h3>

        <div className="entrada-form__row">
          <Select
            label="Motivo"
            value={cabecera.id_motivo}
            onChange={(e) => setCab('id_motivo', e.target.value)}
            options={[
              { value: '', label: 'Seleccionar motivo…' },
              ...motivos.map((m) => ({ value: m.id_motivo, label: m.nombre_motivo })),
            ]}
            required
          />
          <Select
            label="Proveedor"
            value={cabecera.id_proveedor}
            onChange={(e) => setCab('id_proveedor', e.target.value)}
            options={[
              { value: '', label: 'Sin proveedor' },
              ...proveedores.map((p) => ({ value: p.id_proveedor, label: p.nombre_proveedor })),
            ]}
          />
        </div>

        <div className="entrada-form__row">
          <Input
            label="No. documento"
            value={cabecera.no_documento}
            onChange={(e) => setCab('no_documento', e.target.value)}
            onBlur={handleNoDocumentoBlur}
            placeholder="Ej. F-12345"
            hint="Para detectar duplicados"
            error={duplicateWarn?.exists ? 'Documento ya registrado hoy' : null}
          />
          <Input
            label="Pagado (opcional)"
            value={cabecera.pagado}
            onChange={(e) => setCab('pagado', e.target.value)}
            placeholder="Forma de pago o monto"
          />
        </div>

        <Input
          label="Observaciones"
          value={cabecera.observaciones}
          onChange={(e) => setCab('observaciones', e.target.value)}
          placeholder="Notas adicionales"
        />

        {bodegaNombre && (
          <div className="entrada-form__bodega">
            <span className="entrada-form__bodega-label">Bodega destino:</span>
            <strong>{bodegaNombre}</strong>
          </div>
        )}
      </div>

      <div className="entrada-form__section">
        <h3 className="entrada-form__section-title">Líneas</h3>

        <LinesEditor
          lines={lines}
          columns={columns}
          onAdd={addLine}
          onRemove={removeLine}
          canRemove={() => lines.length > 1}
          addLabel="+ Agregar línea"
          renderFooter={() => (
            <tr className="entrada-form__total-row">
              <td colSpan={5} style={{ textAlign: 'right' }} className="entrada-form__total-label">
                Total
              </td>
              <td style={{ textAlign: 'right' }} className="entrada-form__total">
                {totales.total.toFixed(2)}
              </td>
              <td></td>
            </tr>
          )}
        />

        {/* Mostrar total grande en móvil */}
        <div className="entrada-form__total-mobile">
          <span>Total</span>
          <strong>{totales.total.toFixed(2)}</strong>
        </div>
      </div>

      <div className="entrada-form__footer">
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
          {submitting ? <Spinner size={14} /> : `Registrar entrada${totales.lineasValidas ? ` (${totales.lineasValidas})` : ''}`}
        </Button>
      </div>

      {/* Modal de PIN para motivos tipo AJUSTE (entrada de inventario) */}
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

EntradaForm.propTypes = {
  motivos: PropTypes.array,
  proveedores: PropTypes.array,
  bodegaNombre: PropTypes.string,
  submitting: PropTypes.bool,
  onSubmittingChange: PropTypes.func,
  onCreated: PropTypes.func,
  onCancel: PropTypes.func,
};
