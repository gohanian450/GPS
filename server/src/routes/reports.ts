import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { asyncHandler } from '../util.js';

export const reportsRouter = Router();

// Types de signalements communautaires pris en charge (façon Waze).
const ALLOWED_TYPES = new Set(['police', 'accident', 'obstacle']);

// Un signalement expire (n'est plus renvoyé) après ce délai.
const REPORT_TTL_MS = 2 * 60 * 60 * 1000; // 2 heures

interface ReportBody {
  type?: unknown;
  lat?: unknown;
  lng?: unknown;
}

// POST /api/reports — signaler un événement (police, accident, obstacle) à sa position.
reportsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = req.body as ReportBody;
    const type = typeof body.type === 'string' ? body.type : '';
    const lat = Number(body.lat);
    const lng = Number(body.lng);

    if (!ALLOWED_TYPES.has(type)) {
      return res.status(400).json({ error: 'Type de signalement invalide.' });
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'Coordonnées invalides.' });
    }

    const report = { id: randomUUID(), type, lat, lng, created_at: Date.now() };
    await db.execute({
      sql: 'INSERT INTO reports (id, type, lat, lng, created_at) VALUES (?, ?, ?, ?, ?)',
      args: [report.id, report.type, report.lat, report.lng, report.created_at],
    });
    res.status(201).json(report);
  })
);

// GET /api/reports — liste les signalements encore actifs (< 2 h), du plus récent au plus ancien.
reportsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const since = Date.now() - REPORT_TTL_MS;
    const rs = await db.execute({
      sql: 'SELECT id, type, lat, lng, created_at FROM reports WHERE created_at > ? ORDER BY created_at DESC',
      args: [since],
    });
    res.json(
      rs.rows.map((r) => ({
        id: String(r.id),
        type: String(r.type),
        lat: Number(r.lat),
        lng: Number(r.lng),
        created_at: Number(r.created_at),
      }))
    );
  })
);
