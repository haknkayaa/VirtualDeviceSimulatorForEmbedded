/// <reference types="vitest/config" />

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const apiTarget = process.env.VDS_API_PROXY_TARGET ?? 'http://127.0.0.1:8080'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../../build/web',
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    clearMocks: true,
  },
})
