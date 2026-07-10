import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { tripsRouter } from './routes/trips.js';
import { trafficRouter } from './routes/traffic.js';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(cors());
app.use(express.json({ limit: '5mb' })); // les tracés GPS peuvent être volumineux

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, tomtom: Boolean(process.env.TOMTOM_API_KEY) });
});

app.use('/api/trips', tripsRouter);
app.use('/api/traffic', trafficRouter);

// Gestion d'erreurs globale
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Erreur serveur :', err);
  res.status(500).json({ error: 'Erreur interne du serveur.' });
});

app.listen(PORT, () => {
  console.log(`🚗 RouteTrack API démarrée sur http://localhost:${PORT}`);
  if (!process.env.TOMTOM_API_KEY) {
    console.warn('⚠️  TOMTOM_API_KEY absente : les fonctionnalités de trafic seront désactivées.');
  }
});
