import { CatalogPage } from '@/components/shared/CatalogPage';

const TIPO_OPCIONES = [
  { value: 'ENTRADA', label: 'Entrada' },
  { value: 'SALIDA', label: 'Salida' },
  { value: 'AJUSTE', label: 'Ajuste' },
  { value: 'TRANSFERENCIA', label: 'Transferencia' },
];

export function MotivosPage() {
  return (
    <CatalogPage
      title="Motivos de movimiento"
      endpoint="/api/motivos"
      entityName="Motivo"
      icon="◐"
      columns={[
        { key: 'nombre_motivo', label: 'Nombre' },
        { key: 'tipo_movimiento', label: 'Tipo' },
        { key: 'activo', label: 'Estado', render: (r) => Number(r.activo) === 1 ? 'Activo' : 'Inactivo' },
      ]}
      formFields={{
        nombre_motivo: { label: 'Nombre', required: true, autoFocus: true, placeholder: 'Ej. Compra a proveedor' },
        tipo_movimiento: { label: 'Tipo de movimiento', type: 'select', required: true, options: TIPO_OPCIONES },
        activo: { label: 'Estado', type: 'select', required: true, options: [{ value: 1, label: 'Activo' }, { value: 0, label: 'Inactivo' }] },
      }}
      toForm={(r) => ({
        nombre_motivo: r.nombre_motivo || '',
        tipo_movimiento: r.tipo_movimiento || 'ENTRADA',
        activo: Number(r.activo) === 1 ? 1 : 0,
      })}
      toBody={(v) => ({
        nombre_motivo: v.nombre_motivo,
        tipo_movimiento: v.tipo_movimiento,
        activo: Number(v.activo),
      })}
    />
  );
}
