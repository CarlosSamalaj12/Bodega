const sass = require('sass');
const path = require('path');

// Probar varios paths
const tests = [
  { name: 'abstracts/index', use: '@use "styles/abstracts" as *;' },
  { name: 'abstracts/variables directo', use: '@use "styles/abstracts/variables" as *;' },
  { name: 'abstracts/_index con guión bajo', use: '@use "styles/abstracts/_index" as *;' },
];

for (const t of tests) {
  try {
    const r = sass.compileString(`${t.use} .t { color: $color-text; }`, {
      loadPaths: [path.resolve('src')],
    });
    console.log(`OK [${t.name}]:`, r.css.trim().slice(0, 80));
  } catch (e) {
    console.log(`FAIL [${t.name}]:`, e.message);
  }
}
