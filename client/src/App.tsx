import { useCallback, useEffect, useRef, useState } from 'react';
import { Speedometer } from './components/Speedometer';
import { StatsPanel } from './components/StatsPanel';
import { TripMap } from './components/TripMap';
import { SuggestionPanel } from './components/SuggestionPanel';
import { RoutePanel } from './components/RoutePanel';
import { TripHistory } from './components/TripHistory';
import { useTracker } from './lib/useTracker';
import type { Trip, EtaResult, LatLng, RouteResult } from './lib/types';
import { bestTrip, listTrips, saveTrip, deleteTrip, clearTrips, fetchEta, geocode, fetchRoute } from './lib/api';

export default function App() {
  const { state, start, stop, reset } = useTracker();

  const [destination, setDestination] = useState('');
  const [trips, setTrips] = useState<Trip[]>([]);
  const [best, setBest] = useState<Trip | null>(null);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [eta, setEta] = useState<EtaResult | null>(null);
  const [etaError, setEtaError] = useState<string | null>(null);
  const [showTraffic, setShowTraffic] = useState(false);
  const [toast, setToast] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);

  // Itinéraire vers une adresse recherchée.
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routeLabel, setRouteLabel] = useState('');
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [destCoords, setDestCoords] = useState<LatLng | null>(null);

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

  // Recherche l'adresse tapée, calcule l'itinéraire et le trace sur la carte.
  const handleFindRoute = async () => {
    const query = destination.trim();
    if (!query) {
      showToast('Entrez une adresse ou une destination.', 'err');
      return;
    }
    setRouteLoading(true);
    setRouteError(null);
    setRoute(null);
    try {
      const geo = await geocode(query);
      setDestCoords({ lat: geo.lat, lng: geo.lng });
      setRouteLabel(geo.label);

      const origin = await new Promise<LatLng>((resolve, reject) => {
        if (!('geolocation' in navigator)) return reject(new Error('Géolocalisation non disponible.'));
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => reject(new Error('Position actuelle indisponible. Autorisez la géolocalisation.')),
          { enableHighAccuracy: true, timeout: 10000 }
        );
      });

      setRoute(await fetchRoute(origin, { lat: geo.lat, lng: geo.lng }));
    } catch (e) {
      setRouteError((e as Error).message);
    } finally {
      setRouteLoading(false);
    }
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
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="logo">◈</span>
          <h1>RouteTrack</h1>
        </div>
        <label className="traffic-toggle">
          <input type="checkbox" checked={showTraffic} onChange={(e) => setShowTraffic(e.target.checked)} />
          Afficher le trafic sur la carte
        </label>
      </header>

      {state.error && <div className="banner banner-err">{state.error}</div>}
      {toast && <div className={`toast ${toast.kind === 'ok' ? 'toast-ok' : 'toast-err'}`}>{toast.text}</div>}

      <main className="layout">
        <section className="col col-left">
          <div className="panel dashboard">
            <Speedometer speedKmh={state.speedKmh} />
            <StatsPanel
              distanceKm={state.distanceKm}
              durationMs={state.durationMs}
              avgSpeedKmh={state.avgSpeedKmh}
              maxSpeedKmh={state.maxSpeedKmh}
            />
          </div>

          <div className="panel controls">
            <label className="field">
              <span className="field-label">Destination / adresse</span>
              <div className="input-row">
                <input
                  type="text"
                  className="input"
                  placeholder="Ex : 123 rue Sainte-Catherine, Montréal"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !state.tracking) handleFindRoute();
                  }}
                  disabled={state.tracking}
                />
                <button
                  className="btn btn-route btn-sm"
                  onClick={handleFindRoute}
                  disabled={state.tracking || routeLoading}
                  title="Trouver l'itinéraire vers cette adresse"
                >
                  🧭 Itinéraire
                </button>
              </div>
            </label>
            <div className="button-row">
              {!state.tracking ? (
                <button className="btn btn-start" onClick={handleStart}>
                  ▶ Démarrer le suivi
                </button>
              ) : (
                <button className="btn btn-stop" onClick={stop}>
                  ■ Arrêter
                </button>
              )}
              <button className="btn btn-ghost" onClick={reset} disabled={state.tracking}>
                ↺ Réinitialiser
              </button>
            </div>
            {state.accuracy != null && state.tracking && (
              <p className="muted small">Précision GPS : ±{Math.round(state.accuracy)} m</p>
            )}
          </div>

          <RoutePanel label={routeLabel} route={route} loading={routeLoading} error={routeError} />

          <SuggestionPanel best={best} eta={eta} etaError={etaError} loading={suggestionLoading} />
        </section>

        <section className="col col-right">
          <TripMap
            path={state.path}
            position={state.position}
            suggestionPath={best?.path ?? null}
            routePath={route?.points ?? null}
            destination={destCoords}
            showTraffic={showTraffic}
          />
          <TripHistory trips={trips} onDelete={handleDelete} onClear={handleClear} />
        </section>
      </main>

      <footer className="app-footer">
        <span className="muted small">RouteTrack — suivi automobile · Tuiles © OpenStreetMap · Trafic © TomTom</span>
      </footer>
    </div>
  );
}
