import PropTypes from 'prop-types';

export function Badge({ variant = 'default', children, className = '', ...rest }) {
  const classes = ['badge', variant !== 'default' && `badge--${variant}`, className]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={classes} {...rest}>
      {children}
    </span>
  );
}

Badge.propTypes = {
  variant: PropTypes.oneOf(['default', 'success', 'warning', 'danger', 'info', 'accent']),
  children: PropTypes.node,
  className: PropTypes.string,
};
