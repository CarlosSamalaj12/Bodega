import { useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { ProductPicker } from '@/components/ui/ProductPicker';
import { LinesEditor } from '@/components/ui/LinesEditor';
import { Spinner } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/Toast';
import { pedidosService } from '@/services/pedidos.service';
import './PedidoForm.scss';

const EMPTY_LINE = {
  id_producto: null,
  nombre_producto: '',
  sku: null,
  cantidad: '',
  nota: '',
};

export function PedidoForm({
  bodegas = [],
  user,
  submitting = false,
  onSubmittingChange,
  onCreated,
  onCancel,
}) {
  const [cabecera, setCabecera] = useState({
    requested_from_warehouse_id: '',
    notes: '',
    requester_pin: '',
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
    let lineasValidas = 0;
    for (const l of lines) {
      if (Number(l.cantidad) > 0) lineasValidas += 1;
    }
    return { lineasValidas };
  }, [lines]);

  const canSubmit =
    cabecera.requested_from_warehouse_id &&
    cabecera.requester_pin.length >= 6 &&
    lines.some((l) => l.id_producto && Number(l.cantidad) > 0) &&
    !submitting;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError(null);

    const payload = {
      requested_from_warehouse_id: Number(cabecera.requested_from_warehouse_id),
      notes: cabecera.notes.trim() || null,
      requester_user_id: Number(user?.id_user || 0),
      requester_pin: cabecera.requester_pin,
      lines: lines
        .filter((l) => l.id_producto && Number(l.cantidad) > 0)
        .map((l) => ({
          id_product: l.id_producto,
          qty_requested: Number(l.cantidad),
          line_note: l.nota.trim() || null,
        })),
    };

    if (payload.lines.length === 0) {
      setSubmitError('Agrega al menos una línea con producto y cantidad mayor a 0.');
      return;
    }

    onSubmittingChange?.(true);
    try {
      const data = await pedidosService.create(payload);
      toast.success(`Pedido #${data.id_pedido || ''} creado`);
      onCreated?.(data);
    } catch (e) {
      const msg = e?.response?.data?.error || 'No se pudo crear el pedido';
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
          className="input pedido-form__num"
          min="0"
          step="1"
          pattern="[0-9]*"
          value={l.cantidad}
          onChange={(e) => {
            const v = e.target.value.replace(/[^\d]/g, '');
            setLine(idx, { cantidad: v });
          }}
          placeholder="0"
        />
      ),
    },
    {
      key: 'nota',
      label: 'Observación',
      minWidth: 200,
      // En móvil, observación ocupa toda la fila debajo del producto
      mobileFullWidth: true,
      render: (l, idx) => (
        <input
          type="text"
          className="input pedido-form__text"
          value={l.nota}
          onChange={(e) => setLine(idx, { nota: e.target.value })}
          placeholder="Ej. urgente, marca X, etc."
        />
      ),
    },
  ];

  return (
    <form className="pedido-form" onSubmit={handleSubmit}>
      {submitError && <div className="pedido-form__error">{submitError}</div>}

      <div className="pedido-form__section">
        <h3 className="pedido-form__section-title">Cabecera</h3>

        <div className="pedido-form__row">
          <Select
            label="Bodega a la que pides"
            value={cabecera.requested_from_warehouse_id}
            onChange={(e) => setCab('requested_from_warehouse_id', e.target.value)}
            options={[
              { value: '', label: 'Seleccionar bodega…' },
              ...bodegas
                .filter((b) =>
                  ['PRINCIPAL', 'RECEPTORA'].includes(String(b.tipo_bodega || '').toUpperCase())
                )
                .map((b) => ({ value: b.id_bodega, label: `${b.nombre_bodega} (${b.tipo_bodega})` })),
            ]}
            required
          />
          <Input
            label="PIN de pedidos"
            type="text"
            style={{ WebkitTextSecurity: 'disc' }}
            autoComplete="new-password"
            inputMode="numeric"
            pattern="[0-9]*"
            value={cabecera.requester_pin}
            onChange={(e) => setCab('requester_pin', e.target.value.replace(/\D/g, ''))}
            placeholder="6-12 dígitos"
            hint="PIN configurado en tu perfil"
            required
          />
        </div>

        <Input
          label="Observaciones"
          value={cabecera.notes}
          onChange={(e) => setCab('notes', e.target.value)}
          placeholder="Notas para el surtidor"
        />

        {user?.bodega_nombre && (
          <div className="pedido-form__bodega">
            <span className="pedido-form__bodega-label">Tu bodega:</span>
            <strong>{user.bodega_nombre}</strong>
          </div>
        )}
      </div>

      <div className="pedido-form__section">
        <h3 className="pedido-form__section-title">Líneas del pedido</h3>

        <LinesEditor
          lines={lines}
          columns={columns}
          onAdd={addLine}
          onRemove={removeLine}
          canRemove={() => lines.length > 1}
        />
      </div>

      <div className="pedido-form__footer">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" disabled={!canSubmit}>
          {submitting ? <Spinner size={14} /> : `Enviar pedido${totales.lineasValidas ? ` (${totales.lineasValidas})` : ''}`}
        </Button>
      </div>
    </form>
  );
}

PedidoForm.propTypes = {
  bodegas: PropTypes.array,
  user: PropTypes.object,
  submitting: PropTypes.bool,
  onSubmittingChange: PropTypes.func,
  onCreated: PropTypes.func,
  onCancel: PropTypes.func,
};
