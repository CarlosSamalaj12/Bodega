import { CatalogPage } from '@/components/shared/CatalogPage';

const TIPO_BODEGA = [
  { value: 'PRINCIPAL', label: 'Principal' },
  { value: 'RECEPTORA', label: 'Receptora' },
  { value: 'OPERATIVA', label: 'Operativa' },
];

export function BodegasPage() {
  return (
    <CatalogPage
      title="Bodegas"
      endpoint="/api/bodegas"
      entityName="Bodega"
      icon="⬚"
      columns={[
        { key: 'nombre_bodega', label: 'Nombre' },
        { key: 'tipo_bodega', label: 'Tipo' },
        { key: 'direccion', label: 'Dirección' },
        { key: 'activo', label: 'Estado', render: (r) => Number(r.activo) === 1 ? 'Activo' : 'Inactivo' },
      ]}
      formFields={{
        nombre_bodega: { label: 'Nombre', required: true, autoFocus: true, placeholder: 'Ej. Bodega Central' },
        tipo_bodega: { label: 'Tipo', type: 'select', required: true, options: TIPO_BODEGA },
        direccion: { label: 'Dirección' },
        telefono: { label: 'Teléfono' },
        activo: { label: 'Estado', type: 'select', required: true, options: [{ value: 1, label: 'Activo' }, { value: 0, label: 'Inactivo' }] },
      }}
      toForm={(r) => ({
        nombre_bodega: r.nombre_bodega || '',
        tipo_bodega: r.tipo_bodega || 'OPERATIVA',
        direccion: r.direccion || '',
        telefono: r.telefono || '',
        activo: Number(r.activo) === 1 ? 1 : 0,
      })}
    />
  );
}
