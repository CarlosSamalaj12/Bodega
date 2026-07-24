import PropTypes from 'prop-types';

/**
 * Card — contenedor con efecto glass y slots header/body/footer
 */
export function Card({
  title,
  subtitle,
  actions,
  footer,
  hover = false,
  compact = false,
  accent = false,
  className = '',
  children,
  ...rest
}) {
  const classes = [
    'card',
    hover && 'card--hover',
    compact && 'card--compact',
    accent && 'card--accent',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const hasHeader = title || subtitle || actions;

  return (
    <div className={classes} {...rest}>
      {hasHeader && (
        <div className="card__header">
          <div>
            {title && <div className="card__title">{title}</div>}
            {subtitle && <div className="card__subtitle">{subtitle}</div>}
          </div>
          {actions && <div className="card__actions">{actions}</div>}
        </div>
      )}
      <div className="card__body">{children}</div>
      {footer && <div className="card__footer">{footer}</div>}
    </div>
  );
}

Card.propTypes = {
  title: PropTypes.node,
  subtitle: PropTypes.node,
  actions: PropTypes.node,
  footer: PropTypes.node,
  hover: PropTypes.bool,
  compact: PropTypes.bool,
  accent: PropTypes.bool,
  className: PropTypes.string,
  children: PropTypes.node,
};
