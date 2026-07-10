import type { Trip } from '../lib/types';
import { formatDate, formatDuration } from '../lib/geo';

interface Props {
  trips: Trip[];
  onDelete: (id: string) => void;
  onClear: () => void;
}

export function TripHistory({ trips, onDelete, onClear }: Props) {
  return (
    <div className="panel history">
      <div className="history-header">
        <h3 className="panel-title">Historique des trajets</h3>
        {trips.length > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={onClear}>
            Tout effacer
          </button>
        )}
      </div>

      {trips.length === 0 ? (
        <p className="muted">Aucun trajet enregistré pour le moment.</p>
      ) : (
        <ul className="trip-list">
          {trips.map((t) => (
            <li key={t.id} className="trip-item">
              <div className="trip-main">
                <span className="trip-dest">{t.destination}</span>
                <span className="muted small">{formatDate(t.started_at)}</span>
              </div>
              <div className="trip-stats">
                <span>{t.distance_km.toFixed(1)} km</span>
                <span>{formatDuration(t.duration_ms)}</span>
                <span className="amber-text">{t.avg_speed_kmh.toFixed(0)} km/h</span>
              </div>
              <button
                className="btn btn-icon"
                aria-label={`Supprimer le trajet vers ${t.destination}`}
                onClick={() => onDelete(t.id)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
