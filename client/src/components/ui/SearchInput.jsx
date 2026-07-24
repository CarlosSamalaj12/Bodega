import { useId, useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import './SearchInput.scss';

export function SearchInput({
  value,
  onChange,
  placeholder = 'Buscar…',
  delay = 0,
  className = '',
  autoFocus = false,
}) {
  const id = useId();
  const [local, setLocal] = useState(value || '');

  // Mantener sincronizado si el padre cambia el valor externamente
  useEffect(() => {
    setLocal(value || '');
  }, [value]);

  // Debounceo de la propagación hacia el padre
  useEffect(() => {
    if (delay <= 0) return;
    const t = setTimeout(() => onChange?.(local), delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local, delay]);

  const handleChange = (e) => {
    const v = e.target.value;
    setLocal(v);
    if (delay <= 0) onChange?.(v);
  };

  const handleClear = () => {
    setLocal('');
    onChange?.('');
  };

  return (
    <div className={`search-input ${className}`}>
      <span className="search-input__icon" aria-hidden="true">⌕</span>
      <input
        id={id}
        type="search"
        className="search-input__field"
        value={local}
        onChange={handleChange}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
      {local && (
        <button
          type="button"
          className="search-input__clear"
          onClick={handleClear}
          aria-label="Limpiar"
        >✕</button>
      )}
    </div>
  );
}

SearchInput.propTypes = {
  value: PropTypes.string,
  onChange: PropTypes.func,
  placeholder: PropTypes.string,
  delay: PropTypes.number,
  className: PropTypes.string,
  autoFocus: PropTypes.bool,
};
