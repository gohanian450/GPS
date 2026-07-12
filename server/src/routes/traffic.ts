import { Router } from 'express';

export const trafficRouter = Router();

// .trim() : évite un 400/403 si la clé a été collée avec un espace ou un retour
// de ligne dans les variables d'environnement.
// Exportée pour être réutilisée par d'autres routes (ex. geocodage des radars).
export const TOMTOM_KEY = process.env.TOMTOM_API_KEY?.trim();

export function ensureKey(res: import('express').Response): boolean {
  if (!TOMTOM_KEY) {
    res.status(503).json({
      error:
        'Clé TomTom non configurée. Ajoutez TOMTOM_API_KEY (fichier .env en local, ou Variables d\'environnement sur Vercel).',
    });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Cache mémoire des tuiles de trafic (par instance de fonction). Le trafic est
// identique pour tous les utilisateurs : on ne rappelle TomTom qu'une fois par
// tuile toutes les 2 min. Sur Vercel, l'en-tête s-maxage ci-dessous fait en
// plus que le CDN serve la tuile depuis le cache réseau (0 appel TomTom, 0
// invocation de fonction) pendant la même durée.
const TILE_TTL_MS = 2 * 60 * 1000; // 2 minutes
const TILE_CACHE_MAX = 600; // plafond d'entrées pour borner la mémoire
const tileCache = new Map<string, { buf: Buffer; ts: number }>();

function getCachedTile(key: string): Buffer | null {
  const hit = tileCache.get(key);
  if (hit && Date.now() - hit.ts < TILE_TTL_MS) return hit.buf;
  if (hit) tileCache.delete(key); // expirée
  return null;
}

function setCachedTile(key: string, buf: Buffer): void {
  if (tileCache.size >= TILE_CACHE_MAX) {
    // Évince l'entrée la plus ancienne (Map conserve l'ordre d'insertion).
    const oldest = tileCache.keys().next().value;
    if (oldest !== undefined) tileCache.delete(oldest);
  }
  tileCache.set(key, { buf, ts: Date.now() });
}

// Extrait le message d'erreur détaillé renvoyé par TomTom (utile pour un 400).
export async function tomtomErrorDetail(r: Response): Promise<string> {
  try {
    const text = await r.text();
    try {
      const j = JSON.parse(text);
      const msg = j?.detailedError?.message || j?.error?.description || j?.message;
      if (msg) return String(msg);
    } catch {
      /* corps non-JSON */
    }
    return text.slice(0, 200) || `HTTP ${r.status}`;
  } catch {
    return `HTTP ${r.status}`;
  }
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

  // routeType=fastest (explicite) : privilégie toujours le temps de trajet le
  // plus court selon le trafic en direct, plutôt que la distance ou l'énergie.
  const url =
    `https://api.tomtom.com/routing/1/calculateRoute/${oLat},${oLng}:${dLat},${dLng}/json` +
    `?key=${TOMTOM_KEY}&traffic=true&computeTravelTimeFor=all&routeType=fastest`;

  try {
    const r = await fetch(url);
    if (!r.ok) {
      const detail = await tomtomErrorDetail(r);
      console.error(`TomTom Routing (eta) ${r.status}: ${detail}`);
      return res.status(502).json({ error: `TomTom Routing (${r.status}) : ${detail}` });
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
  } catch {
    res.status(502).json({ error: 'API TomTom indisponible.' });
  }
});

// GET /api/traffic/geocode?q=adresse — convertit une adresse en coordonnées.
trafficRouter.get('/geocode', async (req, res) => {
  if (!ensureKey(res)) return;

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q) {
    return res.status(400).json({ error: 'Adresse requise.' });
  }

  // Recherche mondiale (pas de restriction de pays) : le biais de proximité
  // ci-dessous privilégie de toute façon les correspondances proches.
  let url =
    `https://api.tomtom.com/search/2/geocode/${encodeURIComponent(q)}.json` +
    `?key=${TOMTOM_KEY}&limit=1&language=fr-CA`;

  // Biais de proximité : si la position de l'utilisateur est fournie, on
  // privilégie la correspondance la plus proche (utile pour une adresse
  // ambiguë comme « rue Dupuis », présente dans plusieurs villes).
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    url += `&lat=${lat}&lon=${lng}`;
  }

  try {
    const r = await fetch(url);
    if (!r.ok) {
      const detail = await tomtomErrorDetail(r);
      console.error(`TomTom Search (geocode) ${r.status}: ${detail}`);
      return res.status(502).json({ error: `TomTom Search (${r.status}) : ${detail}` });
    }
    const data = (await r.json()) as any;
    const first = data?.results?.[0];
    if (!first?.position) {
      return res.status(404).json({ error: 'Adresse introuvable.' });
    }
    // Une adresse → coordonnées est stable : cache CDN d'une heure pour
    // éviter de re-géocoder les mêmes adresses (économie de requêtes TomTom).
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
    res.json({
      lat: first.position.lat,
      lng: first.position.lon,
      label: first.address?.freeformAddress ?? q,
    });
  } catch {
    res.status(502).json({ error: 'API TomTom indisponible.' });
  }
});

