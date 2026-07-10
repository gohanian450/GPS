import type { Trip, EtaResult } from '../lib/types';
import { formatDate, formatDuration, formatSecondsLabel } from '../lib/geo';

interface Props {
  best: Trip | null;
  eta: EtaResult | null;
  etaError: string | null;
  loading: boolean;
}

export function SuggestionPanel({ best, eta, etaError, loading }: Props) {
  if (loading) {
    return <div className="panel suggestion"><p className="muted">Recherche dans l'historique…</p></div>;
  }

  if (!best && !eta && !etaError) return null;

  // Badge de comparaison trafic (plus lent / plus rapide que la normale).
  let trafficBadge: { text: string; cls: string } | null = null;
  if (eta && eta.liveSeconds != null && eta.freeFlowSeconds != null) {
    const delta = eta.liveSeconds - eta.freeFlowSeconds;
    if (delta > 60) {
      trafficBadge = { text: `+${formatSecondsLabel(delta)} vs normal`, cls: 'badge-slow' };
    } else if (delta < -60) {
      trafficBadge = { text: `${formatSecondsLabel(Math.abs(delta))} plus rapide`, cls: 'badge-fast' };
    } else {
      trafficBadge = { text: 'Trafic fluide', cls: 'badge-ok' };
    }
  }

  return (
    <div className="panel suggestion">
      <h3 className="panel-title">Suggestion basée sur l'historique</h3>

      {best ? (
        <div className="suggestion-body">
          <p className="suggestion-line">
            Votre meilleur trajet vers <strong>{best.destination}</strong> :
          </p>
          <div className="suggestion-metrics">
            <span className="metric-chip amber">{formatDuration(best.duration_ms)}</span>
            <span className="metric-chip teal">{best.avg_speed_kmh.toFixed(0)} km/h moy.</span>
            <span className="metric-chip">{best.distance_km.toFixed(1)} km</span>
          </div>
          <p className="muted small">Réalisé le {formatDate(best.started_at)}</p>
          <p className="muted small dashed-hint">— — Tracé affiché en pointillé ambre sur la carte</p>
        </div>
      ) : (
        <p className="muted">Aucun trajet passé vers cette destination.</p>
      )}

      <div className="eta-block">
        <h4 className="eta-title">Trafic en direct</h4>
        {etaError && <p className="error-text">{etaError}</p>}
        {eta && eta.liveSeconds != null ? (
          <div className="eta-row">
            <div className="eta-time">
              <span className="eta-value">{formatSecondsLabel(eta.liveSeconds)}</span>
              <span className="muted small">temps estimé maintenant</span>
            </div>
            {trafficBadge && <span className={`traffic-badge ${trafficBadge.cls}`}>{trafficBadge.text}</span>}
          </div>
        ) : (
          !etaError && <p className="muted small">Temps de trafic indisponible.</p>
        )}
      </div>
    </div>
  );
}
