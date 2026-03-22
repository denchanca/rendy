import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const flowiseTarget = process.env.FLOWISE_PROXY_TARGET ?? 'http://localhost:3000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: flowiseTarget,
        changeOrigin: true,
        secure: false,
      },
    },
  },
  preview: {
    proxy: {
      '/api': {
        target: flowiseTarget,
        changeOrigin: true,
        secure: false,
      },
    },
    allowedHosts: true,
    host: '0.0.0.0',
  },
})