// GET /api/traffic/search?q=&lat=&lng= — autocomplétion d'adresses (plusieurs
// suggestions), pour ne pas avoir à taper l'adresse complète.
trafficRouter.get('/search', async (req, res) => {
  if (!ensureKey(res)) return;

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q.length < 3) {
    return res.json({ results: [] });
  }

  let url =
    `https://api.tomtom.com/search/2/search/${encodeURIComponent(q)}.json` +
    `?key=${TOMTOM_KEY}&typeahead=true&limit=6&language=fr-CA`;

  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    url += `&lat=${lat}&lon=${lng}`; // priorise les résultats proches
  }

  try {
    const r = await fetch(url);
    if (!r.ok) {
      const detail = await tomtomErrorDetail(r);
      console.error(`TomTom Search (autocomplete) ${r.status}: ${detail}`);
      return res.status(502).json({ error: `TomTom Search (${r.status}) : ${detail}` });
    }
    const data = (await r.json()) as any;
    const results = (data?.results ?? [])
      .filter((it: any) => it?.position)
      .map((it: any) => {
        const addr = it.address?.freeformAddress ?? '';
        const name = it.poi?.name;
        return {
          id: it.id ?? `${it.position.lat},${it.position.lon}`,
          label: name ? `${name} — ${addr}` : addr,
          lat: it.position.lat,
          lng: it.position.lon,
        };
      });
    res.json({ results });
  } catch {
    res.status(502).json({ error: 'API TomTom indisponible.' });
  }
});

