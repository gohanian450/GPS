export interface LatLng {
  lat: number;
  lng: number;
}

export interface Trip {
  id: string;
  destination: string;
  started_at: number;
  duration_ms: number;
  distance_km: number;
  avg_speed_kmh: number;
  max_speed_kmh: number;
  path: LatLng[];
}

export interface EtaResult {
  liveSeconds: number | null;
  freeFlowSeconds: number | null;
  trafficDelaySeconds: number;
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  label: string;
}

export interface SearchSuggestion {
  id: string;
  label: string;
  lat: number;
  lng: number;
}

export interface NavInstruction {
  text: string;
  maneuver: string;
  street?: string;
  routeOffsetInMeters: number;
  lat: number | null;
  lng: number | null;
}

export interface SpeedLimitSection {
  startPointIndex: number;
  endPointIndex: number;
  speedKmh: number;
}

export interface RouteResult {
  liveSeconds: number | null;
  freeFlowSeconds: number | null;
  trafficDelaySeconds: number;
  distanceMeters: number | null;
  points: LatLng[];
  instructions: NavInstruction[];
  speedLimits?: SpeedLimitSection[];
}
