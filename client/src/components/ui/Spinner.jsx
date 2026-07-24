import './Spinner.scss';

export function Spinner({ size = 18, label }) {
  return (
    <span className="spinner" role="status" aria-label={label || 'Cargando'}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle
          cx="12"
          cy="12"
          r="9"
          stroke="currentColor"
          strokeWidth="3"
          strokeOpacity="0.2"
        />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      {label && <span className="spinner__label">{label}</span>}
    </span>
  );
}
