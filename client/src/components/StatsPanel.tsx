import { formatDuration } from '../lib/geo';

interface Props {
  distanceKm: number;
  durationMs: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
}

export function StatsPanel({ distanceKm, durationMs, avgSpeedKmh, maxSpeedKmh }: Props) {
  const items = [
    { label: 'Distance', value: distanceKm.toFixed(2), unit: 'km', accent: 'teal' },
    { label: 'Durée', value: formatDuration(durationMs), unit: '', accent: 'teal' },
    { label: 'Vitesse moy.', value: avgSpeedKmh.toFixed(0), unit: 'km/h', accent: 'amber' },
    { label: 'Vitesse max.', value: maxSpeedKmh.toFixed(0), unit: 'km/h', accent: 'amber' },
  ];

  return (
    <div className="stats-grid">
      {items.map((it) => (
        <div key={it.label} className={`stat-card stat-${it.accent}`}>
          <div className="stat-label">{it.label}</div>
          <div className="stat-value">
            {it.value}
            {it.unit && <span className="stat-unit"> {it.unit}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
