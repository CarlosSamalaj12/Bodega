const sass = require('sass');
const path = require('path');
const fs = require('fs');

const tmpDir = path.resolve('test-tmp');
fs.mkdirSync(tmpDir, { recursive: true });

const content = fs.readFileSync('src/styles/abstracts/_variables.scss', 'utf8');
const lines = content.split('\n');

// Probar con 8, 10, 12, 15, 20, 25 líneas
for (const n of [8, 10, 12, 15, 20, 30, 50, 100]) {
  const test = lines.slice(0, n).join('\n');
  fs.writeFileSync(path.join(tmpDir, '_vars.scss'), test);
  fs.writeFileSync(path.join(tmpDir, 'main.scss'), `
    @use "vars" as v;
    .x { color: v.$color-text; }
  `);
  try {
    sass.compile(path.join(tmpDir, 'main.scss'), { loadPaths: [tmpDir] });
    console.log(`OK n=${n}`);
  } catch (e) {
    console.log(`FAIL n=${n}: ${e.message.split('\n').slice(0, 2).join(' | ')}`);
  }
}

fs.rmSync(tmpDir, { recursive: true, force: true });
