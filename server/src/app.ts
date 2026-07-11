import express from 'express';
import cors from 'cors';
import { tripsRouter } from './routes/trips.js';
import { trafficRouter } from './routes/traffic.js';
import { ensureSchema } from './db.js';

// Fabrique l'application Express. Utilisée à la fois par le serveur de dev
// local (server/src/index.ts) et par la fonction serverless Vercel (api/).
export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '4mb' })); // Vercel limite le corps à ~4,5 Mo

  // Garantit l'existence du schéma avant toute requête API (cold start serverless).
  app.use('/api', (_req, res, next) => {
    ensureSchema().then(() => next()).catch(next);
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, tomtom: Boolean(process.env.TOMTOM_API_KEY) });
  });

  app.use('/api/trips', tripsRouter);
  app.use('/api/traffic', trafficRouter);

  // 404 JSON pour toute route API inconnue (plus clair côté client qu'un 404 brut).
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Route API introuvable.' });
  });

  // Gestion d'erreurs globale
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Erreur serveur :', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Erreur interne du serveur.' });
    }
  });

  return app;
}
