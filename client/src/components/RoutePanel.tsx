import type { RouteResult } from '../lib/types';
import { formatSecondsLabel } from '../lib/geo';

interface Props {
  label: string;
  route: RouteResult | null;
  loading: boolean;
  error: string | null;
}

export function RoutePanel({ label, route, loading, error }: Props) {
  if (!loading && !route && !error) return null;

  let trafficBadge: { text: string; cls: string } | null = null;
  if (route && route.liveSeconds != null && route.freeFlowSeconds != null) {
    const delta = route.liveSeconds - route.freeFlowSeconds;
    if (delta > 60) trafficBadge = { text: `+${formatSecondsLabel(delta)} vs normal`, cls: 'badge-slow' };
    else if (delta < -60) trafficBadge = { text: `${formatSecondsLabel(Math.abs(delta))} plus rapide`, cls: 'badge-fast' };
    else trafficBadge = { text: 'Trafic fluide', cls: 'badge-ok' };
  }

  return (
    <div className="panel suggestion">
      <h3 className="panel-title">🧭 Itinéraire</h3>

      {loading && <p className="muted">Calcul de l'itinéraire…</p>}
      {error && <p className="error-text">{error}</p>}

      {route && route.liveSeconds != null && (
        <div className="suggestion-body">
          <p className="suggestion-line">
            Vers <strong>{label}</strong>
          </p>
          <div className="eta-row">
            <div className="eta-time">
              <span className="eta-value">{formatSecondsLabel(route.liveSeconds)}</span>
              <span className="muted small">
                temps estimé maintenant
                {route.distanceMeters != null && ` · ${(route.distanceMeters / 1000).toFixed(1)} km`}
              </span>
            </div>
            {trafficBadge && <span className={`traffic-badge ${trafficBadge.cls}`}>{trafficBadge.text}</span>}
          </div>
          <p className="muted small dashed-hint" style={{ color: '#4d9fff', opacity: 0.85 }}>
            ▬ Itinéraire tracé en bleu sur la carte
          </p>
        </div>
      )}
    </div>
  );
}
