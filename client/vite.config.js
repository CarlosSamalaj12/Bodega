import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
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
