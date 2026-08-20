import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPublic = path.resolve(__dirname, '..', 'public')
const versionJsonPath = path.join(rootPublic, 'version.json')
const pkgPath = path.resolve(__dirname, '..', 'package.json')

/**
 * Lee la versión actual de public/version.json (escrita por
 * scripts/bump-version.cjs al inicio de cada build). Si no existe,
 * cae al package.json y, en última instancia, a 'dev'.
 */
function readCurrentVersion() {
  try {
    if (existsSync(versionJsonPath)) {
      const txt = readFileSync(versionJsonPath, 'utf-8').trim();
      if (txt) return JSON.parse(txt);
    }
  } catch { /* ignore */ }
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return {
      version: pkg.version || 'dev',
      builtAt: '',
      commit: '',
    };
  } catch {
    return { version: 'dev', builtAt: '', commit: '' };
  }
}

const currentVersion = readCurrentVersion();

/**
 * Plugin de Vite para versionado:
 *   - `config()`: lee public/version.json (que ya fue bumpeado por el
 *     script pre-build) e inyecta __APP_VERSION__/__APP_BUILT_AT__/
 *     __APP_COMMIT__ en el bundle. Sustitución en compile-time, sin
 *     coste en runtime.
 *   - `configureServer()` (dev): si no existe version.json en public/,
 *     escribe uno con la versión actual del package.json para que el
 *     chequeo runtime no reciba 404 antes del primer build.
 *
 * El bump real lo hace scripts/bump-version.cjs (disparado por el
 * script npm "build:client"), no Vite. Esto es importante: `define`
 * se resuelve en `config()`, que corre ANTES de `buildStart`; si
 * bumpamos dentro del plugin, el bundle queda con la versión anterior
 * y version.json con la nueva → "pending update" en cada build.
 */
function appVersionPlugin() {
  return {
    name: 'app-version',
    config() {
      return {
        define: {
          __APP_VERSION__: JSON.stringify(currentVersion.version || 'dev'),
          __APP_BUILT_AT__: JSON.stringify(currentVersion.builtAt || ''),
          __APP_COMMIT__: JSON.stringify(currentVersion.commit || ''),
        },
      };
    },
    configureServer() {
      if (!existsSync(versionJsonPath)) {
        try {
          writeFileSync(
            versionJsonPath,
            JSON.stringify(
              { version: currentVersion.version || 'dev', builtAt: '', commit: '' },
              null,
              2
            ) + '\n'
          );
        } catch { /* ignore */ }
      }
    },
  };
}

// https://vite.dev/config/
// PWA is owned by the root public/ folder (served by Express). We deliberately
// do NOT register vite-plugin-pwa here to avoid a second competing manifest + SW
// when the client is built. See /public/manifest.webmanifest and /public/sw.js.
//
// publicDir apunta a ../public para que Vite copie el manifest/SW/iconos a
// client/dist/ durante el build (así Express los sirve desde el dist primero)
// y para que el dev server los exponga en la raíz (necesario para que Chrome
// ofrezca el prompt de instalación también en http://localhost:5173).
export default defineConfig({
  publicDir: rootPublic,
  plugins: [
    appVersionPlugin(),
    react(),
    {
      // Force a full page reload (not HMR) when the router or auth store
      // changes — these modules own the React context tree and partial HMR
      // would leave children like useNavigate() with a null context.
      name: 'react-router-hmr-shim',
      handleHotUpdate({ file, server }) {
        if (file.endsWith('router.jsx') || file.endsWith('auth.store.js')) {
          server.ws.send({ type: 'full-reload' });
        }
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'canvg': path.resolve(__dirname, './src/utils/empty.js'),
      'html2canvas': path.resolve(__dirname, './src/utils/empty.js'),
      'dompurify': path.resolve(__dirname, './src/utils/empty.js'),
      'fflate': path.resolve(__dirname, './src/utils/empty.js'),
    },
  },
  // Pre-bundle React + Router together so the dep optimizer produces a single
  // consistent React instance for the whole app. This prevents the
  // "Cannot read properties of null (reading 'useContext')" error that
  // happens when react-router-dom and the app code end up with different
  // React copies after an HMR partial update.
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-dom/client', 'react-router-dom'],
  },
  server: {
    port: 5173,
    host: true,
    hmr: {
      // Pin the HMR client port so the WebSocket token stays stable across
      // reconnects; this avoids the "ws://localhost:5173/?token=... failed"
      // warning that the dev server prints when the client port is dynamic.
      clientPort: 5173,
    },
    // Proxy any /api, /auth, /socket.io requests to the existing Express backend.
    // The backend stays untouched and runs on PORT (default 3001).
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
        secure: false,
      },
      '/imagenes': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
    },
  },

  css: {
    preprocessorOptions: {
      scss: {
        // loadPaths permite resolver paths absolutos en @use sin ../../
        loadPaths: [path.resolve(__dirname, './src')],
        // Inyecta los tokens en cada archivo. Los @use manuales se vuelven no-op.
        additionalData: `@use "styles/abstracts" as *;\n`,
      },
    },
  },
})
