// Fonction serverless Vercel : toutes les requêtes /api/* sont réécrites vers
// ce handler (voir vercel.json) et confiées à l'application Express partagée.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../server/src/app.js';

const app = createApp();

export default function handler(req: IncomingMessage, res: ServerResponse) {
  // Selon le routage Vercel, l'URL peut arriver sans le préfixe « /api ».
  // On le rétablit pour que les routes Express (déclarées en /api/...)
  // correspondent aussi bien en local que sur Vercel.
  if (req.url && !req.url.startsWith('/api')) {
    req.url = '/api' + (req.url.startsWith('/') ? '' : '/') + req.url;
  }
  return (app as unknown as (req: IncomingMessage, res: ServerResponse) => void)(req, res);
}
