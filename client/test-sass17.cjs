const sass = require('sass');
const path = require('path');
const fs = require('fs');

const tmpDir = path.resolve('test-tmp');
fs.mkdirSync(tmpDir, { recursive: true });

// Copiar hasta la línea N exacta y probar
const content = fs.readFileSync('src/styles/abstracts/_variables.scss', 'utf8');
const lines = content.split('\n');

for (const n of [13, 14, 15, 17, 20, 21, 22, 25]) {
  const test = lines.slice(0, n).join('\n');
  fs.writeFileSync(path.join(tmpDir, '_vars.scss'), test);
  fs.writeFileSync(path.join(tmpDir, 'main.scss'), `
    @use "vars" as v;
    .x { color: v.$color-text; }
  `);
  try {
    const r = sass.compile(path.join(tmpDir, 'main.scss'), { loadPaths: [tmpDir] });
    console.log(`OK n=${n}: color=${r.css.match(/color: ([^;]+);/)?.[1]}`);
  } catch (e) {
    console.log(`FAIL n=${n}`);
  }
}

fs.rmSync(tmpDir, { recursive: true, force: true });
