#!/usr/bin/env node
/**
 * bump-version.cjs
 *
 * Bump de la versión patch (X.Y.Z → X.Y.(Z+1)) en package.json y
 * reescritura de public/version.json con la nueva versión + timestamp
 * + commit corto de git. Pensado para correr justo antes de
 * `vite build` (ya está cableado en el script "build:client").
 *
 * Por qué un script y no el buildStart del plugin Vite: porque la
 * `define` de Vite se resuelve en el `config()`, que corre ANTES de
 * `buildStart`. Si bumpamos en buildStart, el bundle queda con la
 * versión anterior y version.json con la nueva → el chequeo runtime
 * siempre reportaría "pending update" después de cada build.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const versionJsonPath = path.join(root, 'public', 'version.json');

function bumpPatchVersion() {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const parts = String(pkg.version || '1.0.0')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  parts[2] = (parts[2] || 0) + 1;
  const newVersion = parts.join('.');
  pkg.version = newVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

  let commit = '';
  try {
    commit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    /* no es un repo git o git no está disponible */
  }

  const versionInfo = {
    version: newVersion,
    builtAt: new Date().toISOString(),
    commit,
  };
  fs.writeFileSync(versionJsonPath, JSON.stringify(versionInfo, null, 2) + '\n');
  return versionInfo;
}

// Soporta --dry para previsualizar sin escribir.
const dryRun = process.argv.includes('--dry');

if (dryRun) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const parts = String(pkg.version || '1.0.0').split('.').map((n) => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  parts[2] = (parts[2] || 0) + 1;
  // eslint-disable-next-line no-console
  console.log(`(dry-run) Sería bumpeado a ${parts.join('.')}`);
  process.exit(0);
}

const info = bumpPatchVersion();
// eslint-disable-next-line no-console
console.log(`📦 [version] bumped → ${info.version} (commit: ${info.commit || 'n/a'}, builtAt: ${info.builtAt})`);
