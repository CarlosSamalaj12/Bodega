import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// https://vite.dev/config/
// PWA is owned by the root public/ folder (served by Express). We deliberately
// do NOT register vite-plugin-pwa here to avoid a second competing manifest + SW
// when the client is built. See /public/manifest.webmanifest and /public/sw.js.
export default defineConfig({
  plugins: [
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
