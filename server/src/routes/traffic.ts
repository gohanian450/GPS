import { Router } from 'express';

export const trafficRouter = Router();

const TOMTOM_KEY = process.env.TOMTOM_API_KEY;

function ensureKey(res: import('express').Response): boolean {
  if (!TOMTOM_KEY) {
    res.status(503).json({
      error: 'Clé TomTom non configurée. Ajoutez TOMTOM_API_KEY dans votre fichier .env.',
    });
    return false;
  }
  return true;
}

// GET /api/traffic/eta?originLat=&originLng=&destLat=&destLng=
// Retourne { liveSeconds, freeFlowSeconds } via l'API Routing de TomTom (traffic=true).
trafficRouter.get('/eta', async (req, res) => {
  if (!ensureKey(res)) return;

  const { originLat, originLng, destLat, destLng } = req.query;
  const coords = [originLat, originLng, destLat, destLng].map((v) => Number(v));
  if (coords.some((c) => !Number.isFinite(c))) {
    return res.status(400).json({ error: 'Coordonnées invalides.' });
  }
  const [oLat, oLng, dLat, dLng] = coords;

  const url =
    `https://api.tomtom.com/routing/1/calculateRoute/${oLat},${oLng}:${dLat},${dLng}/json` +
    `?key=${TOMTOM_KEY}&traffic=true&computeTravelTimeFor=all`;

  try {
    const r = await fetch(url);
    if (!r.ok) {
      return res.status(502).json({ error: `TomTom Routing a répondu ${r.status}.` });
    }
    const data = (await r.json()) as any;
    const summary = data?.routes?.[0]?.summary;
    if (!summary) {
      return res.status(502).json({ error: 'Réponse TomTom inattendue.' });
    }
    res.json({
      liveSeconds: summary.travelTimeInSeconds ?? null,
      freeFlowSeconds: summary.noTrafficTravelTimeInSeconds ?? summary.travelTimeInSeconds ?? null,
      trafficDelaySeconds: summary.trafficDelayInSeconds ?? 0,
    });
  } catch (err) {
    res.status(502).json({ error: 'API TomTom indisponible.' });
  }
});

// GET /api/traffic/tile/:z/:x/:y — proxy des tuiles de trafic (flow/relative).
trafficRouter.get('/tile/:z/:x/:y', async (req, res) => {
  if (!ensureKey(res)) return;

  const { z, x, y } = req.params;
  if (![z, x, y].every((v) => /^\d+$/.test(v))) {
    return res.status(400).json({ error: 'Indices de tuile invalides.' });
  }

  const url =
    `https://api.tomtom.com/traffic/map/4/tile/flow/relative/${z}/${x}/${y}.png` +
    `?key=${TOMTOM_KEY}`;

  try {
    const r = await fetch(url);
    if (!r.ok) {
      return res.status(502).end();
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.send(buf);
  } catch {
    res.status(502).end();
  }
});
