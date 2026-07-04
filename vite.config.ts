import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { freemiusPortalMiddleware } from './server/freemiusPortal.ts'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = {
    ...loadEnv(mode, process.cwd(), ''),
    ...process.env,
  }

  return {
    plugins: [
      {
        name: 'freemius-portal-api',
        configureServer(server) {
          server.middlewares.use(freemiusPortalMiddleware(env))
        },
        configurePreviewServer(server) {
          server.middlewares.use(freemiusPortalMiddleware(env))
        },
      },
      react(),
    ],
  }
})
