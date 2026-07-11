import type { NavInstruction } from '../lib/types';

interface Props {
  instruction: NavInstruction;
  distanceMeters: number | null;
}

// Icône de manœuvre selon le type renvoyé par TomTom.
function maneuverIcon(m: string): string {
  const s = m.toUpperCase();
  if (s.includes('ARRIVE')) return '🏁';
  if (s.includes('DEPART')) return '🚗';
  if (s.includes('ROUNDABOUT')) return '🔄';
  if (s.includes('UTURN')) return '↩️';
  if (s.includes('LEFT')) return '⬅️';
  if (s.includes('RIGHT')) return '➡️';
  return '⬆️'; // tout droit / continuer
}

function formatDist(m: number | null): string {
  if (m == null) return '';
  if (m < 1000) return `${Math.max(0, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

export function NavBanner({ instruction, distanceMeters }: Props) {
  return (
    <div className="ov-nav">
      <span className="ov-nav-icon">{maneuverIcon(instruction.maneuver)}</span>
      <div className="ov-nav-text">
        {distanceMeters != null && <span className="ov-nav-dist">{formatDist(distanceMeters)}</span>}
        <span className="ov-nav-instr">{instruction.text || instruction.street || 'Continuez'}</span>
      </div>
    </div>
  );
}
