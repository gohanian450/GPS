import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../util.js';
import { TOMTOM_KEY, ensureKey } from './traffic.js';
import { RADARS_QC } from '../data/radarsQc.js';

export const radarsRouter = Router();

// Traite ce nombre d'emplacements non encore géocodés à chaque appel, pour
// rester bien sous la limite de temps d'une fonction serverless (15 s).
const BATCH_SIZE = 10;

async function geocodeQuery(q: string): Promise<{ lat: number; lng: number } | null> {
  const url =
    `https://api.tomtom.com/search/2/geocode/${encodeURIComponent(q)}.json` +
    `?key=${TOMTOM_KEY}&limit=1&countrySet=CA&language=fr-CA`;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const data = (await r.json()) as any;
    const pos = data?.results?.[0]?.position;
    return pos ? { lat: pos.lat, lng: pos.lon } : null;
  } catch {
    return null;
  }
}

// Résout des coordonnées pour un radar : description précise d'abord, puis
// repli sur la municipalité seule, puis un point générique au Québec en
// dernier recours — pour garantir que chaque emplacement finit par être
// traité une fois (et que la file de géocodage se termine).
async function resolveCoords(description: string, municipality: string): Promise<{ lat: number; lng: number }> {
  const precise = await geocodeQuery(`${description}, ${municipality}, Québec`);
  if (precise) return precise;
  const cityLevel = await geocodeQuery(`${municipality}, Québec`);
  if (cityLevel) return cityLevel;
  return { lat: 46.8, lng: -71.2 }; // centre approximatif du Québec, dernier recours
}

// GET /api/radars — emplacements déjà géocodés (mis en cache en base).
radarsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rs = await db.execute('SELECT id, description, municipality, device_type, lat, lng FROM speed_cameras');
    res.json(
      rs.rows.map((r) => ({
        id: String(r.id),
        description: String(r.description),
        municipality: String(r.municipality),
        deviceType: String(r.device_type),
        lat: Number(r.lat),
        lng: Number(r.lng),
      }))
    );
  })
);

// POST /api/radars/seed — géocode le prochain lot d'emplacements non traités.
// Idempotent (INSERT OR IGNORE) : appeler en boucle jusqu'à { done: true }.
radarsRouter.post(
  '/seed',
  asyncHandler(async (req, res) => {
    if (!ensureKey(res)) return;

    const existing = await db.execute('SELECT id FROM speed_cameras');
    const known = new Set(existing.rows.map((r) => String(r.id)));
    const pending = RADARS_QC.filter((r) => !known.has(r.id)).slice(0, BATCH_SIZE);

    for (const item of pending) {
      const { lat, lng } = await resolveCoords(item.description, item.municipality || item.region);
      await db.execute({
        sql: 'INSERT OR IGNORE INTO speed_cameras (id, description, municipality, device_type, lat, lng) VALUES (?, ?, ?, ?, ?, ?)',
        args: [item.id, item.description, item.municipality || item.region, item.deviceType, lat, lng],
      });
      // Respecte la limite de débit TomTom (5 req/s pour les API non-tuile).
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    const remaining = RADARS_QC.length - (known.size + pending.length);
    res.json({ total: RADARS_QC.length, processedNow: pending.length, remaining: Math.max(0, remaining), done: remaining <= 0 });
  })
);
