import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import './ProductoForm.scss';

const EMPTY = {
  nombre_producto: '',
  sku: '',
  id_medida: '',
  id_categoria: '',
  id_subcategoria: '',
  activo: 1,
  id_bodegas_visibles: [],
};

/**
 * Construye el valor inicial de `id_bodegas_visibles` para un producto nuevo.
 * - Si el usuario tiene una bodega por defecto y esa bodega está activa
 *   → preselecciona SOLO esa bodega (comportamiento "Mi bodega" al crear).
 * - Si no hay default o la bodega no está activa → array vacío = "Todas".
 */
function buildInitialVisibilidad(defaultBodegaId, bodegas) {
  const def = Number(defaultBodegaId || 0);
  if (!def) return [];
  const existe = (bodegas || []).some((b) => Number(b.id_bodega) === def && Number(b.activo) === 1);
  return existe ? [def] : [];
}

export function ProductoForm({
  initial = null,
  categorias = [],
  subcategorias = [],
  medidas = [],
  bodegas = [],
  defaultBodegaId = null,
  onSubmit,
  onCancel,
  submitting = false,
  error = null,
}) {
  const [values, setValues] = useState(EMPTY);
  const isEdit = Boolean(initial?.id_producto);

  useEffect(() => {
    if (initial) {
      setValues({
        nombre_producto: initial.nombre_producto || '',
        sku: initial.sku || '',
        id_medida: initial.id_medida || '',
        id_categoria: initial.id_categoria || '',
        id_subcategoria: initial.id_subcategoria || '',
        activo: Number(initial.activo) === 1 ? 1 : 0,
        id_bodegas_visibles: initial.id_bodegas_visibles || [],
      });
    } else {
      setValues({
        ...EMPTY,
        id_bodegas_visibles: buildInitialVisibilidad(defaultBodegaId, bodegas),
      });
    }
  }, [initial, defaultBodegaId, bodegas]);

  // Subcategorías filtradas por categoría
  const subcategoriasFiltradas = values.id_categoria
    ? subcategorias.filter((s) => Number(s.id_categoria) === Number(values.id_categoria))
    : [];

  const set = (k, v) => setValues((prev) => ({ ...prev, [k]: v }));

  const toggleBodega = (id) => {
    setValues((prev) => {
      const list = new Set(prev.id_bodegas_visibles);
      if (list.has(id)) list.delete(id);
      else list.add(id);
      return { ...prev, id_bodegas_visibles: [...list] };
    });
  };

  // ── Acciones masivas sobre bodegas visibles ──
  const selectAllBodegas = () => {
    set('id_bodegas_visibles', bodegas.map((b) => Number(b.id_bodega)).filter(Boolean));
  };
  const clearAllBodegas = () => set('id_bodegas_visibles', []);
  const selectOnlyDefaultBodega = () => {
    const def = Number(defaultBodegaId || 0);
    if (!def) return;
    set('id_bodegas_visibles', [def]);
  };

  // ── Estado derivado para los botones bulk ──
  const allSelected =
    bodegas.length > 0 &&
    bodegas.every((b) => values.id_bodegas_visibles.includes(Number(b.id_bodega)));
  const noneSelected = values.id_bodegas_visibles.length === 0;
  const hasDefaultBodega = Number(defaultBodegaId || 0) > 0;
  const defaultBodegaNombre = hasDefaultBodega
    ? bodegas.find((b) => Number(b.id_bodega) === Number(defaultBodegaId))?.nombre_bodega
    : null;

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit?.({
      ...values,
      id_medida: Number(values.id_medida),
      id_categoria: Number(values.id_categoria),
      id_subcategoria: values.id_subcategoria ? Number(values.id_subcategoria) : null,
      id_bodegas_visibles: values.id_bodegas_visibles,
    });
  };

  return (
    <form className="producto-form" onSubmit={handleSubmit}>
      {error && <div className="producto-form__error">{error}</div>}

      <div className="producto-form__row">
        <Input
          label="Nombre del producto"
          value={values.nombre_producto}
          onChange={(e) => set('nombre_producto', e.target.value)}
          required
          autoFocus
          placeholder="Ej. Harina de trigo"
        />
        <Input
          label="SKU"
          value={values.sku}
          onChange={(e) => set('sku', e.target.value)}
          placeholder="Opcional"
          hint="Código único interno"
        />
      </div>

      <div className="producto-form__row">
        <Select
          label="Categoría"
          value={values.id_categoria}
          onChange={(e) => {
            set('id_categoria', e.target.value);
            set('id_subcategoria', '');
          }}
          options={[
            { value: '', label: 'Seleccionar…' },
            ...categorias.map((c) => ({ value: c.id_categoria, label: c.nombre_categoria })),
          ]}
        />
        <Select
          label="Subcategoría"
          value={values.id_subcategoria}
          onChange={(e) => set('id_subcategoria', e.target.value)}
          options={[
            { value: '', label: 'Sin subcategoría' },
            ...subcategoriasFiltradas.map((s) => ({ value: s.id_subcategoria, label: s.nombre_subcategoria })),
          ]}
          disabled={subcategoriasFiltradas.length === 0}
        />
        <Select
          label="Medida"
          value={values.id_medida}
          onChange={(e) => set('id_medida', e.target.value)}
          options={[
            { value: '', label: 'Seleccionar…' },
            ...medidas.map((m) => ({ value: m.id_medida, label: m.nombre_medida })),
          ]}
        />
      </div>

      <div className="producto-form__field">
        <label className="producto-form__label">Visibilidad por bodega</label>
        <p className="producto-form__hint">
          {hasDefaultBodega && !isEdit
            ? `Por defecto, al crear un producto se asigna a tu bodega${defaultBodegaNombre ? ` (${defaultBodegaNombre})` : ''}. Si deseleccionas todas, el producto será visible en todas las bodegas activas.`
            : 'Si no seleccionas ninguna, el producto será visible en todas las bodegas activas.'}
        </p>

        <div className="producto-form__bulk">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={selectAllBodegas}
            disabled={allSelected || bodegas.length === 0}
            title="Marcar todas las bodegas como visibles"
          >
            Todas
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={clearAllBodegas}
            disabled={noneSelected}
            title="Deseleccionar todas las bodegas (visible en todas)"
          >
            Ninguna
          </Button>
          {hasDefaultBodega && (
            <Button
              type="button"
              size="sm"
              variant="subtle"
              onClick={selectOnlyDefaultBodega}
              title={`Dejar visible solo en tu bodega${defaultBodegaNombre ? ` (${defaultBodegaNombre})` : ''}`}
            >
              Mi bodega{defaultBodegaNombre ? `: ${defaultBodegaNombre}` : ''}
            </Button>
          )}
          <span className="producto-form__bulk-count">
            {values.id_bodegas_visibles.length === 0
              ? 'Todas las bodegas'
              : `${values.id_bodegas_visibles.length} de ${bodegas.length}`}
          </span>
        </div>

        <div className="producto-form__bodegas">
          {bodegas.length === 0 && (
            <span className="producto-form__muted">No hay bodegas activas.</span>
          )}
          {bodegas.map((b) => {
            const checked = values.id_bodegas_visibles.includes(b.id_bodega);
            return (
              <label key={b.id_bodega} className="producto-form__bodega-item">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleBodega(b.id_bodega)}
                />
                <span>{b.nombre_bodega}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="producto-form__field">
        <label className="producto-form__toggle">
          <input
            type="checkbox"
            checked={Number(values.activo) === 1}
            onChange={(e) => set('activo', e.target.checked ? 1 : 0)}
          />
          <span>Producto activo</span>
        </label>
      </div>

      <div className="producto-form__footer">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? <Spinner size={14} /> : isEdit ? 'Guardar cambios' : 'Crear producto'}
        </Button>
      </div>
    </form>
  );
}

ProductoForm.propTypes = {
  initial: PropTypes.object,
  categorias: PropTypes.array,
  subcategorias: PropTypes.array,
  medidas: PropTypes.array,
  bodegas: PropTypes.array,
  defaultBodegaId: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  onSubmit: PropTypes.func,
  onCancel: PropTypes.func,
  submitting: PropTypes.bool,
  error: PropTypes.string,
};
