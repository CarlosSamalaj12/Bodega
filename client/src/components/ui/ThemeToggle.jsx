import { useThemeStore } from '@/stores/theme.store';
import './ThemeToggle.scss';

export function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggle);
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
      title={isDark ? 'Tema claro' : 'Tema oscuro'}
    >
      <span className="theme-toggle__track">
        <span className={`theme-toggle__thumb ${isDark ? '' : 'theme-toggle__thumb--light'}`}>
          {isDark ? '🌙' : '☀'}
        </span>
      </span>
    </button>
  );
}
