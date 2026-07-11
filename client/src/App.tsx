import { useCallback, useEffect, useRef, useState } from 'react';
import { StatsPanel } from './components/StatsPanel';
import { TripMap } from './components/TripMap';
import { SuggestionPanel } from './components/SuggestionPanel';
import { RoutePanel } from './components/RoutePanel';
import { TripHistory } from './components/TripHistory';
import { useTracker } from './lib/useTracker';
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
      setRoute(await fetchRoute(origin, dest));
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
      setRoute(await fetchRoute(origin, { lat: geo.lat, lng: geo.lng }));
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
      />

      {/* Barre de recherche flottante + autocomplétion (style Google Maps) */}
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
      </div>

      {/* Pastille de vitesse (style Waze) pendant le suivi */}
      {state.tracking && (
        <div className="ov-speed">
          <span className="ov-speed-num">{Math.round(state.speedKmh)}</span>
          <span className="ov-speed-unit">km/h</span>
        </div>
      )}

      {toast && <div className={`toast ${toast.kind === 'ok' ? 'toast-ok' : 'toast-err'}`}>{toast.text}</div>}

      {/* Zone basse empilée : erreur → feuille d'info (style Google Maps) */}
      <div className="ov-bottom">
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
            {routeLoading || route || routeError ? (
              <RoutePanel
                label={routeLabel}
                route={route}
                loading={routeLoading}
                error={routeError}
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
