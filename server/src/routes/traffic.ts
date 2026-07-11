import { Router } from 'express';

export const trafficRouter = Router();

// .trim() : évite un 400/403 si la clé a été collée avec un espace ou un retour
// de ligne dans les variables d'environnement.
const TOMTOM_KEY = process.env.TOMTOM_API_KEY?.trim();

function ensureKey(res: import('express').Response): boolean {
  if (!TOMTOM_KEY) {
    res.status(503).json({
      error:
        'Clé TomTom non configurée. Ajoutez TOMTOM_API_KEY (fichier .env en local, ou Variables d\'environnement sur Vercel).',
    });
    return false;
  }
  return true;
}

// Extrait le message d'erreur détaillé renvoyé par TomTom (utile pour un 400).
async function tomtomErrorDetail(r: Response): Promise<string> {
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

  const url =
    `https://api.tomtom.com/routing/1/calculateRoute/${oLat},${oLng}:${dLat},${dLng}/json` +
    `?key=${TOMTOM_KEY}&traffic=true&computeTravelTimeFor=all`;

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
  const base =
    `https://api.tomtom.com/routing/1/calculateRoute/${oLat},${oLng}:${dLat},${dLng}/json` +
    `?key=${TOMTOM_KEY}&traffic=true&computeTravelTimeFor=all&routeRepresentation=polyline&avoid=ferries` +
    `&instructionsType=text&language=fr-FR`;
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
