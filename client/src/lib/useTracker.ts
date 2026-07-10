import { useCallback, useRef, useState } from 'react';
import type { LatLng } from './types';
import { haversineMeters } from './geo';

export interface TrackerState {
  tracking: boolean;
  speedKmh: number; // vitesse instantanée
  distanceKm: number;
  durationMs: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
  path: LatLng[];
  position: LatLng | null;
  accuracy: number | null;
  error: string | null;
}

const INITIAL: TrackerState = {
  tracking: false,
  speedKmh: 0,
  distanceKm: 0,
  durationMs: 0,
  avgSpeedKmh: 0,
  maxSpeedKmh: 0,
  path: [],
  position: null,
  accuracy: null,
  error: null,
};

// Sous ce seuil de précision (m) ou de déplacement, on ignore le point
// pour éviter que le bruit GPS ne gonfle la distance à l'arrêt.
const MIN_MOVE_METERS = 3;

export function useTracker() {
  const [state, setState] = useState<TrackerState>(INITIAL);

  const watchId = useRef<number | null>(null);
  const startTime = useRef<number>(0);
  const durationTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPoint = useRef<{ pos: LatLng; time: number } | null>(null);
  const totalMeters = useRef<number>(0);
  const maxSpeed = useRef<number>(0);

  const stop = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    if (durationTimer.current) {
      clearInterval(durationTimer.current);
      durationTimer.current = null;
    }
    setState((s) => ({ ...s, tracking: false, speedKmh: 0 }));
  }, []);

  const reset = useCallback(() => {
    stop();
    lastPoint.current = null;
    totalMeters.current = 0;
    maxSpeed.current = 0;
    setState(INITIAL);
  }, [stop]);

  const start = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setState((s) => ({ ...s, error: "La géolocalisation n'est pas prise en charge par cet appareil." }));
      return;
    }

    // Réinitialise les compteurs pour un nouveau trajet.
    lastPoint.current = null;
    totalMeters.current = 0;
    maxSpeed.current = 0;
    startTime.current = Date.now();

    setState({ ...INITIAL, tracking: true });

    durationTimer.current = setInterval(() => {
      setState((s) => (s.tracking ? { ...s, durationMs: Date.now() - startTime.current } : s));
    }, 1000);

    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const now = pos.timestamp || Date.now();
        const current: LatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };

        let instant = 0;
        let addedMeters = 0;

        if (lastPoint.current) {
          const d = haversineMeters(lastPoint.current.pos, current);
          const dt = (now - lastPoint.current.time) / 1000; // s

          if (d >= MIN_MOVE_METERS) {
            addedMeters = d;
            totalMeters.current += d;
            // Vitesse : coords.speed (m/s) si dispo et fiable, sinon distance/temps.
            if (typeof pos.coords.speed === 'number' && pos.coords.speed >= 0) {
              instant = pos.coords.speed * 3.6;
            } else if (dt > 0) {
              instant = (d / dt) * 3.6;
            }
          } else if (typeof pos.coords.speed === 'number' && pos.coords.speed > 0) {
            instant = pos.coords.speed * 3.6;
          }
        } else if (typeof pos.coords.speed === 'number' && pos.coords.speed > 0) {
          instant = pos.coords.speed * 3.6;
        }

        // Filtre les valeurs aberrantes (> 250 km/h).
        if (!Number.isFinite(instant) || instant > 250) instant = 0;
        if (instant > maxSpeed.current) maxSpeed.current = instant;

        lastPoint.current = { pos: current, time: now };

        setState((s) => {
          const path = addedMeters > 0 || s.path.length === 0 ? [...s.path, current] : s.path;
          const distanceKm = totalMeters.current / 1000;
          const elapsedHours = (Date.now() - startTime.current) / 3_600_000;
          const avg = elapsedHours > 0 ? distanceKm / elapsedHours : 0;
          return {
            ...s,
            speedKmh: instant,
            distanceKm,
            avgSpeedKmh: avg,
            maxSpeedKmh: maxSpeed.current,
            path,
            position: current,
            accuracy: pos.coords.accuracy ?? null,
            error: null,
          };
        });
      },
      (err) => {
        let message = 'Erreur de géolocalisation.';
        if (err.code === err.PERMISSION_DENIED) {
          message = "Accès à la localisation refusé. Autorisez la géolocalisation pour suivre votre trajet.";
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          message = 'Position indisponible. Vérifiez votre signal GPS.';
        } else if (err.code === err.TIMEOUT) {
          message = 'Délai de géolocalisation dépassé.';
        }
        setState((s) => ({ ...s, error: message }));
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
  }, []);

  return { state, start, stop, reset };
}
