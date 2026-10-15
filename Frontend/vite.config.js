import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The /districts page (District Profile) fetches its map boundaries from
  // /data/dublin_postcode_boundaries.geojson, which lives in its public folder.
  publicDir: 'District Profile/public',
  // District Profile has its own package.json; make sure only one copy of React is bundled.
  resolve: { dedupe: ['react', 'react-dom'] },
})
