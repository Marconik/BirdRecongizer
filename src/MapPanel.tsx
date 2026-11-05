import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Crosshair, MapPin, X } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import type { Coordinates } from './types';

interface Props {
  location: string;
  coordinates: Coordinates | null;
  onLocationChange: (location: string) => void;
  onCoordinatesChange: (coordinates: Coordinates | null) => void;
}

export default function MapPanel({ location, coordinates, onLocationChange, onCoordinatesChange }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.CircleMarker | null>(null);
  const onSelect = useRef(onCoordinatesChange);
  onSelect.current = onCoordinatesChange;
  const [tileError, setTileError] = useState(false);
  const [editingCoordinates, setEditingCoordinates] = useState(false);
  const [coordinateError, setCoordinateError] = useState('');

  useEffect(() => {
    if (!host.current) return;
    const map = L.map(host.current, {
      zoomControl: false,
      scrollWheelZoom: false,
      worldCopyJump: true,
      minZoom: 1,
    }).setView([23, 15], 2);
    mapRef.current = map;
    L.control.zoom({ position: 'bottomright', zoomInTitle: '放大地图', zoomOutTitle: '缩小地图' }).addTo(map);
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
    }).addTo(map);
    tiles.on('tileerror', () => setTileError(true));
    tiles.on('load', () => {
      // Keep the message if the current viewport contains a failed tile.
      if (host.current?.querySelector('.leaflet-tile-loaded')) setTileError(false);
    });
    map.on('click', (event: L.LeafletMouseEvent) => {
      const point = event.latlng.wrap();
      onSelect.current({ lat: Number(point.lat.toFixed(5)), lng: Number(point.lng.toFixed(5)) });
    });
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(host.current);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!coordinates) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    const position = L.latLng(coordinates.lat, coordinates.lng);
    if (markerRef.current) markerRef.current.setLatLng(position);
    else markerRef.current = L.circleMarker(position, {
      radius: 8, color: '#fff', weight: 3, fillColor: '#315b48', fillOpacity: 1,
    }).addTo(map);
    if (!map.getBounds().contains(position)) map.panTo(position);
  }, [coordinates]);

  return (
    <section className="panel map-panel" aria-labelledby="location-heading">
      <div className="panel-heading">
        <div className="heading-title"><MapPin size={17} /><h2 id="location-heading">拍摄地点</h2></div>
        <span className="muted small">本批次通用</span>
      </div>
      <div className="location-input-wrap">
        <MapPin size={15} aria-hidden="true" />
        <input aria-label="拍摄地点" value={location} onChange={e => onLocationChange(e.target.value)} placeholder="填写地点，或在地图上选点" />
        <button className="text-button" onClick={() => { setEditingCoordinates(value => !value); setCoordinateError(''); }} aria-expanded={editingCoordinates}>坐标</button>
      </div>
      {editingCoordinates && (
        <form className="coordinate-form" onSubmit={event => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const lat = Number(data.get('lat'));
          const lng = Number(data.get('lng'));
          if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 85.0511 || Math.abs(lng) > 180) {
            setCoordinateError('请输入有效坐标：纬度 ±85.0511°，经度 ±180°。');
            return;
          }
          onCoordinatesChange({ lat, lng });
          setCoordinateError('');
          setEditingCoordinates(false);
        }}>
          <div className="coordinate-fields">
            <label>纬度<input name="lat" type="number" step="any" min="-85.0511" max="85.0511" required defaultValue={coordinates?.lat ?? ''} placeholder="如 40.7128" /></label>
            <label>经度<input name="lng" type="number" step="any" min="-180" max="180" required defaultValue={coordinates?.lng ?? ''} placeholder="如 -74.0060" /></label>
            <button className="small-button" type="submit">定位</button>
          </div>
          {coordinateError && <p className="field-error" role="alert">{coordinateError}</p>}
        </form>
      )}
      <div className="map-canvas-wrap">
        <div ref={host} className="map-canvas" role="region" aria-label="拍摄地点地图，点击选择位置，也可使用坐标输入" />
        <button className="map-center-button" title="将地图中心设为拍摄位置" aria-label="选择地图中心为拍摄位置" onClick={() => {
          const center = mapRef.current?.getCenter().wrap();
          if (center) onCoordinatesChange({ lat: Number(center.lat.toFixed(5)), lng: Number(center.lng.toFixed(5)) });
        }}><Crosshair size={16} /></button>
        {tileError && <div className="map-error" role="status">底图暂时无法加载，仍可填写地点或坐标。</div>}
      </div>
      <div className="map-footer">
        <span className={coordinates ? 'coordinate-value' : 'muted'}>{coordinates ? `${coordinates.lat.toFixed(5)}°, ${coordinates.lng.toFixed(5)}°` : '点选地图，记录大致拍摄位置'}</span>
        {coordinates && <button className="icon-button tiny" onClick={() => onCoordinatesChange(null)} aria-label="清除地图选点" title="清除地图选点"><X size={14} /></button>}
      </div>
    </section>
  );
}
