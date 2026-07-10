import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db, rowToTrip } from '../db.js';
import { asyncHandler } from '../util.js';

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
tripsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
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

    const trip = {
      id: randomUUID(),
      destination,
      started_at: Number(body.started_at) || Date.now(),
      duration_ms: Number(body.duration_ms) || 0,
      distance_km,
      avg_speed_kmh: Number(body.avg_speed_kmh) || 0,
      max_speed_kmh: Number(body.max_speed_kmh) || 0,
      path,
    };

    await db.execute({
      sql: `INSERT INTO trips (id, destination, started_at, duration_ms, distance_km, avg_speed_kmh, max_speed_kmh, path)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        trip.id,
        trip.destination,
        trip.started_at,
        trip.duration_ms,
        trip.distance_km,
        trip.avg_speed_kmh,
        trip.max_speed_kmh,
        JSON.stringify(trip.path),
      ],
    });

    res.status(201).json(trip);
  })
);

// GET /api/trips — lister tous les trajets (du plus récent au plus ancien)
tripsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rs = await db.execute('SELECT * FROM trips ORDER BY started_at DESC');
    res.json(rs.rows.map(rowToTrip));
  })
);

// GET /api/trips/best?destination=X — meilleur trajet (vitesse moyenne la plus haute)
// NOTE : cette route doit être déclarée AVANT /:id.
tripsRouter.get(
  '/best',
  asyncHandler(async (req, res) => {
    const destination = typeof req.query.destination === 'string' ? req.query.destination.trim() : '';
    if (!destination) {
      return res.status(400).json({ error: 'Le paramètre destination est requis.' });
    }

    const rs = await db.execute({
      sql: `SELECT * FROM trips
            WHERE LOWER(destination) = LOWER(?)
            ORDER BY avg_speed_kmh DESC
            LIMIT 1`,
      args: [destination],
    });

    if (rs.rows.length === 0) {
      return res.status(404).json({ error: 'Aucun trajet trouvé pour cette destination.' });
    }

    res.json(rowToTrip(rs.rows[0]));
  })
);

// DELETE /api/trips — tout effacer
tripsRouter.delete(
  '/',
  asyncHandler(async (_req, res) => {
    await db.execute('DELETE FROM trips');
    res.status(204).end();
  })
);

// DELETE /api/trips/:id — supprimer un trajet
tripsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const rs = await db.execute({ sql: 'DELETE FROM trips WHERE id = ?', args: [req.params.id] });
    if (rs.rowsAffected === 0) {
      return res.status(404).json({ error: 'Trajet introuvable.' });
    }
    res.status(204).end();
  })
);
