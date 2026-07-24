import PropTypes from 'prop-types';
import './EmptyState.scss';

export function EmptyState({ title, message, action, icon = '◌' }) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon" aria-hidden="true">{icon}</div>
      <h3 className="empty-state__title">{title}</h3>
      {message && <p className="empty-state__message">{message}</p>}
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  );
}

EmptyState.propTypes = {
  title: PropTypes.node,
  message: PropTypes.node,
  action: PropTypes.node,
  icon: PropTypes.string,
};
