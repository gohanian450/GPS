interface Props {
  speedKmh: number;
  max?: number;
}

const MAX_DEFAULT = 160;

// Jauge semi-circulaire style compteur automobile (0 → max km/h).
export function Speedometer({ speedKmh, max = MAX_DEFAULT }: Props) {
  const clamped = Math.max(0, Math.min(speedKmh, max));
  const cx = 150;
  const cy = 150;
  const r = 120;

  // L'aiguille balaie 180° : -90° (gauche, 0) → +90° (droite, max).
  const angle = -90 + (clamped / max) * 180;
  const rad = (angle * Math.PI) / 180;
  const needleLen = 108;
  const nx = cx + needleLen * Math.cos(rad);
  const ny = cy + needleLen * Math.sin(rad);

  // Graduations tous les 20 km/h.
  const ticks = [];
  for (let v = 0; v <= max; v += 20) {
    const a = (-90 + (v / max) * 180) * (Math.PI / 180);
    const inner = r - 14;
    const outer = r;
    ticks.push(
      <g key={v}>
        <line
          x1={cx + inner * Math.cos(a)}
          y1={cy + inner * Math.sin(a)}
          x2={cx + outer * Math.cos(a)}
          y2={cy + outer * Math.sin(a)}
          stroke="#4a5560"
          strokeWidth={2}
        />
        <text
          x={cx + (inner - 16) * Math.cos(a)}
          y={cy + (inner - 16) * Math.sin(a) + 4}
          fill="#8a97a3"
          fontSize="12"
          fontFamily="'JetBrains Mono', monospace"
          textAnchor="middle"
        >
          {v}
        </text>
      </g>
    );
  }

  // Arc de progression (couleur ambre).
  const arcEnd = describeArc(cx, cy, r, -90, angle);
  const arcFull = describeArc(cx, cy, r, -90, 90);

  return (
    <div className="speedo">
      <svg viewBox="0 0 300 190" className="speedo-svg" role="img" aria-label={`Vitesse ${Math.round(clamped)} km/h`}>
        {/* Arc de fond */}
        <path d={arcFull} fill="none" stroke="#1c2429" strokeWidth={14} strokeLinecap="round" />
        {/* Arc actif */}
        <path d={arcEnd} fill="none" stroke="#ffb020" strokeWidth={14} strokeLinecap="round" />
        {ticks}
        {/* Aiguille */}
        <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="#ff4d4f" strokeWidth={4} strokeLinecap="round" className="needle" />
        <circle cx={cx} cy={cy} r={9} fill="#12171a" stroke="#ff4d4f" strokeWidth={3} />
      </svg>
      <div className="speedo-readout">
        <span className="speedo-value">{Math.round(clamped)}</span>
        <span className="speedo-unit">km/h</span>
      </div>
    </div>
  );
}

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const start = polar(cx, cy, r, startDeg);
  const end = polar(cx, cy, r, endDeg);
  const largeArc = endDeg - startDeg <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}
