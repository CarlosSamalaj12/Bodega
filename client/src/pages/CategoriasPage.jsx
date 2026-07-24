import { CatalogPage } from '@/components/shared/CatalogPage';

export function CategoriasPage() {
  return (
    <CatalogPage
      title="Categorías"
      endpoint="/api/categorias"
      entityName="Categoría"
      icon="◫"
      columns={[
        { key: 'nombre_categoria', label: 'Nombre' },
        { key: 'activo', label: 'Estado', render: (r) => Number(r.activo) === 1 ? 'Activo' : 'Inactivo' },
      ]}
      formFields={{
        nombre_categoria: { label: 'Nombre', required: true, autoFocus: true, placeholder: 'Ej. Bebidas' },
        activo: { label: 'Estado', type: 'select', required: true, options: [{ value: 1, label: 'Activo' }, { value: 0, label: 'Inactivo' }] },
      }}
      toForm={(r) => ({ nombre_categoria: r.nombre_categoria || '', activo: Number(r.activo) === 1 ? 1 : 0 })}
      toBody={(v) => ({ nombre_categoria: v.nombre_categoria, activo: Number(v.activo) })}
    />
  );
}
