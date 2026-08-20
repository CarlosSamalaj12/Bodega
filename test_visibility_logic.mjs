// Simulate the API logic for a bodega-filtered search

// Test cases:
// Producto 1: NO rules at all → visible everywhere
// Producto 2: enabled in bodega 5 only
// Producto 3: enabled in bodega 7 only
// Producto 4: enabled in bodega 5 and bodega 7
// Producto 5: DISABLED in bodega 5, enabled in bodega 7

const products = [
  { id: 1, name: 'A (sin reglas)', rules: [] },
  { id: 2, name: 'B (solo bodega 5)', rules: [{ bodega: 5, visible: 1 }] },
  { id: 3, name: 'C (solo bodega 7)', rules: [{ bodega: 7, visible: 1 }] },
  { id: 4, name: 'D (bodega 5 y 7)', rules: [{ bodega: 5, visible: 1 }, { bodega: 7, visible: 1 }] },
  { id: 5, name: 'E (deshabilitado en 5, habilitado en 7)', rules: [{ bodega: 5, visible: 0 }, { bodega: 7, visible: 1 }] },
];

function isVisible(product, id_bodega) {
  // (1) id_bodega IS NULL → show all (admin / sin filtro)
  if (id_bodega == null) return true;
  // (2) NOT EXISTS rules → show (producto sin reglas, visible en todas)
  if (product.rules.length === 0) return true;
  // (3) EXISTS rule for this bodega with visible=1
  return product.rules.some(r => r.bodega === id_bodega && r.visible === 1);
}

function list(id_bodega) {
  return products.filter(p => isVisible(p, id_bodega)).map(p => p.name);
}

function check(label, expected, id_bodega) {
  const got = list(id_bodega);
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  console.log((ok ? 'OK   ' : 'FAIL ') + label + ' → ' + JSON.stringify(got) + (ok ? '' : ' (esperado ' + JSON.stringify(expected) + ')'));
  if (!ok) process.exit(1);
}

check('Bodega NULL (admin sin bodega / sin filtro)',
  ['A (sin reglas)', 'B (solo bodega 5)', 'C (solo bodega 7)', 'D (bodega 5 y 7)', 'E (deshabilitado en 5, habilitado en 7)'],
  null);

check('Bodega 5 (bodeguero)',
  ['A (sin reglas)', 'B (solo bodega 5)', 'D (bodega 5 y 7)'],
  5);

check('Bodega 7 (bodega Cocina)',
  ['A (sin reglas)', 'C (solo bodega 7)', 'D (bodega 5 y 7)', 'E (deshabilitado en 5, habilitado en 7)'],
  7);

console.log('---');
console.log('Todos los casos pasaron');
