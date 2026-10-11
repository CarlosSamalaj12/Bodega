import PropTypes from 'prop-types';
import { Inbox } from 'lucide-react';
import './EmptyState.scss';

export function EmptyState({ title, message, action, icon }) {
  const renderedIcon = icon && typeof icon !== 'string' ? icon : (
    <Inbox size={36} strokeWidth={1.5} aria-hidden="true" />
  );

  return (
    <div className="empty-state">
      <div className="empty-state__icon" aria-hidden="true">{renderedIcon}</div>
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
  icon: PropTypes.node,
};
