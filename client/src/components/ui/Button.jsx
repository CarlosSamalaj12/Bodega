import PropTypes from 'prop-types';

/**
 * Button — botón base del sistema de diseño
 * Variantes: primary | secondary | ghost | danger | subtle
 * Tamaños:    sm | md | lg
 */
export function Button({
  variant = 'primary',
  size = 'md',
  iconOnly = false,
  block = false,
  type = 'button',
  className = '',
  children,
  ...rest
}) {
  const classes = [
    'btn',
    `btn--${variant}`,
    `btn--${size}`,
    iconOnly && 'btn--icon',
    block && 'btn--block',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}

Button.propTypes = {
  variant: PropTypes.oneOf(['primary', 'secondary', 'ghost', 'danger', 'subtle']),
  size: PropTypes.oneOf(['sm', 'md', 'lg']),
  iconOnly: PropTypes.bool,
  block: PropTypes.bool,
  type: PropTypes.oneOf(['button', 'submit', 'reset']),
  className: PropTypes.string,
  children: PropTypes.node,
};
