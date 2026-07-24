import { useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { ProductPicker } from '@/components/ui/ProductPicker';
import { LinesEditor } from '@/components/ui/LinesEditor';
import { Spinner } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/Toast';
import { entradasService } from '@/services/entradas.service';
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
      lines: lines
        .filter((l) => l.id_producto && Number(l.cantidad) > 0)
        .map((l) => ({
          id_producto: l.id_producto,
          cantidad: Number(l.cantidad),
          precio: Number(l.precio) || 0,
          lote: l.lote.trim() || null,
          caducidad: l.caducidad || null,
        })),
    };

    if (payload.lines.length === 0) {
      setSubmitError('Agrega al menos una línea con producto y cantidad mayor a 0.');
      return;
    }

    onSubmittingChange?.(true);
    try {
      const data = await entradasService.create(payload);
      toast.success(`Entrada registrada (movimiento #${data.id_movimiento})`);
      onCreated?.(data);
    } catch (e) {
      const msg = e?.response?.data?.error || 'No se pudo registrar la entrada';
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
          className="input entrada-form__num"
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
      label: 'Costo unit.',
      width: 120,
      render: (l, idx) => (
        <input
          type="number"
          className="input entrada-form__num"
          min="0"
          step="0.01"
          value={l.precio}
          onChange={(e) => setLine(idx, { precio: e.target.value })}
          placeholder="0.00"
        />
      ),
    },
    {
      key: 'lote',
      label: 'Lote',
      width: 120,
      render: (l, idx) => (
        <input
          type="text"
          className="input entrada-form__text"
          value={l.lote}
          onChange={(e) => setLine(idx, { lote: e.target.value })}
          placeholder="Lote"
        />
      ),
    },
    {
      key: 'caducidad',
      label: 'Caducidad',
      width: 140,
      // En móvil, ocultamos la fecha (es un input nativo muy ancho y difícil de tocar)
      hideOnMobile: true,
      render: (l, idx) => (
        <input
          type="date"
          className="input entrada-form__text"
          value={l.caducidad}
          onChange={(e) => setLine(idx, { caducidad: e.target.value })}
        />
      ),
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
        <Button type="submit" variant="primary" disabled={!canSubmit}>
          {submitting ? <Spinner size={14} /> : `Registrar entrada${totales.lineasValidas ? ` (${totales.lineasValidas})` : ''}`}
        </Button>
      </div>
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
