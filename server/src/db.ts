import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// La BD est stockée à la racine du dossier /server (routetrack.db)
const dbPath = join(__dirname, '..', 'routetrack.db');

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS trips (
    id            TEXT PRIMARY KEY,
    destination   TEXT NOT NULL,
    started_at    INTEGER NOT NULL,
    duration_ms   INTEGER NOT NULL,
    distance_km   REAL NOT NULL,
    avg_speed_kmh REAL NOT NULL,
    max_speed_kmh REAL NOT NULL,
    path          TEXT NOT NULL
  );
`);

export interface TripRow {
  id: string;
  destination: string;
  started_at: number;
  duration_ms: number;
  distance_km: number;
  avg_speed_kmh: number;
  max_speed_kmh: number;
  path: string; // JSON encodé en BD
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

export function rowToTrip(row: TripRow): Trip {
  let path: Array<{ lat: number; lng: number }> = [];
  try {
    path = JSON.parse(row.path);
  } catch {
    path = [];
  }
  return { ...row, path };
}
