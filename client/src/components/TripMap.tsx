import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { LatLng } from '../lib/types';

interface Props {
  path: LatLng[];
  position: LatLng | null;
  suggestionPath?: LatLng[] | null;
  showTraffic: boolean;
}

const MONTREAL: L.LatLngExpression = [45.5017, -73.5673];

export function TripMap({ path, position, suggestionPath, showTraffic }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const liveLine = useRef<L.Polyline | null>(null);
  const suggestLine = useRef<L.Polyline | null>(null);
  const marker = useRef<L.CircleMarker | null>(null);
  const trafficLayer = useRef<L.TileLayer | null>(null);
  const hasCentered = useRef(false);

  // Initialisation de la carte (une seule fois).
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: MONTREAL,
      zoom: 13,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);

    liveLine.current = L.polyline([], { color: '#2dd4bf', weight: 5, opacity: 0.9 }).addTo(map);
    suggestLine.current = L.polyline([], {
      color: '#ffb020',
      weight: 4,
      opacity: 0.85,
      dashArray: '8 10',
    }).addTo(map);

    mapRef.current = map;

    // Leaflet a parfois besoin d'un recalcul après le montage.
    setTimeout(() => map.invalidateSize(), 200);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Mise à jour du tracé en direct + marqueur.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !liveLine.current) return;

    const latlngs = path.map((p) => [p.lat, p.lng] as L.LatLngTuple);
    liveLine.current.setLatLngs(latlngs);

    if (position) {
      const ll: L.LatLngTuple = [position.lat, position.lng];
      if (!marker.current) {
        marker.current = L.circleMarker(ll, {
          radius: 8,
          color: '#0a0d0f',
          weight: 2,
          fillColor: '#2dd4bf',
          fillOpacity: 1,
        }).addTo(map);
      } else {
        marker.current.setLatLng(ll);
      }
      if (!hasCentered.current) {
        map.setView(ll, 15);
        hasCentered.current = true;
      } else {
        map.panTo(ll, { animate: true });
      }
    }
  }, [path, position]);

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
