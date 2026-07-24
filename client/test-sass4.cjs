const sass = require('sass');
const path = require('path');

// Test más simple: inline las variables
try {
  const r = sass.compileString(`
    $color-text: red;
    .t { color: $color-text; }
  `);
  console.log('Inline OK:', r.css);
} catch (e) { console.log('Inline FAIL:', e.message); }

// Test con @use pero sin "as *"
try {
  const r = sass.compileString(`
    @use "styles/abstracts";
    .t { color: abstracts.$color-text; }
  `, { loadPaths: [path.resolve('src')] });
  console.log('Namespace OK:', r.css.trim().slice(0, 80));
} catch (e) { console.log('Namespace FAIL:', e.message); }

// Test directo importando _variables
try {
  const r = sass.compileString(`
    @use "styles/abstracts/variables" as vars;
    .t { color: vars.$color-text; }
  `, { loadPaths: [path.resolve('src')] });
  console.log('Vars OK:', r.css.trim().slice(0, 80));
} catch (e) { console.log('Vars FAIL:', e.message); }
