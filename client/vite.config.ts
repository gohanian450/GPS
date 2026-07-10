import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Toutes les requêtes /api sont relayées vers le backend Express (port 3001),
// ce qui garantit que la clé TomTom ne transite jamais par le navigateur.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
