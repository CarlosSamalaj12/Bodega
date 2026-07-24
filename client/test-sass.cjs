const sass = require('sass');

try {
  const result = sass.compileString(`
    @use "styles/abstracts" as *;
    .test { color: $color-text; }
  `, { loadPaths: ['src'] });
  console.log('OK:', result.css);
} catch (e) {
  console.log('FAIL:', e.message);
}
