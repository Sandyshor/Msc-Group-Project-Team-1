import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Data/ sits next to Frontend/, so resolve from this file's folder (the build runs inside Frontend/)
const amenitiesCsvPath = resolve(import.meta.dirname, '..', 'Data', 'amenities_osm.csv')

function amenitiesCsvPlugin() {
  return {
    name: 'amenities-csv',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== '/journey-planner/amenities_osm.csv') {
          next()
          return
        }

        try {
          response.setHeader('Content-Type', 'text/csv; charset=utf-8')
          response.setHeader('Cache-Control', 'no-cache')
          response.end(readFileSync(amenitiesCsvPath))
        } catch (error) {
          next(error)
        }
      })
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'journey-planner/amenities_osm.csv',
        source: readFileSync(amenitiesCsvPath),
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), amenitiesCsvPlugin()],
  // Frontend/public: images, videos, icons and the map boundaries
  // (/data/dublin_postcode_boundaries.geojson) used by the District Profile.
  publicDir: 'public',
  // District Profile has its own package.json; make sure only one copy of React is bundled.
  resolve: { dedupe: ['react', 'react-dom'] },
})
