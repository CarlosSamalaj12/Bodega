import { useMemo, useState } from 'react';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { SearchInput } from '@/components/ui/SearchInput';
import { DataList } from '@/components/ui/DataList';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { toast } from '@/components/ui/Toast';
import api from '@/services/api';
import { useCatalog } from '@/hooks/useCatalog';
import { useForm } from '@/hooks/useForm';
import { useDebounce } from '@/hooks/useDebounce';
import './CatalogPage.scss';

const ID_KEYS = [
  'id',
  'id_categoria',
  'id_subcategoria',
  'id_proveedor',
  'id_bodega',
  'id_motivo',
  'id_medida',
];

function getRowId(row) {
  for (const k of ID_KEYS) {
    if (row?.[k] != null) return row[k];
  }
  return null;
}

/**
 * CatalogPage — página genérica para CRUD de catálogos.
 */
export function CatalogPage({
  title,
  endpoint,
  entityName,
  columns,
  formFields,
  toForm,
  toBody,
  mapRow,
  beforeDelete,
  icon = '◫',
  emptyMessage = 'No hay registros todavía.',
}) {
  const { items, loading, create, update, fetchAll } = useCatalog({
    endpoint, toForm, toBody, mapRow,
  });

  const isMobile = !useMediaQuery('(min-width: 768px)');

  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 300);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const empty = useMemo(() => {
    const obj = {};
    Object.keys(formFields).forEach((k) => { obj[k] = ''; });
    return obj;
  }, [formFields]);

  const {
    values, set, reset,
    errors, submitting, submitError,
    handleSubmit,
  } = useForm({
    initial: empty,
    onSubmit: async (vals) => {
      if (editingId) {
        await update(editingId, vals);
        toast.success(`${entityName} actualizada`);
      } else {
        await create(vals);
        toast.success(`${entityName} creada`);
      }
      setModalOpen(false);
    },
    validate: (vals) => {
      const errs = {};
      Object.entries(formFields).forEach(([k, f]) => {
        if (f.required && !String(vals[k] || '').trim()) {
          errs[k] = f.required === true ? 'Requerido' : f.required;
        }
      });
      return errs;
    },
  });

  const filtered = useMemo(() => {
    if (!debounced) return items;
    const q = debounced.toLowerCase();
    return items.filter((row) =>
      Object.values(row).some(
        (v) => v != null && String(v).toLowerCase().includes(q)
      )
    );
  }, [items, debounced]);

  const openCreate = () => {
    setEditingId(null);
    reset(empty);
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setEditingId(getRowId(row));
    reset(toForm ? toForm(row) : row);
    setModalOpen(true);
  };

  const handleDelete = async (row) => {
    if (beforeDelete) {
      const msg = beforeDelete(row);
      if (msg === false) return;
      if (typeof msg === 'string' && !window.confirm(msg)) return;
    } else {
      if (!window.confirm(`¿Eliminar este registro?`)) return;
    }
    try {
      await api.delete(`${endpoint}/${getRowId(row)}`);
      await fetchAll();
      toast.success('Eliminado');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'No se pudo eliminar');
    }
  };

  const handleToggleActivo = async (row) => {
    const next = Number(row.activo) === 1 ? 0 : 1;
    try {
      await update(getRowId(row), { ...row, activo: next });
      toast.success(next ? 'Activado' : 'Desactivado');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'No se pudo cambiar el estado');
    }
  };

  const renderRowActions = (row) => (
    <div className="catalog-page__row-actions">
      {row.activo !== undefined && (
        <Button
          size="sm"
          variant={Number(row.activo) === 1 ? 'subtle' : 'ghost'}
          onClick={() => handleToggleActivo(row)}
          title={Number(row.activo) === 1 ? 'Desactivar' : 'Activar'}
        >
          {Number(row.activo) === 1 ? 'Desactivar' : 'Activar'}
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={() => openEdit(row)}>
        Editar
      </Button>
      {endpoint === '/api/categorias' && (
        <Button size="sm" variant="ghost" onClick={() => handleDelete(row)}>
          Eliminar
        </Button>
      )}
    </div>
  );

  const dataColumns = [
    ...columns,
    {
      key: '__actions',
      label: 'Acciones',
      width: 240,
      align: 'right',
      hideOnMobile: true,
      render: isMobile ? () => null : renderRowActions,
    },
  ];

  return (
    <>
      <Header
        title={title}
        subtitle={`${filtered.length} registro${filtered.length === 1 ? '' : 's'}`}
        actions={
          <div className="catalog-page__actions">
            <Button size={isMobile ? 'sm' : 'md'} onClick={openCreate}>
              Nueva {entityName.toLowerCase()}
            </Button>
          </div>
        }
      />

      <div className="catalog-page">
        <Card>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={`Buscar ${entityName.toLowerCase()}…`}
          />
        </Card>

        <DataList
          columns={dataColumns}
          rows={filtered}
          loading={loading}
          keyFn={(row) => getRowId(row)}
          emptyTitle={search ? 'Sin resultados' : 'Sin registros'}
          emptyMessage={search ? 'Intenta con otros términos de búsqueda.' : emptyMessage}
          emptyAction={!search ? <Button onClick={openCreate}>Crear {entityName.toLowerCase()}</Button> : null}
          emptyIcon={icon}
          cardActions={isMobile ? renderRowActions : null}
        />
      </div>

      <Modal
        open={modalOpen}
        onClose={() => !submitting && setModalOpen(false)}
        title={editingId ? `Editar ${entityName.toLowerCase()}` : `Nueva ${entityName.toLowerCase()}`}
      >
        <form onSubmit={handleSubmit} className="catalog-page__form">
          {submitError && <div className="catalog-page__error">{submitError}</div>}

          {Object.entries(formFields).map(([k, f]) => (
            <div className="catalog-page__field" key={k}>
              <label className="catalog-page__label" htmlFor={`f-${k}`}>
                {f.label}
                {f.required && <span className="catalog-page__required"> *</span>}
              </label>
              {f.type === 'select' ? (
                <select
                  id={`f-${k}`}
                  className="select"
                  value={values[k] ?? ''}
                  onChange={(e) => set(k, e.target.value)}
                >
                  <option value="">{f.placeholder || 'Seleccionar…'}</option>
                  {(f.options || []).map((opt) => {
                    const v = typeof opt === 'object' ? opt.value : opt;
                    const lbl = typeof opt === 'object' ? opt.label : opt;
                    return <option key={v} value={v}>{lbl}</option>;
                  })}
                </select>
              ) : f.type === 'textarea' ? (
                <textarea
                  id={`f-${k}`}
                  className="textarea"
                  value={values[k] ?? ''}
                  onChange={(e) => set(k, e.target.value)}
                  placeholder={f.placeholder}
                  rows={f.rows || 3}
                />
              ) : (
                <input
                  id={`f-${k}`}
                  type={f.type || 'text'}
                  className="input"
                  value={values[k] ?? ''}
                  onChange={(e) => set(k, e.target.value)}
                  placeholder={f.placeholder}
                  autoFocus={f.autoFocus}
                />
              )}
              {errors[k] && <span className="catalog-page__field-error">{errors[k]}</span>}
              {f.hint && !errors[k] && <span className="catalog-page__field-hint">{f.hint}</span>}
            </div>
          ))}

          <div className="catalog-page__form-footer">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? <Spinner size={14} /> : editingId ? 'Guardar' : 'Crear'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
