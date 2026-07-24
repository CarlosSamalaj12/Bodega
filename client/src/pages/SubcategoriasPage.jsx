import { useEffect, useState } from 'react';
import { CatalogPage } from '@/components/shared/CatalogPage';
import api from '@/services/api';

export function SubcategoriasPage() {
  const [categorias, setCategorias] = useState([]);

  useEffect(() => {
    api.get('/api/categorias').then(({ data }) => setCategorias(data || []));
  }, []);

  return (
    <CatalogPage
      title="Subcategorías"
      endpoint="/api/subcategorias"
      entityName="Subcategoría"
      icon="◳"
      columns={[
        { key: 'nombre_subcategoria', label: 'Nombre' },
        { key: 'nombre_categoria', label: 'Categoría' },
        { key: 'activo', label: 'Estado', render: (r) => Number(r.activo) === 1 ? 'Activo' : 'Inactivo' },
      ]}
      formFields={{
        nombre_subcategoria: { label: 'Nombre', required: true, autoFocus: true },
        id_categoria: {
          label: 'Categoría',
          type: 'select',
          required: true,
          options: categorias.map((c) => ({ value: c.id_categoria, label: c.nombre_categoria })),
        },
        activo: { label: 'Estado', type: 'select', required: true, options: [{ value: 1, label: 'Activo' }, { value: 0, label: 'Inactivo' }] },
      }}
      toForm={(r) => ({
        nombre_subcategoria: r.nombre_subcategoria || '',
        id_categoria: r.id_categoria || '',
        activo: Number(r.activo) === 1 ? 1 : 0,
      })}
      toBody={(v) => ({
        nombre_subcategoria: v.nombre_subcategoria,
        id_categoria: Number(v.id_categoria),
        activo: Number(v.activo),
      })}
    />
  );
}
