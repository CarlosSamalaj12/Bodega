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
  collapsible = false,
  defaultOpen = true,
  className = '',
  children,
  ...rest
}) {
  const classes = [
    'card',
    hover && 'card--hover',
    compact && 'card--compact',
    accent && 'card--accent',
    collapsible && 'card--collapsible',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const hasHeader = title || subtitle || actions;

  if (collapsible) {
    return (
      <details className={classes} {...rest} open={defaultOpen}>
        {hasHeader && (
          <summary className="card__header card__header--summary">
            <div>
              {title && <div className="card__title">{title}</div>}
              {subtitle && <div className="card__subtitle">{subtitle}</div>}
            </div>
            {actions && <div className="card__actions">{actions}</div>}
          </summary>
        )}
        <div className="card__body">{children}</div>
        {footer && <div className="card__footer">{footer}</div>}
      </details>
    );
  }

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
  collapsible: PropTypes.bool,
  defaultOpen: PropTypes.bool,
  className: PropTypes.string,
  children: PropTypes.node,
};
