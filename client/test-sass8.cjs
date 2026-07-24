const sass = require('sass');
const path = require('path');

// Probar _variables.scss directamente con @use namespace
try {
  const r = sass.compileString(`
    @use "styles/abstracts/variables" as v;
    .x { color: v.$color-text; }
    .y { color: v.$color-accent; }
  `, { loadPaths: [path.resolve('src')] });
  console.log('OK:', r.css);
} catch (e) { console.log('FAIL:', e.message); }
