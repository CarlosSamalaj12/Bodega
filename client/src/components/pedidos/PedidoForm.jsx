import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { ProductPicker } from '@/components/ui/ProductPicker';
import { LinesEditor } from '@/components/ui/LinesEditor';
import { Spinner } from '@/components/ui/Spinner';
import { Modal } from '@/components/ui/Modal';
import { KeyboardKey, ShortcutHint } from '@/components/ui/KeyboardKey';
import { Shortcuts } from '@/hooks/useShortcut.jsx';
import { useShortcutsStore } from '@/stores/shortcuts.store';
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
const EMPTY_CABECERA = {
  requested_from_warehouse_id: '',
  notes: '',
  requester_pin: '',
};

export function PedidoForm({
  open,
  onClose,
  user,
  bodegas = [],
  loadingCatalogs = false,
  catalogError = null,
  onRetryCatalog,
  onCreated,
}) {
  const [cabecera, setCabecera] = useState(EMPTY_CABECERA);
  const [lines, setLines] = useState([{ ...EMPTY_LINE }]);
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const formRef = useRef(null);
  const linesContainerRef = useRef(null);

  // Reset al abrir el modal para que cada pedido empiece limpio
  useEffect(() => {
    if (open) {
      setCabecera(EMPTY_CABECERA);
      setLines([{ ...EMPTY_LINE }]);
      setSubmitError(null);
      setSubmitting(false);
    }
  }, [open]);

  const setCab = (k, v) => setCabecera((p) => ({ ...p, [k]: v }));
  const setLine = (idx, patch) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };
  const addLine = () => {
    setLines((prev) => [...prev, { ...EMPTY_LINE }]);
    // Auto-scroll al final del contenedor de líneas para que se vea la nueva
    requestAnimationFrame(() => {
      const el = linesContainerRef.current;
      if (el) {
        try { el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); }
        catch { el.scrollTop = el.scrollHeight; }
      }
    });
  };
  const removeLine = (idx) => {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));
  };

  const totales = useMemo(() => {
    let lineasValidas = 0;
    let unidadesTotales = 0;
    for (const l of lines) {
      const cant = Number(l.cantidad);
      if (cant > 0) {
        lineasValidas += 1;
        unidadesTotales += cant;
      }
    }
    return { lineasValidas, unidadesTotales };
  }, [lines]);

  const canSubmit =
    !submitting &&
    !!cabecera.requested_from_warehouse_id &&
    cabecera.requester_pin.length >= 6 &&
    lines.some((l) => l.id_producto && Number(l.cantidad) > 0);

  const handleSubmit = async (e) => {
    e?.preventDefault();
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

    setSubmitting(true);
    try {
      const data = await pedidosService.create(payload);
      toast.success(`Pedido #${data.id_pedido || ''} creado`);
      onCreated?.(data);
    } catch (err) {
      const msg = err?.response?.data?.error || 'No se pudo crear el pedido';
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitClick = () => {
    // El botón está fuera del form, así que disparamos el submit programáticamente
    formRef.current?.requestSubmit();
  };

  const handleClose = () => {
    if (submitting) return;
    onClose?.();
  };

  // -------- Atajos de teclado (F3 guardar, F1 agregar línea, etc.) ---------
  const getCombo = useShortcutsStore((s) => s.getCombo);
  const saveCombo = getCombo('form.save');
  const saveCtrlCombo = getCombo('form.saveCtrl');
  const addLineCombo = getCombo('form.addLine');
  const cancelCombo = getCombo('form.cancel');
  const focusProductCombo = getCombo('form.focusProduct');

  const handleSaveShortcut = useCallback(() => {
    if (submitting) return;
    if (!canSubmit) {
      handleSubmit({ preventDefault: () => {} });
      return;
    }
    handleSubmitClick();
  }, [submitting, canSubmit, handleSubmit, handleSubmitClick]);

  const handleAddLineShortcut = useCallback(() => {
    if (submitting) return;
    addLine();
  }, [submitting, addLine]);

  const handleCancelShortcut = useCallback(() => {
    if (submitting) return;
    onClose?.();
  }, [submitting, onClose]);

  const handleFocusProductShortcut = useCallback(() => {
    // El form del pedido es un <form> con id="pedido-form"
    const form = document.getElementById('pedido-form');
    if (!form) return;
    const input = form.querySelector('input[placeholder^="Buscar producto"]');
    if (input && typeof input.focus === 'function') input.focus();
  }, []);

  // El Shortcuts solo se monta cuando el modal está abierto (`open`).
  const formShortcuts = open ? (
    <Shortcuts
      map={{
        'form.save': { handler: handleSaveShortcut, scope: 'form' },
        'form.saveCtrl': { handler: handleSaveShortcut, scope: 'form' },
        'form.addLine': { handler: handleAddLineShortcut, scope: 'form' },
        'form.cancel': { handler: handleCancelShortcut, scope: 'form', ignoreInputs: false },
        'form.focusProduct': { handler: handleFocusProductShortcut, scope: 'form', ignoreInputs: false },
      }}
    />
  ) : null;

  const columns = [
    {
      key: 'producto',
      label: 'Producto',
      primary: true,
      minWidth: 240,
      render: (l, idx) => (
        <ProductPicker
          value={
            l.id_producto
              ? { id_producto: l.id_producto, nombre_producto: l.nombre_producto, sku: l.sku }
              : null
          }
          onChange={(p) =>
            setLine(idx, {
              id_producto: p?.id_producto || null,
              nombre_producto: p?.nombre_producto || '',
              sku: p?.sku || null,
            })
          }
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
          step="0.001"
          inputMode="decimal"
          value={l.cantidad}
          onChange={(e) => {
            // Permitimos números decimales (ej. 1.5, 1.25). El navegador
            // ya bloquea caracteres no numéricos con type="number" +
            // step="0.001", así que no hace falta sanear la cadena.
            setLine(idx, { cantidad: e.target.value });
          }}
          placeholder="0"
        />
      ),
    },
    {
      key: 'nota',
      label: 'Observación',
      minWidth: 200,
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

  // Footer sticky: vive en el slot del Modal, no scrollea con el body
  const footer = (
    <div className="pedido-form__footer pedido-form__footer--sticky">
      <div className="pedido-form__footer-info">
        <span
          className={`pedido-form__footer-count${totales.lineasValidas > 0 ? ' pedido-form__footer-count--active' : ''}`}
        >
          {totales.lineasValidas} línea{totales.lineasValidas === 1 ? '' : 's'} válida
          {totales.lineasValidas === 1 ? '' : 's'}
        </span>
        {totales.unidadesTotales > 0 && (
          <span className="pedido-form__footer-units">
            · {totales.unidadesTotales} unidade{totales.unidadesTotales === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <div className="pedido-form__footer-actions">
        <Button
          type="button"
          variant="ghost"
          onClick={handleClose}
          disabled={submitting}
          title={cancelCombo ? `Cancelar (${cancelCombo})` : 'Cancelar'}
        >
          Cancelar
          {cancelCombo && <KeyboardKey combo={cancelCombo} />}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={addLine}
          disabled={submitting}
          title={addLineCombo ? `Agregar otra línea al pedido (${addLineCombo})` : 'Agregar otra línea al pedido'}
        >
          + Agregar línea
          {addLineCombo && <KeyboardKey combo={addLineCombo} />}
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={handleSubmitClick}
          disabled={!canSubmit}
          title={saveCombo ? `Enviar pedido (${saveCombo}${saveCtrlCombo ? ` o ${saveCtrlCombo}` : ''})` : 'Enviar pedido'}
        >
          {submitting ? <Spinner size={14} /> : (
            <ShortcutHint combo={saveCombo}>
              {`Enviar pedido${totales.lineasValidas ? ` (${totales.lineasValidas})` : ''}`}
            </ShortcutHint>
          )}
        </Button>
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Nuevo pedido"
      size="xl"
      footer={footer}
    >
      {formShortcuts}
      {submitError && <div className="pedido-form__error">{submitError}</div>}

      {catalogError ? (
        <div className="pedido-form__catalog-error">
          <p><strong>No se pudieron cargar las bodegas.</strong></p>
          <p className="pedido-form__catalog-error-detail">{catalogError}</p>
          {onRetryCatalog && (
            <Button variant="subtle" onClick={onRetryCatalog}>Reintentar</Button>
          )}
        </div>
      ) : loadingCatalogs ? (
        <div className="pedido-form__loading">
          <Spinner size={18} label="Cargando bodegas…" />
        </div>
      ) : (
        <form
          ref={formRef}
          className="pedido-form"
          onSubmit={handleSubmit}
          id="pedido-form"
        >
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
                      ['PRINCIPAL', 'RECEPTORA'].includes(
                        String(b.tipo_bodega || '').toUpperCase()
                      )
                    )
                    .map((b) => ({
                      value: b.id_bodega,
                      label: `${b.nombre_bodega} (${b.tipo_bodega})`,
                    })),
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
            <div ref={linesContainerRef} className="pedido-form__lines">
              <LinesEditor
                lines={lines}
                columns={columns}
                onAdd={addLine}
                onRemove={removeLine}
                canRemove={() => lines.length > 1}
                addLabel="+ Agregar línea"
              />
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}

PedidoForm.propTypes = {
  open: PropTypes.bool,
  onClose: PropTypes.func,
  user: PropTypes.object,
  bodegas: PropTypes.array,
  loadingCatalogs: PropTypes.bool,
  catalogError: PropTypes.any,
  onRetryCatalog: PropTypes.func,
  onCreated: PropTypes.func,
};
