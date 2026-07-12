import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { LatLng, Report, SpeedCamera } from '../lib/types';

interface Props {
  path: LatLng[];
  position: LatLng | null;
  heading?: number | null;
  suggestionPath?: LatLng[] | null;
  routePath?: LatLng[] | null;
  origin?: LatLng | null;
  destination?: LatLng | null;
  showTraffic: boolean;
  recenterNonce?: number;
  onFollowChange?: (following: boolean) => void;
  courseUp?: boolean; // carte orientée dans le sens de la marche (mode navigation)
  reports?: Report[];
  speedCameras?: SpeedCamera[];
}

// Icône selon le type d'appareil officiel (radar / feu rouge).
function cameraEmoji(deviceType: string): string {
  const t = deviceType.toLowerCase();
  if (t.includes('feu rouge') && t.includes('fixe')) return '🚦📷';
  if (t.includes('feu rouge')) return '🚦';
  if (t.includes('mobile')) return '🎥';
  return '📷';
}

const REPORT_EMOJI: Record<string, string> = {
  police: '🚓',
  accident: '⚠️',
  obstacle: '🚧',
};

const MONTREAL: L.LatLngExpression = [45.5017, -73.5673];

// Voiture vue de dessus, pointant vers le haut (nord) ; on la fait pivoter selon le cap.
const CAR_SVG = `
<svg width="38" height="38" viewBox="0 0 38 38" xmlns="http://www.w3.org/2000/svg">
  <circle cx="19" cy="19" r="17" fill="#0a0d0f" fill-opacity="0.5"/>
  <path d="M19 5 L25 12 V27 Q25 31 21 31 H17 Q13 31 13 27 V12 Z" fill="#2dd4bf" stroke="#0a0d0f" stroke-width="1.6"/>
  <rect x="15" y="13.5" width="8" height="5.5" rx="1.4" fill="#0a0d0f" fill-opacity="0.65"/>
  <circle cx="19" cy="27" r="1.5" fill="#0a0d0f" fill-opacity="0.5"/>
</svg>`;

const carIcon = L.divIcon({
  className: 'car-marker',
  html: `<div class="car-rot">${CAR_SVG}</div>`,
  iconSize: [38, 38],
  iconAnchor: [19, 19],
});

