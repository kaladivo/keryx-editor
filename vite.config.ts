import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/',
  plugins: [react()],
  // Evolu's workers and SQLite WASM are resolved via import.meta.url and break when pre-bundled.
  optimizeDeps: {
    exclude: ['@evolu/web', '@evolu/sqlite-wasm', 'kysely'],
  },
})
