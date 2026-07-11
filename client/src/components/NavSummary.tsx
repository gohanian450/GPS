import { formatSecondsLabel } from '../lib/geo';

interface Props {
  remainingMeters: number;
  remainingSeconds: number | null;
  arrivalAt: number | null;
}

function formatArrival(ts: number): string {
  return new Date(ts).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// Résumé de navigation en cours : temps restant, distance restante, heure d'arrivée.
export function NavSummary({ remainingMeters, remainingSeconds, arrivalAt }: Props) {
  const km = remainingMeters >= 1000 ? `${(remainingMeters / 1000).toFixed(1)} km` : `${Math.round(remainingMeters / 10) * 10} m`;

  return (
    <div className="ov-navsum">
      <span className="ov-navsum-time">
        {remainingSeconds != null ? formatSecondsLabel(remainingSeconds) : '—'}
      </span>
      <span className="ov-navsum-sub">
        {km}
        {arrivalAt != null && ` · arrivée ${formatArrival(arrivalAt)}`}
      </span>
    </div>
  );
}