export function TripMap({
  path,
  position,
  heading,
  suggestionPath,
  routePath,
  origin,
  destination,
  showTraffic,
  recenterNonce,
  onFollowChange,
  courseUp,
  reports,
  speedCameras,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const liveLine = useRef<L.Polyline | null>(null);
  const liveCasing = useRef<L.Polyline | null>(null);
  const suggestLine = useRef<L.Polyline | null>(null);
  const routeLine = useRef<L.Polyline | null>(null);
  const routeCasing = useRef<L.Polyline | null>(null);
  const destMarker = useRef<L.CircleMarker | null>(null);
  const originMarker = useRef<L.CircleMarker | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const trafficLayer = useRef<L.TileLayer | null>(null);
  const reportLayer = useRef<L.LayerGroup | null>(null);
  const cameraLayer = useRef<L.LayerGroup | null>(null);
  const hasCentered = useRef(false);
  const followRef = useRef(true); // la carte suit la voiture tant que l'utilisateur ne la déplace pas
  // Animation fluide de la voiture : position/cap affichés (interpolés) + rAF en cours.
  const dispPos = useRef<{ lat: number; lng: number } | null>(null);
  const dispHeading = useRef(0);
  const rafId = useRef<number | null>(null);
  const courseUpRef = useRef(false);
  courseUpRef.current = !!courseUp;
  const onFollowChangeRef = useRef(onFollowChange);
  onFollowChangeRef.current = onFollowChange;

  // Initialisation de la carte (une seule fois).
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: MONTREAL,
      zoom: 13,
      zoomControl: false, // look épuré style Waze/Google Maps (zoom au pincement/molette)
      attributionControl: false, // le conteneur est agrandi pour la rotation → crédit en surimpression
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);

    // Itinéraire planifié : contour foncé + ligne bleue par-dessus, bouts et
    // angles arrondis (style Google Maps, doux plutôt que « sec »).
    const soft: L.PolylineOptions = { lineCap: 'round', lineJoin: 'round' };
    routeCasing.current = L.polyline([], { ...soft, color: '#123a63', weight: 10, opacity: 0.9 }).addTo(map);
    routeLine.current = L.polyline([], { ...soft, color: '#4d9fff', weight: 5, opacity: 1 }).addTo(map);
    // Tracé parcouru en direct : halo léger + ligne sarcelle.
    liveCasing.current = L.polyline([], { ...soft, color: '#0a0d0f', weight: 8, opacity: 0.35 }).addTo(map);
    liveLine.current = L.polyline([], { ...soft, color: '#2dd4bf', weight: 4, opacity: 0.95 }).addTo(map);
    suggestLine.current = L.polyline([], {
      ...soft,
      color: '#ffb020',
      weight: 4,
      opacity: 0.85,
      dashArray: '1 12', // pointillé en petits points ronds, plus délicat
    }).addTo(map);
    reportLayer.current = L.layerGroup().addTo(map);
    cameraLayer.current = L.layerGroup().addTo(map);

    // Si l'utilisateur déplace la carte au doigt, on cesse de suivre la voiture.
    map.on('dragstart', () => {
      if (followRef.current) {
        followRef.current = false;
        onFollowChangeRef.current?.(false);
      }
    });

    mapRef.current = map;

    // Leaflet a parfois besoin d'un recalcul après le montage.
    setTimeout(() => map.invalidateSize(), 200);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Mise à jour du tracé en direct + marqueur voiture (suivi navigation).
  // La voiture GLISSE d'un point GPS au suivant (interpolation ~0,9 s) au lieu
  // de sauter, et sa rotation prend toujours le plus court chemin angulaire.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !liveLine.current) return;

    const latlngs = path.map((p) => [p.lat, p.lng] as L.LatLngTuple);
    liveLine.current.setLatLngs(latlngs);
    liveCasing.current?.setLatLngs(latlngs);

    if (!position) return;

    const applyFrame = (lat: number, lng: number, h: number) => {
      marker.current?.setLatLng([lat, lng]);
      const el = marker.current?.getElement()?.querySelector('.car-rot') as HTMLElement | null;
      if (el) el.style.transform = `rotate(${h}deg)`;
      // Mode « course-up » : la carte tourne pour que la route reste devant,
      // synchronisée avec la voiture dans la même frame.
      if (courseUpRef.current && containerRef.current) {
        containerRef.current.style.transform = `rotate(${-h}deg)`;
      }
      // La carte suit la voiture image par image → défilement parfaitement fluide.
      if (followRef.current && hasCentered.current) {
        map.setView([lat, lng], map.getZoom(), { animate: false });
      }
    };

    const targetHeading = typeof heading === 'number' ? heading : dispHeading.current;

    // Premier point : on se place directement (rien à animer).
    if (!marker.current || !dispPos.current) {
      const ll: L.LatLngTuple = [position.lat, position.lng];
      if (!marker.current) {
        marker.current = L.marker(ll, { icon: carIcon, interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(map);
      }
      dispPos.current = { ...position };
      dispHeading.current = targetHeading;
      if (!hasCentered.current) {
        map.setView(ll, 17);
        hasCentered.current = true;
      }
      applyFrame(position.lat, position.lng, targetHeading);
      return;
    }

    // Animation : de la position affichée actuelle vers le nouveau point GPS.
    if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    const from = { ...dispPos.current };
    const fromH = dispHeading.current;
    // Plus court chemin angulaire (ex. 350° → 10° tourne de +20°, pas −340°).
    const deltaH = ((targetHeading - fromH + 540) % 360) - 180;
    const start = performance.now();
    const DURATION = 900; // ≈ cadence des mises à jour GPS → mouvement continu

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      const lat = from.lat + (position.lat - from.lat) * t;
      const lng = from.lng + (position.lng - from.lng) * t;
      const h = fromH + deltaH * t;
      dispPos.current = { lat, lng };
      dispHeading.current = ((h % 360) + 360) % 360;
      applyFrame(lat, lng, h);
      if (t < 1) rafId.current = requestAnimationFrame(step);
      else rafId.current = null;
    };
    rafId.current = requestAnimationFrame(step);

    return () => {
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
    };
  }, [path, position, heading]);

  // Active/désactive le mode navigation (carte agrandie + rotation + suivi verrouillé).
  useEffect(() => {
    const map = mapRef.current;
    const el = containerRef.current;
    if (!map || !el) return;

    if (courseUp) {
      el.classList.add('map--nav');
      map.dragging.disable(); // en navigation, la carte suit toujours la voiture
      followRef.current = true;
      onFollowChangeRef.current?.(true);
    } else {
      el.classList.remove('map--nav');
      el.style.transform = '';
      map.dragging.enable();
    }

    // Le conteneur change de taille : on recalcule et on recentre.
    setTimeout(() => {
      map.invalidateSize();
      if (marker.current) {
        map.setView(marker.current.getLatLng(), courseUp ? 17 : map.getZoom(), { animate: false });
      }
    }, 80);
  }, [courseUp]);

  // Recentrer sur la voiture (déclenché par le bouton) → réactive le suivi.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !recenterNonce) return; // ignore la valeur initiale (0)
    if (marker.current) {
      map.setView(marker.current.getLatLng(), Math.max(map.getZoom(), 16), { animate: true });
    }
    followRef.current = true;
    onFollowChangeRef.current?.(true);
  }, [recenterNonce]);

  // Tracé de suggestion (pointillé).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !suggestLine.current) return;
    const latlngs = (suggestionPath ?? []).map((p) => [p.lat, p.lng] as L.LatLngTuple);
    suggestLine.current.setLatLngs(latlngs);
    if (latlngs.length > 1 && path.length === 0) {
      map.fitBounds(suggestLine.current.getBounds(), { padding: [40, 40] });
    }
  }, [suggestionPath, path.length]);

  // Itinéraire planifié + marqueurs de départ (vert) et de destination (rouge).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !routeLine.current) return;

    const latlngs = (routePath ?? []).map((p) => [p.lat, p.lng] as L.LatLngTuple);
    routeLine.current.setLatLngs(latlngs);
    routeCasing.current?.setLatLngs(latlngs);

    const upsertMarker = (
      ref: typeof destMarker,
      point: LatLng | null | undefined,
      color: string,
      tooltip: string
    ) => {
      if (point) {
        const ll: L.LatLngTuple = [point.lat, point.lng];
        if (!ref.current) {
          ref.current = L.circleMarker(ll, {
            radius: 9,
            color: '#0a0d0f',
            weight: 2,
            fillColor: color,
            fillOpacity: 1,
          }).addTo(map);
          ref.current.bindTooltip(tooltip, { direction: 'top', offset: [0, -8] });
        } else {
          ref.current.setLatLng(ll);
        }
      } else if (ref.current) {
        map.removeLayer(ref.current);
        ref.current = null;
      }
    };

    upsertMarker(destMarker, destination, '#ff4d4f', 'Destination');
    upsertMarker(originMarker, origin, '#2dd4bf', 'Départ');

    // Cadre la carte pour montrer départ + destination (+ itinéraire) hors suivi.
    if (path.length === 0) {
      const pts: L.LatLngTuple[] = [...latlngs];
      if (origin) pts.push([origin.lat, origin.lng]);
      if (destination) pts.push([destination.lat, destination.lng]);
      if (pts.length >= 2) {
        map.fitBounds(L.latLngBounds(pts), { padding: [50, 50] });
      } else if (pts.length === 1) {
        map.setView(pts[0], 14);
      }
    }
  }, [routePath, origin, destination, path.length]);

  // Couche de trafic TomTom (proxy backend).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (showTraffic && !trafficLayer.current) {
      trafficLayer.current = L.tileLayer('/api/traffic/tile/{z}/{x}/{y}', {
        opacity: 0.7,
        maxZoom: 19,
      });
      trafficLayer.current.addTo(map);
    } else if (!showTraffic && trafficLayer.current) {
      map.removeLayer(trafficLayer.current);
      trafficLayer.current = null;
    }
  }, [showTraffic]);

  // Signalements communautaires (police, accident, obstacle) — façon Waze.
  useEffect(() => {
    const layer = reportLayer.current;
    if (!layer) return;
    layer.clearLayers();
    for (const r of reports ?? []) {
      const emoji = REPORT_EMOJI[r.type] ?? '⚠️';
      const icon = L.divIcon({
        className: 'report-marker',
        html: `<div class="report-pin">${emoji}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });
      const ageMin = Math.max(0, Math.round((Date.now() - r.created_at) / 60000));
      L.marker([r.lat, r.lng], { icon, interactive: true, keyboard: false })
        .bindTooltip(`Signalé il y a ${ageMin} min`, { direction: 'top', offset: [0, -10] })
        .addTo(layer);
    }
  }, [reports]);

  // Radars photo / feux rouges officiels du Québec (position fixe, source gouvernementale).
  useEffect(() => {
    const layer = cameraLayer.current;
    if (!layer) return;
    layer.clearLayers();
    for (const cam of speedCameras ?? []) {
      const icon = L.divIcon({
        className: 'camera-marker',
        html: `<div class="camera-pin">${cameraEmoji(cam.deviceType)}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
      L.marker([cam.lat, cam.lng], { icon, interactive: true, keyboard: false })
        .bindTooltip(`${cam.deviceType} — ${cam.description}`, { direction: 'top', offset: [0, -10] })
        .addTo(layer);
    }
  }, [speedCameras]);

  return <div ref={containerRef} className="map" aria-label="Carte du trajet" />;
}
