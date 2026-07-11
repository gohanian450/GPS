import { createClient, type Row } from '@libsql/client';

// En production (Vercel) : TURSO_DATABASE_URL = libsql://... + TURSO_AUTH_TOKEN.
// En local, sans Turso : on retombe sur un fichier SQLite local (file:).
const url = process.env.TURSO_DATABASE_URL ?? 'file:routetrack.db';
const authToken = process.env.TURSO_AUTH_TOKEN;

export const db = createClient(authToken ? { url, authToken } : { url });

// Création du schéma, mémoïsée : en serverless on ne veut la lancer
// qu'une seule fois par instance (cold start).
let schemaReady: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = db
      .execute(
        `CREATE TABLE IF NOT EXISTS trips (
          id            TEXT PRIMARY KEY,
          destination   TEXT NOT NULL,
          started_at    INTEGER NOT NULL,
          duration_ms   INTEGER NOT NULL,
          distance_km   REAL NOT NULL,
          avg_speed_kmh REAL NOT NULL,
          max_speed_kmh REAL NOT NULL,
          path          TEXT NOT NULL
        )`
      )
      .then(() =>
        db.execute(
          // Signalements communautaires (style Waze) : police, accident, obstacle...
          `CREATE TABLE IF NOT EXISTS reports (
            id         TEXT PRIMARY KEY,
            type       TEXT NOT NULL,
            lat        REAL NOT NULL,
            lng        REAL NOT NULL,
            created_at INTEGER NOT NULL
          )`
        )
      )
      .then(() =>
        db.execute(
          // Radars photo / feux rouges officiels du Québec (données statiques,
          // géocodées une seule fois via /api/radars/seed).
          `CREATE TABLE IF NOT EXISTS speed_cameras (
            id           TEXT PRIMARY KEY,
            description  TEXT NOT NULL,
            municipality TEXT NOT NULL,
            device_type  TEXT NOT NULL,
            lat          REAL NOT NULL,
            lng          REAL NOT NULL
          )`
        )
      )
      .then(() => undefined)
      .catch((err) => {
        schemaReady = null; // autorise une nouvelle tentative au prochain appel
        throw err;
      });
  }
  return schemaReady;
}

export interface Trip {
  id: string;
  destination: string;
  started_at: number;
  duration_ms: number;
  distance_km: number;
  avg_speed_kmh: number;
  max_speed_kmh: number;
  path: Array<{ lat: number; lng: number }>;
}

// Convertit une ligne libSQL (valeurs string|number|null|bigint) en Trip typé.
export function rowToTrip(row: Row): Trip {
  let path: Array<{ lat: number; lng: number }> = [];
  try {
    path = JSON.parse(String(row.path));
  } catch {
    path = [];
  }
  return {
    id: String(row.id),
    destination: String(row.destination),
    started_at: Number(row.started_at),
    duration_ms: Number(row.duration_ms),
    distance_km: Number(row.distance_km),
    avg_speed_kmh: Number(row.avg_speed_kmh),
    max_speed_kmh: Number(row.max_speed_kmh),
    path,
  };
}
