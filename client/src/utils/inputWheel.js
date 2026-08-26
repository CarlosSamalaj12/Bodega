/**
 * Evita que la rueda del mouse cambie el valor de los inputs numéricos
 * (`type="number"`) al hacer scroll sobre ellos — comportamiento nativo del
 * navegador que provoca cambios accidentales de cantidad/precio (el clásico
 * "scrolleé y se cambió el 5 por un 6").
 *
 * El nativo solo incrementa/decrementa mientras el input tiene el foco, así
 * que al hacer scroll sobre el campo enfocado se le quita el foco. Después el
 * usuario vuelve a hacer clic para seguir escribiendo.
 *
 * Uso: `<input type="number" onWheel={preventNumberWheel} ... />`
 */
export function preventNumberWheel(e) {
  if (document.activeElement === e.currentTarget) {
    e.currentTarget.blur();
  }
}
