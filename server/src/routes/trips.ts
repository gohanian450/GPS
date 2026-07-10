import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db, rowToTrip, type TripRow } from '../db.js';

export const tripsRouter = Router();

interface TripBody {
  destination?: unknown;
  started_at?: unknown;
  duration_ms?: unknown;
  distance_km?: unknown;
  avg_speed_kmh?: unknown;
  max_speed_kmh?: unknown;
  path?: unknown;
}

// POST /api/trips — sauvegarder un trajet complété
tripsRouter.post('/', (req, res) => {
  const body = req.body as TripBody;

  const destination = typeof body.destination === 'string' ? body.destination.trim() : '';
  if (!destination) {
    return res.status(400).json({ error: 'Une destination est requise.' });
  }

  const distance_km = Number(body.distance_km);
  if (!Number.isFinite(distance_km) || distance_km < 0.05) {
    // Règle métier : on ne conserve que les trajets de plus de 50 mètres.
    return res.status(400).json({ error: 'Le trajet doit dépasser 50 mètres pour être sauvegardé.' });
  }

  const path = Array.isArray(body.path) ? body.path : [];

  const trip: TripRow = {
    id: randomUUID(),
    destination,
    started_at: Number(body.started_at) || Date.now(),
    duration_ms: Number(body.duration_ms) || 0,
    distance_km,
    avg_speed_kmh: Number(body.avg_speed_kmh) || 0,
    max_speed_kmh: Number(body.max_speed_kmh) || 0,
    path: JSON.stringify(path),
  };

  db.prepare(
    `INSERT INTO trips (id, destination, started_at, duration_ms, distance_km, avg_speed_kmh, max_speed_kmh, path)
     VALUES (@id, @destination, @started_at, @duration_ms, @distance_km, @avg_speed_kmh, @max_speed_kmh, @path)`
  ).run(trip);

  res.status(201).json(rowToTrip(trip));
});

// GET /api/trips — lister tous les trajets (du plus récent au plus ancien)
tripsRouter.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM trips ORDER BY started_at DESC').all() as TripRow[];
  res.json(rows.map(rowToTrip));
});

// GET /api/trips/best?destination=X — meilleur trajet (vitesse moyenne la plus haute)
// NOTE : cette route doit être déclarée AVANT /:id.
tripsRouter.get('/best', (req, res) => {
  const destination = typeof req.query.destination === 'string' ? req.query.destination.trim() : '';
  if (!destination) {
    return res.status(400).json({ error: 'Le paramètre destination est requis.' });
  }

  const row = db
    .prepare(
      `SELECT * FROM trips
       WHERE LOWER(destination) = LOWER(?)
       ORDER BY avg_speed_kmh DESC
       LIMIT 1`
    )
    .get(destination) as TripRow | undefined;

  if (!row) {
    return res.status(404).json({ error: 'Aucun trajet trouvé pour cette destination.' });
  }

  res.json(rowToTrip(row));
});

// DELETE /api/trips — tout effacer
tripsRouter.delete('/', (_req, res) => {
  db.prepare('DELETE FROM trips').run();
  res.status(204).end();
});

// DELETE /api/trips/:id — supprimer un trajet
tripsRouter.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM trips WHERE id = ?').run(req.params.id);
  if (info.changes === 0) {
    return res.status(404).json({ error: 'Trajet introuvable.' });
  }
  res.status(204).end();
});
