import { CatalogPage } from '@/components/shared/CatalogPage';

export function MedidasPage() {
  return (
    <CatalogPage
      title="Medidas"
      endpoint="/api/medidas"
      entityName="Medida"
      icon="⊟"
      emptyMessage="Las medidas se administran desde la base de datos."
      columns={[
        { key: 'nombre_medida', label: 'Nombre' },
        { key: 'abreviatura', label: 'Abreviatura' },
        { key: 'activo', label: 'Estado', render: (r) => Number(r.activo) === 1 ? 'Activo' : 'Inactivo' },
      ]}
      formFields={{
        nombre_medida: { label: 'Nombre', required: true, autoFocus: true, placeholder: 'Ej. Kilogramo' },
        abreviatura: { label: 'Abreviatura', placeholder: 'Ej. kg' },
        activo: { label: 'Estado', type: 'select', required: true, options: [{ value: 1, label: 'Activo' }, { value: 0, label: 'Inactivo' }] },
      }}
      toForm={(r) => ({
        nombre_medida: r.nombre_medida || '',
        abreviatura: r.abreviatura || '',
        activo: Number(r.activo) === 1 ? 1 : 0,
      })}
    />
  );
}