// GET /api/traffic/route?originLat=&originLng=&destLat=&destLng=
// Retourne le temps (avec trafic) ET la géométrie de l'itinéraire à tracer.
// On garde le jeu de paramètres minimal (comme /eta) : par défaut, TomTom
// renvoie déjà la géométrie de l'itinéraire (legs[].points).
trafficRouter.get('/route', async (req, res) => {
  if (!ensureKey(res)) return;

  const { originLat, originLng, destLat, destLng } = req.query;
  const coords = [originLat, originLng, destLat, destLng].map((v) => Number(v));
  if (coords.some((c) => !Number.isFinite(c))) {
    return res.status(400).json({ error: 'Coordonnées invalides.' });
  }
  const [oLat, oLng, dLat, dLng] = coords;

  // routeRepresentation=polyline → géométrie détaillée (le tracé suit la route).
  // avoid=ferries → évite les traversiers (sinon le trajet « passe dans l'eau »).
  // instructionsType=text → manœuvres de navigation (« tournez à droite… »).
  // routeType=fastest → toujours le trajet le plus rapide selon le trafic en
  // direct (même s'il traverse un tronçon congestionné, si c'est globalement
  // plus rapide que les alternatives).
  // vehicleHeading (0-359) : sens dans lequel roule le véhicule. Évite que TomTom
  // fasse partir dans la direction opposée (demi-tour / contresens de sens unique).
  const heading = Number(req.query.vehicleHeading);
  const headingParam =
    Number.isFinite(heading) ? `&vehicleHeading=${((Math.round(heading) % 360) + 360) % 360}` : '';

  const base =
    `https://api.tomtom.com/routing/1/calculateRoute/${oLat},${oLng}:${dLat},${dLng}/json` +
    `?key=${TOMTOM_KEY}&traffic=true&computeTravelTimeFor=all&routeRepresentation=polyline&avoid=ferries&routeType=fastest` +
    `&instructionsType=text&language=fr-FR${headingParam}`;
  // sectionType=speedLimit → renvoie les limites de vitesse par tronçon.
  // Si TomTom refuse ce paramètre, on retombe sur la requête de base (l'itinéraire
  // fonctionne toujours, sans limites de vitesse).
  const url = `${base}&sectionType=speedLimit`;

  try {
    let r = await fetch(url);
    if (!r.ok && r.status === 400) {
      r = await fetch(base); // repli sans limites de vitesse
    }
    if (!r.ok) {
      const detail = await tomtomErrorDetail(r);
      console.error(`TomTom Routing (route) ${r.status}: ${detail}`);
      if (/NO_ROUTE_FOUND/i.test(detail)) {
        return res.status(422).json({
          error:
            "Aucun itinéraire routier trouvé entre ta position actuelle et cette adresse. Vérifie ta position GPS (marqueur vert « Départ ») et que l'adresse est complète (numéro, rue, ville).",
        });
      }
      return res.status(502).json({ error: `TomTom Routing (${r.status}) : ${detail}` });
    }
    const data = (await r.json()) as any;
    const route = data?.routes?.[0];
    const summary = route?.summary;
    if (!summary) {
      return res.status(502).json({ error: 'Réponse TomTom inattendue.' });
    }
    const points: Array<{ lat: number; lng: number }> = (route.legs ?? []).flatMap((leg: any) =>
      (leg.points ?? []).map((p: any) => ({ lat: p.latitude, lng: p.longitude }))
    );
    const instructions = (route.guidance?.instructions ?? []).map((it: any) => ({
      text: it.message ?? '',
      maneuver: it.maneuver ?? '',
      street: it.street ?? it.roadNumbers?.[0] ?? '',
      routeOffsetInMeters: it.routeOffsetInMeters ?? 0,
      lat: it.point?.latitude ?? null,
      lng: it.point?.longitude ?? null,
    }));
    // Limites de vitesse par tronçon (si disponibles). On lit le champ numérique
    // quel qu'en soit le nom exact selon la version de l'API.
    const speedLimits = (route.sections ?? [])
      .filter((s: any) => /speed/i.test(String(s.sectionType ?? '')))
      .map((s: any) => ({
        startPointIndex: s.startPointIndex ?? 0,
        endPointIndex: s.endPointIndex ?? 0,
        speedKmh:
          s.maxSpeedLimitInKmh ?? s.maxSpeedLimit ?? s.speedLimit ?? s.effectiveSpeedInKmh ?? s.maxSpeedInKmh ?? null,
      }))
      .filter((s: any) => typeof s.speedKmh === 'number' && s.speedKmh > 0);
    res.json({
      liveSeconds: summary.travelTimeInSeconds ?? null,
      freeFlowSeconds: summary.noTrafficTravelTimeInSeconds ?? summary.travelTimeInSeconds ?? null,
      trafficDelaySeconds: summary.trafficDelayInSeconds ?? 0,
      distanceMeters: summary.lengthInMeters ?? null,
      points,
      instructions,
      speedLimits,
    });
  } catch {
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

  // Cache CDN (Vercel) : s-maxage=120 → le réseau sert la tuile 2 min sans
  // rappeler la fonction ni TomTom ; stale-while-revalidate lisse le rafraîchissement.
  const cacheHeader = 'public, max-age=120, s-maxage=120, stale-while-revalidate=300';
  const key = `${z}/${x}/${y}`;

  // 1) Cache mémoire (utile en local et sur une instance « chaude »).
  const cached = getCachedTile(key);
  if (cached) {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', cacheHeader);
    res.setHeader('X-Cache', 'HIT');
    return res.send(cached);
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
    setCachedTile(key, buf);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', cacheHeader);
    res.setHeader('X-Cache', 'MISS');
    res.send(buf);
  } catch {
    res.status(502).end();
  }
});
