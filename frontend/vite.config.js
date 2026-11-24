import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The dev server proxies /api to Django so the session + CSRF cookies are
// same-origin. VITE_API_BASE_URL stays "/api" in that setup.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backend = env.BACKEND_ORIGIN || 'http://127.0.0.1:8000'
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: Number(env.FRONTEND_PORT || 5173),
      strictPort: true,
      proxy: { '/api': { target: backend, changeOrigin: false } },
    },
    preview: {
      port: 4173,
      proxy: { '/api': { target: backend, changeOrigin: false } },
    },
    test: { environment: 'node', include: ['src/**/*.test.js'] },
  }
})
