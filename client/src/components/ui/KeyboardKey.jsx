import PropTypes from 'prop-types';
import { formatComboBadge, formatComboForDisplay } from '@/utils/shortcuts';

/**
 * KeyboardKey
 * Renderiza un combo de teclas en formato "badge" estilo teclado.
 *  - variant: 'inline' (por defecto, se usa en tooltips)
 *             'block'  (badge más grande para la ayuda / configuración)
 *  - combo:   string en formato canónico ("Ctrl+Shift+K", "F3", etc.)
 */
export function KeyboardKey({ combo, variant = 'inline', title }) {
  const display = variant === 'block'
    ? formatComboForDisplay(combo)
    : formatComboBadge(combo);
  if (!display) return null;
  return (
    <kbd
      className={`kbd kbd--${variant}`}
      title={title || combo}
    >
      {display}
    </kbd>
  );
}

KeyboardKey.propTypes = {
  combo: PropTypes.string,
  variant: PropTypes.oneOf(['inline', 'block']),
  title: PropTypes.string,
};

/**
 * ShortcutHint
 * Texto pequeño que se muestra junto a un botón para indicar el atajo.
 * Ej: "Registrar entrada (F3)" o solo el badge.
 */
export function ShortcutHint({ combo, children }) {
  if (!combo) return children || null;
  return (
    <span className="shortcut-hint">
      {children}
      <KeyboardKey combo={combo} />
    </span>
  );
}

ShortcutHint.propTypes = {
  combo: PropTypes.string,
  children: PropTypes.node,
};
