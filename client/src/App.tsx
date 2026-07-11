import { useCallback, useEffect, useRef, useState } from 'react';
import { StatsPanel } from './components/StatsPanel';
import { TripMap } from './components/TripMap';
import { SuggestionPanel } from './components/SuggestionPanel';
import { RoutePanel } from './components/RoutePanel';
import { NavBanner } from './components/NavBanner';
import { NavSummary } from './components/NavSummary';
import { TripHistory } from './components/TripHistory';
import { useTracker } from './lib/useTracker';
import { haversineMeters } from './lib/geo';

// Distance restante le long de l'itinéraire depuis la position courante (m).
function remainingAlongRoute(points: LatLng[], pos: LatLng): number {
  let nearest = 0;
  let min = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = haversineMeters(pos, points[i]);
    if (d < min) {
      min = d;
      nearest = i;
    }
  }
  let rem = min;
  for (let i = nearest; i < points.length - 1; i++) {
    rem += haversineMeters(points[i], points[i + 1]);
  }
  return rem;
}
import type { Trip, EtaResult, LatLng, RouteResult, SearchSuggestion } from './lib/types';
import {
  bestTrip,
  listTrips,
  saveTrip,
  deleteTrip,
  clearTrips,
  fetchEta,
  geocode,
  fetchRoute,
  searchAddress,
} from './lib/api';

