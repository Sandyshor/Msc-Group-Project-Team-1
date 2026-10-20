import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Frontend/public: images, videos, icons and the map boundaries
  // (/data/dublin_postcode_boundaries.geojson) used by the District Profile.
  publicDir: 'public',
  // District Profile has its own package.json; make sure only one copy of React is bundled.
  resolve: { dedupe: ['react', 'react-dom'] },
})
