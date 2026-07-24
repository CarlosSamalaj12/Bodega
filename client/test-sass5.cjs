const sass = require('sass');
const path = require('path');

// Probar si compilar _variables.scss directamente da error
try {
  const r = sass.compile('src/styles/abstracts/_variables.scss', {
    loadPaths: [path.resolve('src')],
  });
  console.log('OK _variables.scss compila');
  console.log('Output length:', r.css.length);
} catch (e) { console.log('FAIL _variables.scss:', e.message); }

// Probar importandolo via @use
try {
  const r = sass.compileString(`
    @use "styles/abstracts/variables";
    .t { color: variables.$color-text; }
  `, { loadPaths: [path.resolve('src')] });
  console.log('OK con namespace:', r.css.trim().slice(0, 100));
} catch (e) { console.log('FAIL con namespace:', e.message); }

// Probar usando 'variables' SIN guión bajo
try {
  const r = sass.compileString(`
    @use "styles/abstracts/_variables";
    .t { color: _variables.$color-text; }
  `, { loadPaths: [path.resolve('src')] });
  console.log('OK con guión bajo:', r.css.trim().slice(0, 100));
} catch (e) { console.log('FAIL con guión bajo:', e.message); }
