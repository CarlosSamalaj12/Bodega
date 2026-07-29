import { useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { ProductPicker } from '@/components/ui/ProductPicker';
import { LinesEditor } from '@/components/ui/LinesEditor';
import { Spinner } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/Toast';
import { salidasService } from '@/services/salidas.service';
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

  const setCab = (k, v) => setCabecera((p) => ({ ...p, [k]: v }));
  const setLine = (idx, patch) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };
  const addLine = () => setLines((prev) => [...prev, { ...EMPTY_LINE }]);
  const removeLine = (idx) => {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));
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

  const canSubmit =
    cabecera.id_motivo &&
    lines.some((l) => l.id_producto && Number(l.cantidad) > 0) &&
    !submitting;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError(null);

    const payload = {
      id_motivo: Number(cabecera.id_motivo),
      no_documento: cabecera.no_documento.trim() || null,
      observaciones: cabecera.observaciones.trim() || null,
      lines: lines
        .filter((l) => l.id_producto && Number(l.cantidad) > 0)
        .map((l) => ({
          id_producto: l.id_producto,
          cantidad: Number(l.cantidad),
          // El backend distingue costo_unitario (autocalculado) de
          // precio_salida (lo que pone el usuario al despachar).
          precio_salida: Number(l.precio) || 0,
        })),
    };

    if (payload.lines.length === 0) {
      setSubmitError('Agrega al menos una línea con producto y cantidad mayor a 0.');
      return;
    }

    onSubmittingChange?.(true);
    try {
      const data = await salidasService.create(payload);
      toast.success(`Salida registrada (movimiento #${data.id_movimiento})`);
      onCreated?.(data);
    } catch (e) {
      const msg = e?.response?.data?.error || 'No se pudo registrar la salida';
      setSubmitError(msg);
    } finally {
      onSubmittingChange?.(false);
    }
  };

  const columns = [
    {
      key: 'producto',
      label: 'Producto',
      primary: true,
      minWidth: 240,
      render: (l, idx) => (
        <ProductPicker
          value={l.id_producto ? { id_producto: l.id_producto, nombre_producto: l.nombre_producto, sku: l.sku } : null}
          onChange={(p) => setLine(idx, {
            id_producto: p?.id_producto || null,
            nombre_producto: p?.nombre_producto || '',
            sku: p?.sku || null,
          })}
          placeholder="Buscar producto…"
        />
      ),
    },
    {
      key: 'cantidad',
      label: 'Cantidad',
      width: 100,
      render: (l, idx) => (
        <input
          type="number"
          className="input salida-form__num"
          min="0"
          step="0.001"
          value={l.cantidad}
          onChange={(e) => setLine(idx, { cantidad: e.target.value })}
          placeholder="0"
        />
      ),
    },
    {
      key: 'precio',
      label: 'Precio de salida',
      width: 120,
      render: (l, idx) => (
        <input
          type="number"
          className="input salida-form__num"
          min="0"
          step="0.01"
          value={l.precio}
          onChange={(e) => setLine(idx, { precio: e.target.value })}
          placeholder="0.00"
          title="Precio unitario al que se registra la salida. Si la bodega lo requiere, es obligatorio."
        />
      ),
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
    <form className="salida-form" onSubmit={handleSubmit}>
      {submitError && <div className="salida-form__error">{submitError}</div>}

      <div className="salida-form__section">
        <h3 className="salida-form__section-title">Cabecera</h3>

        <div className="salida-form__row">
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
          <Input
            label="No. documento"
            value={cabecera.no_documento}
            onChange={(e) => setCab('no_documento', e.target.value)}
            placeholder="Opcional"
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
        <Button type="submit" variant="primary" disabled={!canSubmit}>
          {submitting ? <Spinner size={14} /> : `Registrar salida${totales.lineasValidas ? ` (${totales.lineasValidas})` : ''}`}
        </Button>
      </div>
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