export default function App() {
  const { state, start, stop, reset } = useTracker();

  const [destination, setDestination] = useState('');
  const [trips, setTrips] = useState<Trip[]>([]);
  const [best, setBest] = useState<Trip | null>(null);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [eta, setEta] = useState<EtaResult | null>(null);
  const [etaError, setEtaError] = useState<string | null>(null);
  const [showTraffic, setShowTraffic] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sheetCollapsed, setSheetCollapsed] = useState(false);
  const [toast, setToast] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);

  // Itinéraire vers une adresse recherchée.
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routeLabel, setRouteLabel] = useState('');
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [destCoords, setDestCoords] = useState<LatLng | null>(null);
  const [originCoords, setOriginCoords] = useState<LatLng | null>(null);

  // Autocomplétion d'adresses
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const biasPos = useRef<LatLng | null>(null);

  // Navigation tour-par-tour : index de la manœuvre courante
  const [navIndex, setNavIndex] = useState(0);

  // #1 Recentrer / suivi de la carte
  const [following, setFollowing] = useState(true);
  const [recenterNonce, setRecenterNonce] = useState(0);
  // #2 Heure d'arrivée estimée (timestamp)
  const [arrivalAt, setArrivalAt] = useState<number | null>(null);
  // #5 Alerte de vitesse
  const [speedLimit, setSpeedLimit] = useState(100);
  const wasOver = useRef(false);
  // #4 Recalcul automatique de l'itinéraire
  const lastRecalc = useRef(0);
  const recalcing = useRef(false);

  const wasTracking = useRef(false);

  const showToast = useCallback((text: string, kind: 'ok' | 'err') => {
    setToast({ text, kind });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const refreshTrips = useCallback(async () => {
    try {
      setTrips(await listTrips());
    } catch (e) {
      showToast((e as Error).message, 'err');
    }
  }, [showToast]);

  useEffect(() => {
    refreshTrips();
  }, [refreshTrips]);

  // Position de biais pour l'autocomplétion (résultats proches en priorité).
  useEffect(() => {
    if (state.position) biasPos.current = state.position;
  }, [state.position]);

  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        biasPos.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      },
      () => {},
      { timeout: 8000 }
    );
  }, []);

  // Autocomplétion d'adresses (débounce) pendant la frappe.
  useEffect(() => {
    const q = destination.trim();
    if (q.length < 3 || state.tracking) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const res = await searchAddress(q, biasPos.current ?? undefined);
        if (!cancelled) {
          setSuggestions(res);
          setShowSuggestions(true);
        }
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [destination, state.tracking]);

  // Réinitialise le guidage quand un nouvel itinéraire est calculé.
  useEffect(() => {
    setNavIndex(0);
  }, [route]);

  // Avance la manœuvre courante à mesure qu'on s'en approche (< 30 m).
  useEffect(() => {
    const list = route?.instructions;
    if (!state.tracking || !list?.length || !state.position) return;
    let idx = navIndex;
    while (idx < list.length - 1) {
      const ins = list[idx];
      if (ins.lat == null || ins.lng == null) {
        idx++;
        continue;
      }
      const d = haversineMeters(state.position, { lat: ins.lat, lng: ins.lng });
      if (d < 30) idx++;
      else break;
    }
    if (idx !== navIndex) setNavIndex(idx);
  }, [state.position, state.tracking, route, navIndex]);

  // #4 Recalcul automatique si on s'écarte de l'itinéraire (> 60 m).
  useEffect(() => {
    const pos = state.position;
    const pts = route?.points;
    if (!state.tracking || !pos || !destCoords || !pts?.length) return;

    let min = Infinity;
    for (const p of pts) {
      const d = haversineMeters(pos, p);
      if (d < min) min = d;
      if (min < 40) return; // toujours sur la route, rien à faire
    }
    const now = Date.now();
    if (min > 60 && !recalcing.current && now - lastRecalc.current > 15000) {
      recalcing.current = true;
      lastRecalc.current = now;
      showToast("Recalcul de l'itinéraire…", 'ok');
      void (async () => {
        try {
          const r = await fetchRoute(pos, destCoords);
          setRoute(r);
          setOriginCoords(pos);
          setArrivalAt(r.liveSeconds != null ? Date.now() + r.liveSeconds * 1000 : null);
        } catch {
          /* on réessaiera au prochain point */
        } finally {
          recalcing.current = false;
        }
      })();
    }
  }, [state.position, state.tracking, route, destCoords, showToast]);

  // #5 Alerte de vitesse : vibration au moment où on dépasse la limite.
  useEffect(() => {
    const over = state.tracking && state.speedKmh > speedLimit;
    if (over && !wasOver.current && typeof navigator.vibrate === 'function') {
      navigator.vibrate(300);
    }
    wasOver.current = over;
  }, [state.speedKmh, speedLimit, state.tracking]);

  // Recherche de suggestion (débounce) quand l'utilisateur tape une destination.
  useEffect(() => {
    const dest = destination.trim();
    if (!dest || state.tracking) {
      return;
    }
    let cancelled = false;
    setSuggestionLoading(true);
    const handle = setTimeout(async () => {
      try {
        const found = await bestTrip(dest);
        if (cancelled) return;
        setBest(found);
        setEta(null);
        setEtaError(null);
        // Si un meilleur trajet existe, on estime le temps actuel avec le trafic.
        if (found && found.path.length > 0) {
          void computeEta(found);
        }
      } catch (e) {
        if (!cancelled) showToast((e as Error).message, 'err');
      } finally {
        if (!cancelled) setSuggestionLoading(false);
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination, state.tracking]);

  // Calcule l'ETA en direct via le backend (origine = position actuelle).
  const computeEta = useCallback(
    (target: Trip) => {
      const dest = target.path[target.path.length - 1];
      if (!dest) return;
      if (!('geolocation' in navigator)) return;
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const origin: LatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          try {
            setEta(await fetchEta(origin, dest));
            setEtaError(null);
          } catch (e) {
            setEtaError((e as Error).message);
          }
        },
        () => {
          setEtaError("Position actuelle indisponible pour estimer le trafic.");
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    },
    []
  );

  // Sauvegarde automatique à l'arrêt du suivi (si > 50 m).
  useEffect(() => {
    if (wasTracking.current && !state.tracking) {
      const dist = state.distanceKm;
      if (dist >= 0.05 && destination.trim()) {
        void (async () => {
          try {
            await saveTrip({
              destination: destination.trim(),
              started_at: Date.now() - state.durationMs,
              duration_ms: state.durationMs,
              distance_km: state.distanceKm,
              avg_speed_kmh: state.avgSpeedKmh,
              max_speed_kmh: state.maxSpeedKmh,
              path: state.path,
            });
            showToast('Trajet sauvegardé avec succès.', 'ok');
            await refreshTrips();
          } catch (e) {
            showToast((e as Error).message, 'err');
          }
        })();
      } else if (dist < 0.05) {
        showToast('Trajet trop court (< 50 m), non sauvegardé.', 'err');
      }
    }
    wasTracking.current = state.tracking;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.tracking]);

  const currentPosition = () =>
    new Promise<LatLng>((resolve, reject) => {
      if (!('geolocation' in navigator)) return reject(new Error('Géolocalisation non disponible.'));
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => reject(new Error('Position actuelle indisponible. Autorisez la géolocalisation.')),
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });

  // Calcule et trace l'itinéraire vers une destination connue (coordonnées).
  const computeRouteTo = async (dest: LatLng, label: string) => {
    setShowSuggestions(false);
    setRouteLoading(true);
    setRouteError(null);
    setRoute(null);
    setDestCoords(dest);
    setRouteLabel(label);
    try {
      const origin = await currentPosition();
      setOriginCoords(origin);
      const r = await fetchRoute(origin, dest);
      setRoute(r);
      setArrivalAt(r.liveSeconds != null ? Date.now() + r.liveSeconds * 1000 : null);
    } catch (e) {
      setRouteError((e as Error).message);
    } finally {
      setRouteLoading(false);
    }
  };

  // L'utilisateur choisit une adresse dans la liste d'autocomplétion.
  const selectSuggestion = (s: SearchSuggestion) => {
    setDestination(s.label);
    setSuggestions([]);
    setShowSuggestions(false);
    void computeRouteTo({ lat: s.lat, lng: s.lng }, s.label);
  };

  // Bouton 🧭 / Entrée : géocode l'adresse tapée puis trace l'itinéraire.
  const handleFindRoute = async () => {
    const query = destination.trim();
    if (!query) {
      showToast('Entrez une adresse ou une destination.', 'err');
      return;
    }
    setShowSuggestions(false);
    setRouteLoading(true);
    setRouteError(null);
    setRoute(null);
    try {
      const origin = await currentPosition();
      setOriginCoords(origin);
      const geo = await geocode(query, origin); // biaisé vers la position
      setDestCoords({ lat: geo.lat, lng: geo.lng });
      setRouteLabel(geo.label);
      const r = await fetchRoute(origin, { lat: geo.lat, lng: geo.lng });
      setRoute(r);
      setArrivalAt(r.liveSeconds != null ? Date.now() + r.liveSeconds * 1000 : null);
    } catch (e) {
      setRouteError((e as Error).message);
    } finally {
      setRouteLoading(false);
    }
  };

  // Ferme complètement la section itinéraire (et retire les marqueurs de la carte).
  const clearRoute = () => {
    setRoute(null);
    setRouteError(null);
    setRouteLabel('');
    setDestCoords(null);
    setOriginCoords(null);
    setArrivalAt(null);
    setSheetCollapsed(false);
  };

  const handleStart = () => {
    if (!destination.trim()) {
      showToast('Entrez une destination avant de démarrer.', 'err');
      return;
    }
    reset();
    start();
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteTrip(id);
      await refreshTrips();
    } catch (e) {
      showToast((e as Error).message, 'err');
    }
  };

  const handleClear = async () => {
    if (!confirm('Effacer tous les trajets enregistrés ?')) return;
    try {
      await clearTrips();
      await refreshTrips();
    } catch (e) {
      showToast((e as Error).message, 'err');
    }
  };

  // Manœuvre de navigation courante (pendant le suivi).
  const navList = route?.instructions ?? [];
  const currentInstr =
    state.tracking && navList.length ? navList[Math.min(navIndex, navList.length - 1)] : null;
  const navDistance =
    currentInstr && currentInstr.lat != null && currentInstr.lng != null && state.position
      ? haversineMeters(state.position, { lat: currentInstr.lat, lng: currentInstr.lng })
      : null;

  // Résumé de navigation : distance/temps restants + heure d'arrivée (live).
  let navSummary: { remainingMeters: number; remainingSeconds: number | null; arrivalAt: number | null } | null =
    null;
  if (state.tracking && route?.points?.length && state.position) {
    const remM = remainingAlongRoute(route.points, state.position);
    const totalM = route.distanceMeters ?? remM;
    const frac = totalM > 0 ? Math.min(1, remM / totalM) : 1;
    const remSec = route.liveSeconds != null ? route.liveSeconds * frac : null;
    navSummary = {
      remainingMeters: remM,
      remainingSeconds: remSec,
      arrivalAt: remSec != null ? Date.now() + remSec * 1000 : null,
    };
  }

  return (
    <div className="app-map">
      {/* Carte plein écran en fond */}
      <TripMap
        path={state.path}
        position={state.position}
        heading={state.heading}
        suggestionPath={best?.path ?? null}
        routePath={route?.points ?? null}
        origin={originCoords}
        destination={destCoords}
        showTraffic={showTraffic}
        recenterNonce={recenterNonce}
        onFollowChange={setFollowing}
      />

      {/* En navigation : bandeau de manœuvre en haut. Sinon : barre de recherche. */}
      {currentInstr && <NavBanner instruction={currentInstr} distanceMeters={navDistance} />}

      {/* Barre de recherche flottante + autocomplétion (style Google Maps) */}
      {!state.tracking && (
      <div className="ov-search-wrap">
        <div className="ov-search">
          <span className="ov-search-icon">🔎</span>
          <input
            type="text"
            className="ov-search-input"
            placeholder="Où allez-vous ?"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !state.tracking) handleFindRoute();
              if (e.key === 'Escape') setShowSuggestions(false);
            }}
            disabled={state.tracking}
          />
          {destination && !state.tracking && (
            <button
              className="ov-search-clear"
              onClick={() => {
                setDestination('');
                setSuggestions([]);
                setShowSuggestions(false);
              }}
              aria-label="Effacer"
              title="Effacer"
            >
              ✕
            </button>
          )}
          <button
            className="ov-search-go"
            onClick={handleFindRoute}
            disabled={state.tracking || routeLoading}
            title="Trouver l'itinéraire"
            aria-label="Trouver l'itinéraire"
          >
            🧭
          </button>
        </div>

        {showSuggestions && suggestions.length > 0 && !state.tracking && (
          <ul className="ov-suggestions">
            {suggestions.map((s) => (
              <li key={s.id}>
                <button className="ov-suggestion" onClick={() => selectSuggestion(s)}>
                  <span className="ov-suggestion-pin">📍</span>
                  <span className="ov-suggestion-label">{s.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      )}

      {/* Boutons flottants (droite) */}
      <div className="ov-fabs">
        <button
          className={`fab ${showTraffic ? 'fab-on' : ''}`}
          onClick={() => setShowTraffic((v) => !v)}
          title="Afficher le trafic"
          aria-label="Afficher le trafic"
        >
          🚦
        </button>
        <button className="fab" onClick={() => setHistoryOpen(true)} title="Historique" aria-label="Historique">
          🕘
        </button>
        {/* #1 Recentrer : apparaît quand on a déplacé la carte pendant le suivi */}
        {state.tracking && !following && (
          <button
            className="fab fab-recenter"
            onClick={() => setRecenterNonce((n) => n + 1)}
            title="Recentrer sur ma voiture"
            aria-label="Recentrer sur ma voiture"
          >
            🎯
          </button>
        )}
      </div>

      {toast && <div className={`toast ${toast.kind === 'ok' ? 'toast-ok' : 'toast-err'}`}>{toast.text}</div>}

      {/* Zone basse empilée : vitesse → erreur → feuille d'info (style Waze/Google Maps) */}
      <div className="ov-bottom">
        {/* Pastille de vitesse en bas à gauche (n'est plus cachée par les indications) */}
        {state.tracking && (
          <div className={`ov-speed ${state.speedKmh > speedLimit ? 'ov-speed--over' : ''}`}>
            <span className="ov-speed-num">{Math.round(state.speedKmh)}</span>
            <span className="ov-speed-unit">km/h</span>
          </div>
        )}

        {state.error && <div className="ov-banner">{state.error}</div>}

        <div className={`ov-sheet ${sheetCollapsed ? 'ov-sheet--collapsed' : ''}`}>
          {(routeLoading || route || routeError || best || suggestionLoading || state.tracking) && (
            <button
              className="ov-sheet-handle"
              onClick={() => setSheetCollapsed((v) => !v)}
              title={sheetCollapsed ? 'Afficher les infos' : 'Réduire pour voir la carte'}
              aria-label={sheetCollapsed ? 'Afficher les infos' : 'Réduire pour voir la carte'}
            >
              <span className="ov-sheet-grip" />
              <span className="ov-sheet-chevron">{sheetCollapsed ? '▲' : '▼'}</span>
            </button>
          )}

          <div className="ov-sheet-body">
            {navSummary ? (
              <NavSummary
                remainingMeters={navSummary.remainingMeters}
                remainingSeconds={navSummary.remainingSeconds}
                arrivalAt={navSummary.arrivalAt}
              />
            ) : routeLoading || route || routeError ? (
              <RoutePanel
                label={routeLabel}
                route={route}
                loading={routeLoading}
                error={routeError}
                arrivalAt={arrivalAt}
                onClose={clearRoute}
              />
            ) : (
              <SuggestionPanel best={best} eta={eta} etaError={etaError} loading={suggestionLoading} />
            )}

            {state.tracking && (
              <StatsPanel
                distanceKm={state.distanceKm}
                durationMs={state.durationMs}
                avgSpeedKmh={state.avgSpeedKmh}
                maxSpeedKmh={state.maxSpeedKmh}
              />
            )}

            {/* #5 Réglage de l'alerte de vitesse */}
            <div className="ov-speedlimit">
              <span className="muted small">Alerte de vitesse</span>
              <div className="stepper">
                <button onClick={() => setSpeedLimit((v) => Math.max(30, v - 10))} aria-label="Diminuer">
                  −
                </button>
                <span className="stepper-val">{speedLimit} km/h</span>
                <button onClick={() => setSpeedLimit((v) => Math.min(160, v + 10))} aria-label="Augmenter">
                  +
                </button>
              </div>
            </div>
          </div>

          <div className="ov-controls">
            {!state.tracking ? (
              <button className="btn btn-start" onClick={handleStart}>
                ▶ Démarrer le suivi
              </button>
            ) : (
              <button className="btn btn-stop" onClick={stop}>
                ■ Arrêter
              </button>
            )}
            <button className="btn btn-ghost btn-reset" onClick={reset} disabled={state.tracking} title="Réinitialiser">
              ↺
            </button>
          </div>
        </div>
      </div>

      {/* Panneau historique en surimpression */}
      {historyOpen && (
        <div className="ov-history-backdrop" onClick={() => setHistoryOpen(false)}>
          <div className="ov-history" onClick={(e) => e.stopPropagation()}>
            <button className="ov-history-close" onClick={() => setHistoryOpen(false)} aria-label="Fermer">
              ✕
            </button>
            <TripHistory trips={trips} onDelete={handleDelete} onClear={handleClear} />
          </div>
        </div>
      )}
    </div>
  );
}
