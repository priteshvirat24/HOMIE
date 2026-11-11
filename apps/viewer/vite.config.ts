import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Built output is served by the API at /viewer/ (apps/api/app/main.py), so the phone loads the
// viewer from the same host as the API. In `npm run dev`, /api is proxied to the local API.
export default defineConfig({
  base: '/viewer/',
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': process.env.HOMIE_API_URL ?? 'http://localhost:8000',
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    chunkSizeWarningLimit: 4000,
  },
})
