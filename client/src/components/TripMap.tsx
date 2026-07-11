import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { LatLng } from '../lib/types';

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
}

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
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const liveLine = useRef<L.Polyline | null>(null);
  const suggestLine = useRef<L.Polyline | null>(null);
  const routeLine = useRef<L.Polyline | null>(null);
  const destMarker = useRef<L.CircleMarker | null>(null);
  const originMarker = useRef<L.CircleMarker | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const trafficLayer = useRef<L.TileLayer | null>(null);
  const hasCentered = useRef(false);
  const followRef = useRef(true); // la carte suit la voiture tant que l'utilisateur ne la déplace pas
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

    // Itinéraire planifié vers l'adresse (ligne pleine bleu navigation).
    routeLine.current = L.polyline([], { color: '#4d9fff', weight: 6, opacity: 0.85 }).addTo(map);
    liveLine.current = L.polyline([], { color: '#2dd4bf', weight: 5, opacity: 0.9 }).addTo(map);
    suggestLine.current = L.polyline([], {
      color: '#ffb020',
      weight: 4,
      opacity: 0.85,
      dashArray: '8 10',
    }).addTo(map);

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
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !liveLine.current) return;

    const latlngs = path.map((p) => [p.lat, p.lng] as L.LatLngTuple);
    liveLine.current.setLatLngs(latlngs);

    if (position) {
      const ll: L.LatLngTuple = [position.lat, position.lng];
      if (!marker.current) {
        marker.current = L.marker(ll, { icon: carIcon, interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(map);
      } else {
        marker.current.setLatLng(ll);
      }
      // Oriente la voiture selon le cap.
      const el = marker.current.getElement()?.querySelector('.car-rot') as HTMLElement | null;
      if (el && typeof heading === 'number') {
        el.style.transform = `rotate(${heading}deg)`;
      }
      // Suivi façon navigation : zoom serré au premier point, puis la carte suit
      // la voiture — sauf si l'utilisateur a déplacé la carte manuellement.
      if (!hasCentered.current) {
        map.setView(ll, 17);
        hasCentered.current = true;
      } else if (followRef.current) {
        map.panTo(ll, { animate: true, duration: 0.5 });
      }

      // Mode « course-up » : on tourne la carte pour que le sens de la marche
      // pointe vers le haut (on voit toujours la route devant).
      if (courseUp && containerRef.current && typeof heading === 'number') {
        containerRef.current.style.transform = `rotate(${-heading}deg)`;
      }
    }
  }, [path, position, heading, courseUp]);

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

  return <div ref={containerRef} className="map" aria-label="Carte du trajet" />;
}
