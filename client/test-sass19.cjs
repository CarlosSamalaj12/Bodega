const sass = require('sass');
const path = require('path');
const fs = require('fs');

const tmpDir = path.resolve('test-tmp');
fs.mkdirSync(tmpDir, { recursive: true });

const realContent = fs.readFileSync('src/styles/abstracts/_variables.scss', 'utf8');
const lines = realContent.split('\n');

// $color-text está en la línea 18
for (const n of [18, 19, 20, 22, 25, 30]) {
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
    console.log(`FAIL n=${n}: tiene $color-text en línea 18, test usa n=${n}`);
  }
}

fs.rmSync(tmpDir, { recursive: true, force: true });
