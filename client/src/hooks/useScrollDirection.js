import { useEffect, useState } from 'react';

/**
 * useScrollDirection
 * Detecta la dirección del scroll vertical del documento.
 *
 *   const dir = useScrollDirection({ threshold: 8 });
 *   // dir: 'up' | 'down' | 'idle'
 *
 * Opciones:
 *   - threshold: píxeles mínimos de movimiento para considerar cambio
 *     (evita disparar en micro-scrolls del trackpad).
 *   - initial: dirección inicial ('up' por defecto). Si estás en el top
 *     de la página, no debe empezar como 'down' ni ocultar el header.
 *
 * Estrategia: usa un único listener pasivo con rAF para evitar
 * re-renders innecesarios.
 */
export function useScrollDirection(options = {}) {
  const { threshold = 8, initial = 'up' } = options;
  const [direction, setDirection] = useState(initial);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    let lastY = window.scrollY;
    let ticking = false;

    const update = () => {
      const y = window.scrollY;
      const diff = y - lastY;
      // Cerca del top: siempre 'up' (header visible)
      if (y < 32) {
        setDirection('up');
      } else if (Math.abs(diff) >= threshold) {
        setDirection(diff > 0 ? 'down' : 'up');
      }
      lastY = y;
      ticking = false;
    };

    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    // Inicializar con el scrollY actual (puede que la página cargue ya scrolleada)
    update();

    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);

  return direction;
}
