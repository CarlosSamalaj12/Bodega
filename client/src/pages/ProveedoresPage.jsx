import { CatalogPage } from '@/components/shared/CatalogPage';

export function ProveedoresPage() {
  return (
    <CatalogPage
      title="Proveedores"
      endpoint="/api/proveedores"
      entityName="Proveedor"
      icon="◊"
      columns={[
        { key: 'nombre_proveedor', label: 'Nombre' },
        { key: 'nit', label: 'NIT' },
        { key: 'telefono', label: 'Teléfono' },
        { key: 'correo', label: 'Correo' },
        { key: 'activo', label: 'Estado', render: (r) => Number(r.activo) === 1 ? 'Activo' : 'Inactivo' },
      ]}
      formFields={{
        nombre_proveedor: { label: 'Nombre', required: true, autoFocus: true },
        nit: { label: 'NIT', placeholder: 'Opcional' },
        telefono: { label: 'Teléfono', placeholder: 'Opcional' },
        correo: { label: 'Correo', type: 'email', placeholder: 'Opcional' },
        direccion: { label: 'Dirección', placeholder: 'Opcional' },
        contacto: { label: 'Contacto', placeholder: 'Opcional' },
        activo: { label: 'Estado', type: 'select', required: true, options: [{ value: 1, label: 'Activo' }, { value: 0, label: 'Inactivo' }] },
      }}
      toForm={(r) => ({
        nombre_proveedor: r.nombre_proveedor || '',
        nit: r.nit || '',
        telefono: r.telefono || '',
        correo: r.correo || '',
        direccion: r.direccion || '',
        contacto: r.contacto || '',
        activo: Number(r.activo) === 1 ? 1 : 0,
      })}
    />
  );
}
