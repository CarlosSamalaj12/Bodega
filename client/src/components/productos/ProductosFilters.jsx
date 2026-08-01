import PropTypes from 'prop-types';
import { SearchInput } from '@/components/ui/SearchInput';
import { Select } from '@/components/ui/Select';
import './ProductosFilters.scss';

export function ProductosFilters({
  search,
  onSearchChange,
  showInactive,
  onShowInactiveChange,
  categoriaId,
  onCategoriaChange,
  categorias = [],
  subcategoriaId,
  onSubcategoriaChange,
  subcategorias = [],
  medidaId,
  onMedidaChange,
  medidas = [],
}) {
  return (
    <div className="productos-filters">
      <SearchInput
        value={search}
        onChange={onSearchChange}
        placeholder="Buscar por nombre o SKU…"
        className="productos-filters__search"
      />

      <Select
        value={categoriaId || ''}
        onChange={(e) => onCategoriaChange(e.target.value ? Number(e.target.value) : null)}
        options={[
          { value: '', label: 'Todas las categorías' },
          ...categorias.map((c) => ({ value: c.id_categoria, label: c.nombre_categoria })),
        ]}
      />

      <Select
        value={subcategoriaId || ''}
        onChange={(e) => onSubcategoriaChange(e.target.value ? Number(e.target.value) : null)}
        options={[
          { value: '', label: 'Todas las subcategorías' },
          ...subcategorias.map((s) => ({
            value: s.id_subcategoria,
            label: s.nombre_subcategoria,
          })),
        ]}
        disabled={subcategorias.length === 0}
      />

      <Select
        value={medidaId || ''}
        onChange={(e) => onMedidaChange(e.target.value ? Number(e.target.value) : null)}
        options={[
          { value: '', label: 'Todas las medidas' },
          ...medidas.map((m) => ({ value: m.id_medida, label: m.nombre_medida })),
        ]}
      />

      <label className="productos-filters__toggle">
        <input
          type="checkbox"
          checked={showInactive}
          onChange={(e) => onShowInactiveChange(e.target.checked)}
        />
        <span>Mostrar inactivos</span>
      </label>
    </div>
  );
}

ProductosFilters.propTypes = {
  search: PropTypes.string,
  onSearchChange: PropTypes.func,
  showInactive: PropTypes.bool,
  onShowInactiveChange: PropTypes.func,
  categoriaId: PropTypes.number,
  onCategoriaChange: PropTypes.func,
  categorias: PropTypes.array,
  subcategoriaId: PropTypes.number,
  onSubcategoriaChange: PropTypes.func,
  subcategorias: PropTypes.array,
  medidaId: PropTypes.number,
  onMedidaChange: PropTypes.func,
  medidas: PropTypes.array,
};
