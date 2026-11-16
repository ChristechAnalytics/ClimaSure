"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";

export interface MapPoint {
  lat: number;
  lon: number;
  popupHtml?: string;
}

const NIGERIA: [number, number] = [9.1, 8.2];

function cssVar(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** OpenStreetMap with circle markers. Pass onPick to let the user click a location. */
export function PolicyMap({ points = [], onPick, picked, className = "h-[340px]" }: { points?: MapPoint[]; onPick?: (lat: number, lon: number) => void; picked?: { lat: number; lon: number } | null; className?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const L = useRef<typeof Leaflet | null>(null);
  const layer = useRef<Leaflet.LayerGroup | null>(null);
  const pickMarker = useRef<Leaflet.CircleMarker | null>(null);
  const onPickRef = useRef(onPick);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    onPickRef.current = onPick;
  });

  // Create the map once (Leaflet needs the browser, so it is imported here).
  useEffect(() => {
    let cancelled = false;
    import("leaflet")
      .then((mod) => {
        if (cancelled || !el.current) return;
        const lf = (mod as unknown as { default?: typeof Leaflet }).default ?? (mod as unknown as typeof Leaflet);
        L.current = lf;
        const m = lf.map(el.current, { scrollWheelZoom: false }).setView(NIGERIA, 5);
        lf.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 17, attribution: "© OpenStreetMap contributors" }).addTo(m);
        layer.current = lf.layerGroup().addTo(m);
        m.on("click", (e: Leaflet.LeafletMouseEvent) => onPickRef.current?.(Number(e.latlng.lat.toFixed(4)), Number(e.latlng.lng.toFixed(4))));
        map.current = m;
        setReady(true);
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  const style = () => ({ radius: 7, color: cssVar("--surface", "#fff"), weight: 2, fillColor: cssVar("--series", "#2a78d6"), fillOpacity: 0.9 });

  // Draw points whenever they change.
  useEffect(() => {
    const lf = L.current;
    if (!ready || !lf || !layer.current || !map.current) return;
    layer.current.clearLayers();
    for (const p of points) {
      const mk = lf.circleMarker([p.lat, p.lon], style()).addTo(layer.current);
      if (p.popupHtml) mk.bindPopup(p.popupHtml);
    }
    if (points.length) map.current.fitBounds(points.map((p) => [p.lat, p.lon] as [number, number]), { padding: [30, 30], maxZoom: 9 });
  }, [ready, points]);

  // Show the picked location.
  useEffect(() => {
    const lf = L.current;
    if (!ready || !lf || !map.current) return;
    if (!picked || Number.isNaN(picked.lat) || Number.isNaN(picked.lon)) return;
    if (pickMarker.current) pickMarker.current.setLatLng([picked.lat, picked.lon]);
    else pickMarker.current = lf.circleMarker([picked.lat, picked.lon], style()).addTo(map.current);
  }, [ready, picked]);

  if (failed) return <div className={`grid place-items-center rounded-lg border border-line bg-surface-2 p-4 text-center text-[13px] text-ink-3 ${className}`}>Map unavailable.</div>;
  return <div ref={el} className={`rounded-lg border border-line bg-surface-2 ${className}`} />;
}
