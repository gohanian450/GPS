import type { LatLng } from './types';

const R = 6371e3; // rayon terrestre en mètres

// Distance de Haversine entre deux points GPS, en mètres.
export function haversineMeters(a: LatLng, b: LatLng): number {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;

  const h =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// Cap (bearing) de a vers b, en degrés depuis le nord (0-360).
export function bearing(a: LatLng, b: LatLng): number {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
}

// Longueur totale d'un tracé (en km).
export function pathLengthKm(path: LatLng[]): number {
  let meters = 0;
  for (let i = 1; i < path.length; i++) {
    meters += haversineMeters(path[i - 1], path[i]);
  }
  return meters / 1000;
}

// Formate une durée en ms vers "hh:mm:ss" ou "mm:ss".
export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// Formate un nombre de secondes vers un texte court, ex : "12 min", "1 h 05".
export function formatSecondsLabel(seconds: number): string {
  const totalMin = Math.round(seconds / 60);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h} h ${String(m).padStart(2, '0')}`;
}

// Formate une date (timestamp ms) en français québécois.
export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('fr-CA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
