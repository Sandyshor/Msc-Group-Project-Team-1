import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Shares the main site's public folder (map boundaries, icons).
  publicDir: '../public',
})
