import 'dotenv/config';
import { createApp } from './app.js';

// Serveur de développement local (non utilisé sur Vercel, qui invoque
// directement la fonction serverless de /api).
const PORT = Number(process.env.PORT) || 3001;

createApp().listen(PORT, () => {
  console.log(`🚗 RouteTrack API (dev) sur http://localhost:${PORT}`);
  if (!process.env.TOMTOM_API_KEY) {
    console.warn('⚠️  TOMTOM_API_KEY absente : les fonctionnalités de trafic seront désactivées.');
  }
  if (!process.env.TURSO_DATABASE_URL) {
    console.warn('ℹ️  TURSO_DATABASE_URL absente : utilisation d\'un fichier SQLite local (routetrack.db).');
  }
});
