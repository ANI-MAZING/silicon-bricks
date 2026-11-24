import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  optimizeDeps: { exclude: ['maplibre-gl'] },
  build: { chunkSizeWarningLimit: 1500 },
  test: { include: ['tests/**/*.test.ts'] },
})
