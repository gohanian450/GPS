import type { Trip, EtaResult, LatLng, GeocodeResult, RouteResult } from './types';

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Erreur ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* corps non-JSON */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export async function listTrips(): Promise<Trip[]> {
  return jsonOrThrow<Trip[]>(await fetch('/api/trips'));
}

export async function saveTrip(trip: Omit<Trip, 'id'>): Promise<Trip> {
  return jsonOrThrow<Trip>(
    await fetch('/api/trips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(trip),
    })
  );
}

export async function deleteTrip(id: string): Promise<void> {
  const res = await fetch(`/api/trips/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Échec de la suppression du trajet.');
}

export async function clearTrips(): Promise<void> {
  const res = await fetch('/api/trips', { method: 'DELETE' });
  if (!res.ok) throw new Error('Échec de la suppression des trajets.');
}

// Retourne le meilleur trajet historique, ou null s'il n'existe pas (404).
export async function bestTrip(destination: string): Promise<Trip | null> {
  const res = await fetch(`/api/trips/best?destination=${encodeURIComponent(destination)}`);
  if (res.status === 404) return null;
  return jsonOrThrow<Trip>(res);
}

function routeParams(origin: LatLng, dest: LatLng): string {
  return new URLSearchParams({
    originLat: String(origin.lat),
    originLng: String(origin.lng),
    destLat: String(dest.lat),
    destLng: String(dest.lng),
  }).toString();
}

export async function fetchEta(origin: LatLng, dest: LatLng): Promise<EtaResult> {
  return jsonOrThrow<EtaResult>(await fetch(`/api/traffic/eta?${routeParams(origin, dest)}`));
}

// Convertit une adresse tapée en coordonnées (géocodage TomTom, côté serveur).
// `near` (position actuelle) biaise la recherche vers la correspondance la plus proche.
export async function geocode(query: string, near?: LatLng): Promise<GeocodeResult> {
  const params = new URLSearchParams({ q: query });
  if (near) {
    params.set('lat', String(near.lat));
    params.set('lng', String(near.lng));
  }
  return jsonOrThrow<GeocodeResult>(await fetch(`/api/traffic/geocode?${params.toString()}`));
}

// Calcule l'itinéraire (temps avec trafic + géométrie à tracer sur la carte).
export async function fetchRoute(origin: LatLng, dest: LatLng): Promise<RouteResult> {
  return jsonOrThrow<RouteResult>(await fetch(`/api/traffic/route?${routeParams(origin, dest)}`));
}
