import { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Canvas, useLoader, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { OBJLoader } from 'three-stdlib';
import { api } from '../lib/api';
import type { Alert, Dataset, Health, Run, RunResult, Scenario, Station, WatchBox, WatchJob } from '../lib/api';

// ─── Types ───────────────────────────────────────────────────────────────────
interface WorldObject {
  id: string; asset: string;
  position: { x: number; y: number; z: number };
  rotation_y: number; scale: number; material_id: string;
}
interface WorldLayout { asset_library: Record<string, string>; terrain: any; objects: WorldObject[]; }
interface BinaryFloodData { totalFrames: number; particleCount: number; buffer: Float32Array; }

const MAT: Record<string, string> = {
  "1": "#2ea8d5", "3": "#5a5a5a", "4": "#c8c0b0", "5": "#8b5e3c", "6": "#2d6a1f",
};

const ASSET_PATHS: Record<string, string> = {
  hospital: '/assets/structures/hospital.obj', bridge_concrete: '/assets/structures/bridge_concrete.obj',
  house_small: '/assets/structures/house_small.obj', house_medium: '/assets/structures/house_medium.obj',
  shed_farm: '/assets/structures/shed_farm.obj', tree_pine: '/assets/vegetation/tree_pine.obj',
  road_segment: '/assets/infrastructure/road_segment.obj', dam_concrete: '/assets/structures/dam_concrete.obj',
  vehicle_truck: '/assets/vehicles/vehicle_truck.obj', cargo_container: '/assets/structures/cargo_container.obj',
  timber_logs: '/assets/vegetation/timber_logs.obj',
};

const TERMINAL_STATES = ['VALIDATED', 'PUBLISHED', 'FAILED', 'CANCELLED'];

const EXPORT_FORMATS = [
  { fmt: 'kml', label: '.KML', desc: 'Google Earth inundation boundary', icon: '📄', color: '#00ffcc' },
  { fmt: 'shp', label: '.SHP', desc: 'ArcGIS/QGIS shapefile', icon: '🗺️', color: '#3b82f6' },
  { fmt: 'geotiff', label: '.GeoTIFF', desc: 'Depth/velocity raster grid', icon: '🛰️', color: '#8b5cf6' },
  { fmt: 'geojson', label: '.GeoJSON', desc: 'Vector impact + extent', icon: '📊', color: '#f59e0b' },
  { fmt: 'csv', label: '.CSV', desc: 'Stations + village tables', icon: '📈', color: '#ec4899' },
  { fmt: 'report', label: '.REPORT', desc: 'HTML assessment report', icon: '📝', color: '#22c55e' },
];

function defaultScenarioSpec(caseId: string, name: string): Record<string, unknown> {
  return {
    case: caseId,
    name,
    aoi: { type: 'bbox', coords: [77.88, 21.88, 78.12, 22.12] },
    engine: 'fast',
    horizon: { duration_hr: 1.0, dt_s: 0 },
    stations_km: [0.0, 5.0, 10.0, 15.0],
    breach: { mode: 'overtopping', method: 'froehlich2008' },
    reservoir: { storage_mcm: 286.0, initial_level_m: 620.0, dam_height_m: 45.0, area_km2: 12.0 },
    dam_type: 'homogeneous',
    erodibility: 'medium',
  };
}

function pickRun(runs: Run[]): Run | null {
  return runs.find((r) => r.state === 'VALIDATED' || r.state === 'PUBLISHED')
    ?? runs.find((r) => r.state === 'RUNNING' || r.state === 'QUEUED' || r.state === 'POST_PROCESSING')
    ?? runs[0]
    ?? null;
}

// ─── 3D Components ───────────────────────────────────────────────────────────
function CameraFloorConstraint() {
  const { camera } = useThree();
  useFrame(() => { if (camera.position.y < 80) camera.position.y = 80; });
  return null;
}

function CameraRig({ cameraMode }: { cameraMode: 'director' | 'drone' | 'action' }) {
  const { camera } = useThree();
  useEffect(() => {
    if (cameraMode === 'director') camera.position.set(600, 900, -1200);
    else if (cameraMode === 'drone') camera.position.set(0, 1900, -50);
    else camera.position.set(380, 180, -320);
  }, [cameraMode, camera]);
  return null;
}

// ─── Geographic Coordinate System ─────────────────────────────────────────────
// Terrain maps to area around Uttrakhand, India (N28-N30, E078-E082)
const GEO_BOUNDS = { latMin: 28.0, latMax: 30.0, lngMin: 78.0, lngMax: 82.0 };
const TERRAIN_SIZE = 1000;
const TERRAIN_OFFSET = new THREE.Vector3(-500, 0, -1000);

function worldToGeo(x: number, y: number, z: number): { lat: number; lng: number; elev: number } {
  const nx = (x - TERRAIN_OFFSET.x) / TERRAIN_SIZE;
  const nz = (z - TERRAIN_OFFSET.z + 1000) / TERRAIN_SIZE;
  const lat = GEO_BOUNDS.latMax - nz * (GEO_BOUNDS.latMax - GEO_BOUNDS.latMin);
  const lng = GEO_BOUNDS.lngMin + nx * (GEO_BOUNDS.lngMax - GEO_BOUNDS.lngMin);
  return { lat: Math.max(GEO_BOUNDS.latMin, Math.min(GEO_BOUNDS.latMax, lat)), lng: Math.max(GEO_BOUNDS.lngMin, Math.min(GEO_BOUNDS.lngMax, lng)), elev: Math.max(0, y) };
}

function GeoCoordOverlay({ onHover }: { onHover: (coord: { lat: number; lng: number; elev: number } | null) => void }) {
  const { camera, raycaster, scene, pointer } = useThree();
  const terrainRef = useRef<THREE.Object3D | null>(null);

  useFrame(() => {
    if (!terrainRef.current) {
      terrainRef.current = scene.children.find(c => c.position.x === TERRAIN_OFFSET.x) || null;
    }
    if (!terrainRef.current) { onHover(null); return; }
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(terrainRef.current, true);
    if (hits.length > 0) {
      const p = hits[0].point;
      onHover(worldToGeo(p.x, p.y, p.z));
    } else {
      onHover(null);
    }
  });
  return null;
}

// ─── Real Map Tile Fetcher ────────────────────────────────────────────────────
function fetchOSMTile(z: number, x: number, y: number): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  });
}

function fetchEsriSatTile(z: number, x: number, y: number): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
  });
}

function latLngToTile(lat: number, lng: number, z: number): { x: number; y: number } {
  const n = Math.pow(2, z);
  const x = Math.floor(((lng + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
  return { x, y };
}

function useRealMapTexture(mode: 'satellite-real' | 'osm-real' | null, bounds = GEO_BOUNDS) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!mode) { setTexture(null); return; }
    let cancelled = false;
    const build = async () => {
      setLoading(true);
      const zoom = 11;
      const tl = latLngToTile(bounds.latMax, bounds.lngMin, zoom);
      const br = latLngToTile(bounds.latMin, bounds.lngMax, zoom);
      const cols = br.x - tl.x + 1;
      const rows = br.y - tl.y + 1;
      const tileSize = 256;
      const canvas = document.createElement('canvas');
      canvas.width = cols * tileSize;
      canvas.height = rows * tileSize;
      const ctx = canvas.getContext('2d')!;
      const fetcher = mode === 'satellite-real' ? fetchEsriSatTile : fetchOSMTile;
      const promises: Promise<void>[] = [];
      for (let dy = 0; dy < rows; dy++) {
        for (let dx = 0; dx < cols; dx++) {
          const tx = tl.x + dx;
          const ty = tl.y + dy;
          promises.push(
            fetcher(zoom, tx, ty).then(img => {
              if (!cancelled) ctx.drawImage(img, dx * tileSize, dy * tileSize, tileSize, tileSize);
            }).catch(() => {
              if (!cancelled) { ctx.fillStyle = '#222'; ctx.fillRect(dx * tileSize, dy * tileSize, tileSize, tileSize); }
            })
          );
        }
      }
      await Promise.all(promises);
      if (cancelled) return;
      const tex = new THREE.CanvasTexture(canvas);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(1, 1);
      tex.needsUpdate = true;
      setTexture(tex);
      setLoading(false);
    };
    build();
    return () => { cancelled = true; };
  }, [mode, bounds.latMin, bounds.latMax, bounds.lngMin, bounds.lngMax]);

  return { texture, loading };
}

// ─── Compute Pipeline State ───────────────────────────────────────────────────
interface ComputeJob {
  id: string; status: 'queued' | 'running' | 'done' | 'error';
  progress: number; finishedAt?: number; error?: string;
}

function TerrainBlock({ drapeMode, realTexture }: { drapeMode: 'satellite' | 'osm' | 'topo' | 'heatmap' | 'satellite-real' | 'osm-real'; realTexture?: THREE.Texture | null }) {
  const geo = useLoader(OBJLoader, '/assets/terrain/terrain_valley.obj');
  const satelliteTex = useLoader(THREE.TextureLoader, '/textures/terrain_satellite.jpg');
  const osmTex = useLoader(THREE.TextureLoader, '/textures/terrain_osm.jpg');
  const topoTex = useLoader(THREE.TextureLoader, '/textures/terrain_topo.jpg');
  useMemo(() => {
    [satelliteTex, osmTex, topoTex].forEach(tex => { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1, 1); });
  }, [satelliteTex, osmTex, topoTex]);
  const mesh = useMemo(() => {
    const g = geo.clone();
    g.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh;
        const pos = m.geometry.attributes.position;
        if (drapeMode === 'heatmap') {
          const cols = new Float32Array(pos.count * 3);
          const c = new THREE.Color();
          for (let i = 0; i < pos.count; i++) {
            const y = pos.getY(i);
            if (y < -50) c.set('#1a1a1a'); else if (y < 45) c.set('#ef4444');
            else if (y < 70) c.set('#f97316'); else if (y < 95) c.set('#eab308');
            else c.set('#1e3a1e');
            cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
          }
          m.geometry.setAttribute('color', new THREE.BufferAttribute(cols, 3));
          m.geometry.computeVertexNormals();
          m.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, side: THREE.DoubleSide });
        } else {
          const tex = (drapeMode === 'satellite-real' || drapeMode === 'osm-real') && realTexture
            ? realTexture
            : drapeMode === 'satellite' ? satelliteTex : drapeMode === 'osm' ? osmTex : topoTex;
          m.geometry.computeVertexNormals();
          m.material = new THREE.MeshStandardMaterial({ map: tex, roughness: drapeMode === 'satellite' || drapeMode === 'satellite-real' ? 0.85 : 0.7, metalness: 0.0, side: THREE.DoubleSide });
        }
        m.receiveShadow = true;
      }
    });
    return g;
  }, [geo, drapeMode, satelliteTex, osmTex, topoTex, realTexture]);
  return <primitive object={mesh} position={[-500, 0, -1000]} />;
}

function SceneObject({ obj, onSelect }: { obj: WorldObject; onSelect?: (o: any) => void }) {
  const path = ASSET_PATHS[obj.asset];
  const geo = useLoader(OBJLoader, path ?? ASSET_PATHS.house_small);
  const color = useMemo(() => new THREE.Color(MAT[obj.material_id] || '#888'), [obj.material_id]);
  const cloned = useMemo(() => {
    const g = geo.clone();
    g.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh;
        m.material = new THREE.MeshStandardMaterial({
          color: obj.asset === 'dam_concrete' ? new THREE.Color('#b0a898') : color,
          roughness: obj.asset === 'tree_pine' ? 0.95 : 0.65, metalness: 0.0,
        });
        m.castShadow = true; m.receiveShadow = true;
      }
    });
    return g;
  }, [geo, color, obj.asset]);
  if (!path) return null;
  return (
    <primitive object={cloned} position={[obj.position.x - 500, obj.position.y, obj.position.z - 1000]}
      rotation={[0, (obj.rotation_y * Math.PI) / 180, 0]} scale={obj.scale}
      onClick={(e: any) => { e.stopPropagation(); if (onSelect) onSelect(obj); }} />
  );
}

function SweptObjectItem({ item, onSelect }: { item: any; onSelect?: (o: any) => void }) {
  const path = ASSET_PATHS[item.asset];
  const geo = useLoader(OBJLoader, path ?? ASSET_PATHS.house_small);
  const color = useMemo(() => new THREE.Color(MAT[item.mat] || '#8b5e3c'), [item.mat]);
  const cloned = useMemo(() => {
    const g = geo.clone();
    g.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh;
        m.material = new THREE.MeshStandardMaterial({
          color, roughness: 0.7, metalness: item.asset === 'cargo_container' ? 0.4 : 0.0,
        });
        m.castShadow = true; m.receiveShadow = true;
      }
    });
    return g;
  }, [geo, color, item.asset]);
  if (!path) return null;
  return (
    <primitive object={cloned} position={[item.x - 500, item.y, item.z - 1000]}
      rotation={[0, (item.rot_y * Math.PI) / 180, 0]} scale={item.scale}
      onClick={(e: any) => { e.stopPropagation(); if (onSelect) onSelect(item); }} />
  );
}

function RainParticles() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const count = 1200;
  const positions = useMemo(() => {
    const p: [number, number, number][] = [];
    for (let i = 0; i < count; i++) p.push([(Math.random() - 0.5) * 1200, Math.random() * 600 + 50, (Math.random() - 0.5) * 2200]);
    return p;
  }, []);
  useFrame(() => {
    if (!meshRef.current) return;
    for (let i = 0; i < count; i++) {
      positions[i][1] -= 18.0;
      if (positions[i][1] < 10) positions[i][1] = 600;
      dummy.position.set(positions[i][0], positions[i][1], positions[i][2]);
      dummy.scale.set(0.2, 3.5, 0.2);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color="#aaccff" transparent opacity={0.65} />
    </instancedMesh>
  );
}

function WaterParticles({ positions, prevPositions }: { positions: [number, number, number][]; prevPositions?: [number, number, number][] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const foamColor = useMemo(() => new THREE.Color('#ffffff'), []);
  const deepColor = useMemo(() => new THREE.Color('#025a86'), []);
  const shallowColor = useMemo(() => new THREE.Color('#38bdf8'), []);
  const tempColor = useMemo(() => new THREE.Color(), []);
  useEffect(() => {
    if (!meshRef.current || !positions.length) return;
    for (let i = 0; i < positions.length; i++) {
      const [x, y, z] = positions[i];
      dummy.position.set(x - 500, y, z - 1000);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
      let speed = 0;
      if (prevPositions && prevPositions[i]) {
        const dx = x - prevPositions[i][0], dy = y - prevPositions[i][1], dz = z - prevPositions[i][2];
        speed = Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
      const isBreachSurge = z > 460 && z < 620 && Math.abs(x - 750) < 140;
      if (speed > 4.2 || (isBreachSurge && y > 46)) tempColor.copy(foamColor);
      else { const depthRatio = Math.min(1, Math.max(0, (y - 25.0) / 45.0)); tempColor.lerpColors(deepColor, shallowColor, depthRatio); }
      meshRef.current.setColorAt(i, tempColor);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  }, [positions, prevPositions, dummy, foamColor, deepColor, shallowColor, tempColor]);
  if (!positions.length) return null;
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, positions.length]} castShadow>
      <sphereGeometry args={[4.8, 6, 6]} />
      <meshStandardMaterial roughness={0.06} metalness={0.5} transparent opacity={0.92} />
    </instancedMesh>
  );
}

function SceneComposer({ layout, waterPositions, prevWaterPositions, sweptObjects, drapeMode, weatherMode, onSelectObject, realTexture, onGeoHover }: {
  layout: WorldLayout; waterPositions: [number, number, number][]; prevWaterPositions?: [number, number, number][]; sweptObjects?: any[];
  drapeMode?: 'satellite' | 'osm' | 'topo' | 'heatmap' | 'satellite-real' | 'osm-real'; weatherMode?: 'day' | 'storm' | 'night'; onSelectObject?: (o: any) => void;
  realTexture?: THREE.Texture | null; onGeoHover?: (c: { lat: number; lng: number; elev: number } | null) => void;
}) {
  const renderables = layout.objects.filter((o) => ASSET_PATHS[o.asset]);
  const swept = (sweptObjects ?? []).filter((s) => ASSET_PATHS[s.asset]);
  return (
    <group>
      <Suspense fallback={null}><TerrainBlock drapeMode={drapeMode || 'topo'} realTexture={realTexture} /></Suspense>
      {renderables.map((obj) => <Suspense key={obj.id} fallback={null}><SceneObject obj={obj} onSelect={onSelectObject} /></Suspense>)}
      {swept.map((item, i) => <Suspense key={item.id || i} fallback={null}><SweptObjectItem item={item} onSelect={onSelectObject} /></Suspense>)}
      {weatherMode === 'storm' && <RainParticles />}
      <WaterParticles positions={waterPositions} prevPositions={prevWaterPositions} />
      {onGeoHover && <GeoCoordOverlay onHover={onGeoHover} />}
    </group>
  );
}

// ─── Mini SVG Chart ──────────────────────────────────────────────────────────
function MiniChart({ data, dataKey, color, width, height }: { data: any[]; dataKey: string; color: string; width: number; height: number }) {
  if (!data || data.length < 2) {
    return (
      <div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: S.textDim, fontSize: 10, border: `1px dashed ${S.border}`, borderRadius: 6 }}>
        No completed run yet.
      </div>
    );
  }
  const maxVal = Math.max(...data.map(d => d[dataKey])) || 1;
  const points = data.map((d, i) => `${(i / (data.length - 1)) * width},${height - (d[dataKey] / maxVal) * height * 0.85}`).join(' ');
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={`g-${dataKey}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${points} ${width},${height}`} fill={`url(#g-${dataKey})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}

// ─── Style Helpers ───────────────────────────────────────────────────────────
const S = {
  bg: '#0a0a0f', card: '#12141a', border: '#1e2230', accent: '#00ffcc', text: '#e0e0e0',
  textDim: '#6b7280', danger: '#ff3b3b', warn: '#f59e0b', success: '#22c55e',
};
const panelTab = (active: boolean): React.CSSProperties => ({
  background: active ? `${S.accent}15` : 'transparent', border: 'none',
  borderBottom: active ? `2px solid ${S.accent}` : '2px solid transparent',
  color: active ? S.accent : S.textDim, cursor: 'pointer', padding: '6px 10px',
  fontSize: 10, fontWeight: 700, fontFamily: 'Inter, sans-serif', transition: 'all 0.15s', textAlign: 'center' as const, borderRadius: 0,
});
const pill = (active: boolean, color?: string): React.CSSProperties => ({
  background: active ? (color || S.accent) : 'transparent',
  color: active ? '#000' : S.textDim, border: `1px solid ${active ? (color || S.accent) : S.border}`,
  borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontSize: 9, fontWeight: 700, fontFamily: 'Inter, sans-serif',
});
const dimText: React.CSSProperties = { fontSize: 10, color: S.textDim };

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────
export default function ProjectDashboard() {
  const { missionId, projectId } = useParams<{ missionId: string; projectId: string }>();
  const navigate = useNavigate();

  // Panel visibility
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [leftTab, setLeftTab] = useState<'overview' | 'data' | 'sim' | 'dam' | 'scenario' | 'gee' | 'compute'>('overview');
  const [rightTab, setRightTab] = useState<'kpi' | 'assets' | 'charts' | 'heatmap' | 'export' | 'alerts'>('kpi');

  // Catalog state (backend)
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [scenarioRuns, setScenarioRuns] = useState<Run[]>([]);
  const [activeRun, setActiveRun] = useState<Run | null>(null);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [hydro, setHydro] = useState<Record<string, { time_hr?: number[]; q_cms?: number[] }> | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [watchBoxes, setWatchBoxes] = useState<WatchBox[]>([]);
  const [watchJobs, setWatchJobs] = useState<WatchJob[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [geeState, setGeeState] = useState<Health['gee'] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [computeJob, setComputeJob] = useState<ComputeJob | null>(null);
  const [engine, setEngine] = useState<'fast' | 'sph' | 'delft3d'>('fast');
  const [exportState, setExportState] = useState<Record<string, string>>({});
  const [geeFetching, setGeeFetching] = useState(false);
  const [geeNote, setGeeNote] = useState<string | null>(null);

  // 3D state
  const [layout, setLayout] = useState<WorldLayout | null>(null);
  const [floodData, setFloodData] = useState<BinaryFloodData | null>(null);
  const [sweptData, setSweptData] = useState<any>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [cameraMode, setCameraMode] = useState<'director' | 'drone' | 'action'>('director');
  const [drapeMode, setDrapeMode] = useState<'satellite' | 'osm' | 'topo' | 'heatmap' | 'satellite-real' | 'osm-real'>('topo');
  const [weatherMode, setWeatherMode] = useState<'day' | 'storm' | 'night'>('day');
  const [crisisMode, setCrisisMode] = useState(false);
  const [selectedObj, setSelectedObj] = useState<any | null>(null);
  const [downloadPct, setDownloadPct] = useState(0);
  const [isDownloading, setIsDownloading] = useState(true);
  const [geoCoord, setGeoCoord] = useState<{ lat: number; lng: number; elev: number } | null>(null);
  const animRef = useRef<number | null>(null);
  const lastTime = useRef(0);
  const FPS = 18;

  // Sim config state (values hydrated from the loaded scenario spec)
  const [simParams, setSimParams] = useState({
    particleCount: 18000, smoothingRadius: 2.5, gravity: -9.81, viscosity: 0.01,
    taitGamma: 7.0, density: 1000, gridX: 100, gridY: 200, manningN: 0.040,
    timeStep: 0.1, duration: 6, boundary: 'Free',
    crestLevel: 480, breachWidth: 0, breachTime: 0,
    inflowRate: 0, waterLevel: 620,
  });
  const updateSim = (key: string, val: any) => setSimParams(p => ({ ...p, [key]: val }));
  const [breachMode, setBreachMode] = useState('overtopping');
  const [damType, setDamType] = useState('homogeneous');

  // Data ingestion selection (dataset ids)
  const [selectedTiles, setSelectedTiles] = useState<Set<string>>(new Set());

  const pollRef = useRef<number | null>(null);
  const scenarioIdRef = useRef<string | null>(null);
  useEffect(() => { scenarioIdRef.current = scenario?.id ?? null; }, [scenario]);

  const refreshAlerts = useCallback(() => {
    void api.alerts().then(setAlerts).catch(() => {});
  }, []);

  const loadResult = useCallback(async (runId: string) => {
    try {
      const res = await api.runResult(runId);
      setRunResult(res);
    } catch {
      setRunResult(null);
    }
    try {
      setStations(await api.runStations(runId));
    } catch {
      setStations([]);
    }
    try {
      const hg = await api.runHydrograph(runId);
      setHydro(hg.series ?? null);
    } catch {
      setHydro(null);
    }
  }, []);

  const pollRun = useCallback((runId: string) => {
    if (pollRef.current !== null) return;
    pollRef.current = -1;
    const tick = async () => {
      try {
        const detail = await api.run(runId);
        const run = detail.run;
        const terminal = TERMINAL_STATES.includes(run.state);
        const validated = run.state === 'VALIDATED' || run.state === 'PUBLISHED';
        setActiveRun(run);
        setScenarioRuns(rs => [run, ...rs.filter(r => r.id !== run.id)]);
        setComputeJob({
          id: run.id,
          status: terminal ? (validated ? 'done' : 'error') : (run.state === 'DRAFT' ? 'queued' : 'running'),
          progress: run.progress ?? 0,
          finishedAt: terminal ? Date.now() : undefined,
          error: run.error ?? undefined,
        });
        if (terminal) {
          pollRef.current = null;
          if (validated) {
            void loadResult(run.id);
            refreshAlerts();
          }
          return;
        }
      } catch {
        // transient poll failure — keep trying
      }
      pollRef.current = window.setTimeout(tick, 1000);
    };
    void tick();
  }, [loadResult, refreshAlerts]);

  // Load scenario + catalog for this project
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    const caseId = (missionId ?? '1').replace(/^0+/, '') || '1';
    const cached = window.sessionStorage.getItem(`niyanta:project:${projectId}`);
    const load = async () => {
      if (cached) {
        try {
          const detail = await api.scenario(cached);
          if (!alive) return;
          setScenario(detail.scenario);
          setScenarioRuns(detail.runs);
          setActiveRun(pickRun(detail.runs));
          setLoadError(null);
          return;
        } catch {
          window.sessionStorage.removeItem(`niyanta:project:${projectId}`);
        }
      }
      try {
        const detail = await api.scenario(projectId);
        if (!alive) return;
        setScenario(detail.scenario);
        setScenarioRuns(detail.runs);
        setActiveRun(pickRun(detail.runs));
        setLoadError(null);
      } catch {
        try {
          const created = await api.createScenario(defaultScenarioSpec(caseId, `Project ${projectId}`));
          if (!alive) return;
          window.sessionStorage.setItem(`niyanta:project:${projectId}`, created.id);
          setScenario(created);
          setScenarioRuns([]);
          setActiveRun(null);
          setLoadError(null);
        } catch (e) {
          if (alive) setLoadError((e as Error).message);
        }
      }
    };
    void load();
    void api.alerts().then(a => { if (alive) setAlerts(a); }).catch(() => {});
    void api.watchBoxes().then(b => { if (alive) setWatchBoxes(b); }).catch(() => {});
    void api.watchJobs().then(j => { if (alive) setWatchJobs(j); }).catch(() => {});
    void api.datasets().then(d => { if (alive) setDatasets(d); }).catch(() => {});
    void api.health().then(h => { if (alive) setGeeState(h.gee ?? null); }).catch(() => {});
    return () => { alive = false; };
  }, [projectId, missionId]);

  // Hydrate config sliders from the scenario spec
  useEffect(() => {
    if (!scenario) return;
    const spec = (scenario.spec ?? {}) as Record<string, any>;
    const r = spec.reservoir ?? {};
    const b = spec.breach ?? {};
    setSimParams(p => ({
      ...p,
      duration: Number(spec.horizon?.duration_hr ?? p.duration),
      waterLevel: Number(r.initial_level_m ?? p.waterLevel),
      crestLevel: Number(r.crest_level_m ?? r.initial_level_m ?? p.crestLevel),
      inflowRate: Number(r.inflow_cms ?? 0),
      breachWidth: Number(b.width_m ?? 0),
      breachTime: Number(b.formation_time_hr ?? 0),
    }));
    setBreachMode(String(b.mode ?? 'overtopping'));
    setDamType(String(spec.dam_type ?? 'homogeneous'));
  }, [scenario]);

  // Track the active run (resume polling, or load its result)
  useEffect(() => {
    if (!activeRun) return;
    const st = activeRun.state;
    if (st === 'VALIDATED' || st === 'PUBLISHED') {
      void loadResult(activeRun.id);
      return;
    }
    if (!TERMINAL_STATES.includes(st)) pollRun(activeRun.id);
  }, [activeRun, loadResult, pollRun]);

  // Start a real compute: new scenario revision (sliders → spec) → run → poll
  const startCompute = useCallback(async () => {
    if (!scenario) return;
    const base = (scenario.spec ?? {}) as Record<string, any>;
    const spec: Record<string, any> = {
      ...base,
      scenario_id: undefined,
      case: base.case ?? '1',
      name: `${scenario.name ?? `Project ${projectId}`} · ${engine} · ${new Date().toLocaleTimeString()}`,
      engine,
      horizon: { ...(base.horizon ?? {}), duration_hr: simParams.duration },
      breach: {
        ...(base.breach ?? {}),
        mode: breachMode,
        width_m: simParams.breachWidth,
        formation_time_hr: simParams.breachTime,
      },
      reservoir: {
        ...(base.reservoir ?? {}),
        initial_level_m: simParams.waterLevel,
        inflow_cms: simParams.inflowRate,
        ...(base.reservoir?.crest_level_m != null ? { crest_level_m: simParams.crestLevel } : {}),
      },
      dam_type: damType,
    };
    setLoadError(null);
    setRunResult(null);
    setStations([]);
    setHydro(null);
    try {
      const created = await api.createScenario(spec);
      scenarioIdRef.current = created.id;
      setScenario(created);
      setScenarioRuns([]);
      const run = await api.createRun(created.id, engine);
      setActiveRun(run);
      setComputeJob({ id: run.id, status: 'queued', progress: 0 });
      await api.executeRun(run.id);
      pollRun(run.id);
    } catch (e) {
      const msg = (e as Error).message;
      setLoadError(msg);
      setComputeJob({ id: 'local-error', status: 'error', progress: 0, error: msg });
    }
  }, [scenario, engine, simParams, breachMode, damType, projectId, pollRun]);

  const fetchGee = useCallback(async () => {
    setGeeFetching(true);
    try {
      const r = await api.watchRun();
      setGeeNote(`queued job ${r.job_id} · mode ${r.mode}`);
      window.setTimeout(() => { void api.watchJobs().then(setWatchJobs).catch(() => {}); }, 3000);
    } catch (e) {
      setGeeNote((e as Error).message);
    } finally {
      setGeeFetching(false);
    }
  }, []);

  const doExport = useCallback(async (fmt: string) => {
    if (!runResult || !activeRun) {
      setExportState(e => ({ ...e, [fmt]: 'no-run' }));
      return;
    }
    setExportState(e => ({ ...e, [fmt]: 'busy' }));
    try {
      const job = await api.exports(activeRun.id, [fmt]);
      for (let i = 0; i < 60; i++) {
        await new Promise(r => window.setTimeout(r, 1000));
        const row = await api.getExport(job.id);
        if (row.status === 'done') {
          setExportState(e => ({ ...e, [fmt]: row.download_url ?? `/api/exports/${job.id}/download` }));
          return;
        }
        if (row.status === 'failed') {
          setExportState(e => ({ ...e, [fmt]: `error: ${row.error ?? 'export failed'}` }));
          return;
        }
      }
      setExportState(e => ({ ...e, [fmt]: 'error: timed out' }));
    } catch (e) {
      setExportState(e2 => ({ ...e2, [fmt]: `error: ${(e as Error).message}` }));
    }
  }, [runResult, activeRun]);

  // Load viz assets (static scene content)
  useEffect(() => {
    fetch('/world_layout.json').then(r => r.json()).then(setLayout).catch(() => setLayout({ asset_library: {}, terrain: null, objects: [] }));
    fetch('/swept_objects.json').then(r => r.json()).then(setSweptData).catch(() => setSweptData(null));
  }, []);

  useEffect(() => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', '/flood_frames.bin', true);
    xhr.responseType = 'arraybuffer';
    xhr.onprogress = (e) => { if (e.lengthComputable) setDownloadPct(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      if (xhr.status === 200 && xhr.response) {
        const buf = xhr.response as ArrayBuffer;
        const u32 = new Uint32Array(buf, 0, 2);
        setFloodData({ totalFrames: u32[0] - 1, particleCount: u32[1], buffer: new Float32Array(buf, 8) });
        setIsDownloading(false); setDownloadPct(100);
      }
    };
    xhr.onerror = () => { setIsDownloading(false); };
    xhr.send();
  }, []);

  // Animation loop
  useEffect(() => {
    if (!playing || !floodData) return;
    const step = (ts: number) => {
      if (ts - lastTime.current > 1000 / (FPS * speed)) {
        lastTime.current = ts;
        setFrame(f => { if (f >= floodData.totalFrames) { setPlaying(false); return f; } return f + 1; });
      }
      animRef.current = requestAnimationFrame(step);
    };
    animRef.current = requestAnimationFrame(step);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [playing, floodData, speed]);

  // Real map tile texture
  const isRealMode = drapeMode === 'satellite-real' || drapeMode === 'osm-real';
  const { texture: realMapTex, loading: realMapLoading } = useRealMapTexture(
    isRealMode ? drapeMode as 'satellite-real' | 'osm-real' : null
  );

  // Water positions
  const waterPositions: [number, number, number][] = useMemo(() => {
    if (!floodData) return [];
    if (frame > floodData.totalFrames) return [];
    const offset = frame * floodData.particleCount * 3;
    const r: [number, number, number][] = new Array(floodData.particleCount);
    for (let i = 0; i < floodData.particleCount; i++) {
      const idx = offset + i * 3;
      r[i] = [floodData.buffer[idx], floodData.buffer[idx + 1], floodData.buffer[idx + 2]];
    }
    return r;
  }, [floodData, frame]);

  const prevWaterPositions: [number, number, number][] = useMemo(() => {
    if (!floodData || frame === 0) return [];
    const offset = (frame - 1) * floodData.particleCount * 3;
    const r: [number, number, number][] = new Array(floodData.particleCount);
    for (let i = 0; i < floodData.particleCount; i++) {
      const idx = offset + i * 3;
      r[i] = [floodData.buffer[idx], floodData.buffer[idx + 1], floodData.buffer[idx + 2]];
    }
    return r;
  }, [floodData, frame]);

  const sweptFrameObjects = useMemo(() => {
    if (!sweptData?.objects_per_frame) return [];
    return sweptData.objects_per_frame[Math.min(frame, sweptData.objects_per_frame.length - 1)] || [];
  }, [sweptData, frame]);

  // Derived run metrics (real backend result)
  const metrics = runResult?.metrics;
  const maxDepth = metrics?.max_depth_m ?? null;
  const maxVelocity = null as number | null; // backend does not publish a scalar max velocity
  const floodedArea = metrics?.inundation_km2 ?? null;
  const affectedPop = runResult?.impact?.population_exposed ?? null;
  const peakCms = metrics?.peak_discharge_cms ?? null;
  const grade = runResult?.validation?.grade ?? null;
  const infra = runResult?.impact?.infra;
  const villages = runResult?.impact?.by_village ?? [];
  const hospitalHit = (infra?.hospitals ?? 0) > 0;
  const bridgeHit = (infra?.bridges ?? 0) > 0;

  const fmt = (v: number | null | undefined, digits = 1, unit = '') =>
    v != null && Number.isFinite(v) ? `${v.toFixed(digits)}${unit}` : '—';

  const job: ComputeJob | null = computeJob ?? (activeRun ? {
    id: activeRun.id,
    status: TERMINAL_STATES.includes(activeRun.state)
      ? (activeRun.state === 'VALIDATED' || activeRun.state === 'PUBLISHED' ? 'done' : 'error')
      : activeRun.state === 'DRAFT' ? 'queued' : 'running',
    progress: activeRun.progress ?? 0,
    error: activeRun.error ?? undefined,
  } : null);
  const jobRunning = job?.status === 'queued' || job?.status === 'running';

  const pct = floodData ? (frame / floodData.totalFrames) * 100 : 0;
  const phase = frame === 0 ? 'DAM INTACT' : frame < 20 ? 'BREACH FAILURE' : frame < 70 ? 'HIGH-VELOCITY SURGE' : 'VALLEY INUNDATION';

  const tickerText = jobRunning
    ? `Run ${job?.id.slice(0, 8)} ${job?.status} · stage ${activeRun?.stage ?? '…'} ${activeRun?.stage_status ?? ''} · ${job?.progress}%`
    : runResult
      ? `Validated run · peak ${fmt(peakCms, 0, ' m³/s')} at T+${fmt(metrics?.peak_at_hr, 1, 'h')} · max depth ${fmt(maxDepth, 1, 'm')} · ${fmt(floodedArea, 1, 'km²')} · grade ${grade ?? '—'}`
      : job?.status === 'error'
        ? `Run failed: ${job.error ?? loadError ?? 'unknown error'}`
        : 'No completed run yet — configure the pipeline and press RUN COMPUTE.';

  const flowSeries = useMemo(() => {
    if (!hydro) return [];
    const first = Object.values(hydro)[0];
    if (!first?.time_hr?.length) return [];
    return first.time_hr.map((t, i) => ({ t, q: first.q_cms?.[i] ?? 0 }));
  }, [hydro]);
  const stationPeak = stations.filter(s => (s.peak_cms ?? 0) > 0).map(s => ({ label: s.name || `${s.km} km`, peak: s.peak_cms }));
  const stationArrival = stations.filter(s => s.arrival_hr != null).map(s => ({ label: s.name || `${s.km} km`, arrival: s.arrival_hr as number }));

  if (!layout) {
    return (
      <div style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0f', color: S.accent, fontFamily: 'Inter, sans-serif', fontSize: 18, letterSpacing: 2 }}>
        Loading Copernicus 3D Digital Twin...
      </div>
    );
  }

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', background: S.bg, fontFamily: 'Inter, sans-serif', overflow: 'hidden' }}>

      {/* ═══════════ HEADER BAR ═══════════ */}
      <div style={{ height: 48, background: '#0d0d12', borderBottom: `1px solid ${S.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', flexShrink: 0, zIndex: 30 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => navigate(`/mission/${missionId}`)} style={{ background: 'none', border: `1px solid ${S.border}`, color: S.textDim, padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 10 }}>← BACK</button>
          <span style={{ fontSize: 14, fontWeight: 800, color: S.accent, letterSpacing: 2 }}>🏔️ NIYANTA</span>
          <span style={{ fontSize: 10, color: S.textDim }}>|</span>
          <span style={{ fontSize: 10, color: S.textDim }}>Mission {missionId} · Project {projectId}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 9, fontWeight: 800, padding: '3px 8px', borderRadius: 4, letterSpacing: 1,
            background: phase === 'DAM INTACT' ? `${S.success}20` : `${S.danger}20`,
            color: phase === 'DAM INTACT' ? S.success : S.danger,
          }}>{phase}</span>
          {activeRun && (
            <span style={{ fontSize: 9, fontWeight: 800, padding: '3px 8px', borderRadius: 4, letterSpacing: 1, background: `${S.accent}20`, color: S.accent }}>
              {activeRun.state}
            </span>
          )}
          {isDownloading ? (
            <span style={{ fontSize: 10, color: S.accent }}>Loading {downloadPct}%...</span>
          ) : (
            <span style={{ fontSize: 10, color: S.success }}>✓ {floodData?.particleCount.toLocaleString()} particles</span>
          )}
          <button onClick={() => setLeftOpen(!leftOpen)} style={{ background: leftOpen ? `${S.accent}20` : 'none', border: `1px solid ${S.border}`, color: S.textDim, padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 10 }}>◀ Data</button>
          <button onClick={() => setRightOpen(!rightOpen)} style={{ background: rightOpen ? `${S.accent}20` : 'none', border: `1px solid ${S.border}`, color: S.textDim, padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 10 }}>Results ▶</button>
        </div>
      </div>

      {/* ═══════════ MAIN BODY ═══════════ */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>

        {/* ─── LEFT PANEL ────────────────────────────── */}
        {leftOpen && (
          <div style={{ width: 320, borderRight: `1px solid ${S.border}`, display: 'flex', flexDirection: 'column', background: '#0d0d12', flexShrink: 0 }}>
            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: `1px solid ${S.border}`, overflow: 'auto' }}>
              {([
                { id: 'overview' as const, label: '📊' }, { id: 'data' as const, label: '🗂️' },
                { id: 'sim' as const, label: '⚙️' }, { id: 'dam' as const, label: '🏗️' },
                { id: 'scenario' as const, label: '⛅' }, { id: 'gee' as const, label: '🌐' },
                { id: 'compute' as const, label: '▶️' },
              ]).map(t => <button key={t.id} onClick={() => setLeftTab(t.id)} style={panelTab(leftTab === t.id)}>{t.label}</button>)}
            </div>

            {/* Tab Content */}
            <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
              {loadError && (
                <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 4, padding: 8, marginBottom: 8, fontSize: 9, color: S.danger }}>
                  catalog error: {loadError}
                </div>
              )}

              {/* OVERVIEW */}
              {leftTab === 'overview' && (
                <div>
                  <SectionTitle>MISSION OVERVIEW</SectionTitle>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
                    <KpiMini label="Depth" value={fmt(maxDepth, 1, 'm')} color={maxDepth != null && maxDepth > 10 ? S.danger : S.accent} />
                    <KpiMini label="Velocity" value={maxVelocity != null ? `${maxVelocity.toFixed(1)}m/s` : '—'} color={S.warn} />
                    <KpiMini label="Area" value={fmt(floodedArea, 1, 'km²')} color={S.accent} />
                    <KpiMini label="Pop." value={affectedPop != null ? affectedPop.toLocaleString() : '—'} color={affectedPop != null && affectedPop > 10000 ? S.danger : S.accent} />
                  </div>
                  <SectionTitle>MAP DRAPING</SectionTitle>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
                    {(['satellite', 'osm', 'topo', 'heatmap'] as const).map(mode => (
                      <button key={mode} onClick={() => setDrapeMode(mode)} style={pill(drapeMode === mode)}>
                        {mode === 'satellite' ? '🛰️' : mode === 'osm' ? '🛣️' : mode === 'topo' ? '📐' : '🔥'} {mode}
                      </button>
                    ))}
                  </div>
                  <div style={{ fontSize: 9, color: S.textDim, marginBottom: 8 }}>Offline textures</div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
                    {(['satellite-real', 'osm-real'] as const).map(mode => (
                      <button key={mode} onClick={() => setDrapeMode(mode)} style={pill(drapeMode === mode, '#3b82f6')}>
                        {mode === 'satellite-real' ? '🛰️' : '🛣️'} {mode === 'satellite-real' ? 'Real Satellite' : 'Real OSM'}
                      </button>
                    ))}
                  </div>
                  <SectionTitle>WEATHER</SectionTitle>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {(['day', 'storm', 'night'] as const).map(w => (
                      <button key={w} onClick={() => setWeatherMode(w)} style={pill(weatherMode === w)}>
                        {w === 'day' ? '☀️' : w === 'storm' ? '⛈️' : '🌙'} {w}
                      </button>
                    ))}
                  </div>
                  <SectionTitle>CRISIS PROTOCOL</SectionTitle>
                  <button onClick={() => {
                    if (!crisisMode) { setCrisisMode(true); setWeatherMode('night'); if (floodData) { setFrame(0); setPlaying(true); } }
                    else { setCrisisMode(false); setWeatherMode('day'); }
                  }} style={{ width: '100%', background: crisisMode ? '#ff2222' : 'linear-gradient(135deg, #ff3333, #cc0000)', color: 'white', border: 'none', borderRadius: 6, padding: '10px', cursor: 'pointer', fontWeight: 900, fontSize: 12, letterSpacing: 1 }}>
                    {crisisMode ? '🔴 CRISIS ACTIVE' : '💥 TRIGGER CRISIS SABOTAGE'}
                  </button>
                </div>
              )}

              {/* DATA INGESTION */}
              {leftTab === 'data' && (
                <div>
                  <SectionTitle>DATA SOURCE</SectionTitle>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
                    <MiniCard icon="🌐" label="GEE" desc={geeState ? `${geeState.mode}${geeState.ready ? ' · ready' : ''}` : 'online API'} active={!!geeState?.ready} />
                    <MiniCard icon="📁" label="Upload" desc="Drag & drop" />
                    <MiniCard icon="🗄️" label="Library" desc={`${datasets.length} tiles`} active />
                    <MiniCard icon="🗺️" label="OSM" desc="Overpass API" />
                  </div>
                  <SectionTitle>LOCAL DEM LIBRARY</SectionTitle>
                  {datasets.length === 0 ? (
                    <div style={dimText}>No datasets registered yet — upload or fetch from GEE.</div>
                  ) : datasets.map(d => (
                    <button key={d.id} onClick={() => {
                      const next = new Set(selectedTiles);
                      if (next.has(d.id)) next.delete(d.id); else next.add(d.id);
                      setSelectedTiles(next);
                    }} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '6px 8px', marginBottom: 4, background: selectedTiles.has(d.id) ? `${S.accent}12` : S.card, border: `1px solid ${selectedTiles.has(d.id) ? S.accent : S.border}`, borderRadius: 4, cursor: 'pointer', color: S.text, fontSize: 10 }}>
                      <span>{d.name} · <span style={{ color: S.textDim }}>{d.kind}</span></span>
                      {selectedTiles.has(d.id) && <span style={{ color: S.accent }}>✓</span>}
                    </button>
                  ))}
                  <SectionTitle>GEE WATCH BOXES</SectionTitle>
                  {watchBoxes.length === 0 ? (
                    <div style={dimText}>No watch boxes yet.</div>
                  ) : watchBoxes.map(b => (
                    <div key={b.id} style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 4, padding: '6px 8px', marginBottom: 4, fontSize: 10 }}>
                      <div style={{ fontWeight: 700 }}>{b.name ?? b.id}</div>
                      <div style={{ color: S.textDim, fontSize: 9 }}>{b.state ?? 'idle'}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* SIM CONFIG */}
              {leftTab === 'sim' && (
                <div>
                  <SectionTitle>SPH ENGINE</SectionTitle>
                  <SliderParam label="Particles" value={simParams.particleCount} min={1000} max={50000} step={1000} unit="" k="particleCount" onChange={updateSim} />
                  <SliderParam label="Smoothing h" value={simParams.smoothingRadius} min={0.5} max={10} step={0.1} unit="m" k="smoothingRadius" onChange={updateSim} />
                  <SliderParam label="Viscosity" value={simParams.viscosity} min={0.001} max={0.1} step={0.001} unit="Pa·s" k="viscosity" onChange={updateSim} />
                  <SliderParam label="Density" value={simParams.density} min={800} max={1200} step={10} unit="kg/m³" k="density" onChange={updateSim} />
                  <SectionTitle>DELFT3D</SectionTitle>
                  <SliderParam label="Grid X" value={simParams.gridX} min={20} max={500} step={10} unit="" k="gridX" onChange={updateSim} />
                  <SliderParam label="Grid Y" value={simParams.gridY} min={20} max={500} step={10} unit="" k="gridY" onChange={updateSim} />
                  <SliderParam label="Manning n" value={simParams.manningN} min={0.01} max={0.1} step={0.005} unit="" k="manningN" onChange={updateSim} />
                  <SliderParam label="Duration" value={simParams.duration} min={1} max={72} step={1} unit="hrs" k="duration" onChange={updateSim} />
                </div>
              )}

              {/* DAM CONFIG */}
              {leftTab === 'dam' && (
                <div>
                  <SectionTitle>DAM PARAMETERS</SectionTitle>
                  <div style={{ fontSize: 10, color: S.textDim, marginBottom: 8 }}>Breach configuration for simulation</div>
                  <SliderParam label="Crest Level" value={simParams.crestLevel} min={100} max={700} step={5} unit="m" k="crestLevel" onChange={updateSim} />
                  <SliderParam label="Breach Width" value={simParams.breachWidth} min={0} max={500} step={10} unit={simParams.breachWidth === 0 ? 'm auto' : 'm'} k="breachWidth" onChange={updateSim} />
                  <SliderParam label="Breach Time" value={simParams.breachTime} min={0} max={24} step={0.1} unit="hrs" k="breachTime" onChange={updateSim} />
                  <SectionTitle>FAILURE MODE</SectionTitle>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {([
                      ['overtopping', 'Overtopping'], ['piping', 'Piping'],
                      ['blockage_breach', 'Blockage'], ['attack', 'Attack'],
                    ] as const).map(([m, label]) => (
                      <button key={m} onClick={() => setBreachMode(m)} style={pill(breachMode === m)}>{label}</button>
                    ))}
                  </div>
                  <SectionTitle>DAM TYPE</SectionTitle>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {([
                      ['homogeneous', 'Homogeneous Earth'], ['corewall', 'Core Wall'], ['concrete_faced', 'Concrete Faced'],
                    ] as const).map(([t, label]) => (
                      <button key={t} onClick={() => setDamType(t)} style={pill(damType === t)}>{label}</button>
                    ))}
                  </div>
                </div>
              )}

              {/* SCENARIO */}
              {leftTab === 'scenario' && (
                <div>
                  <SectionTitle>INFLOW SCENARIO</SectionTitle>
                  <SliderParam label="Inflow Rate" value={simParams.inflowRate} min={0} max={10000} step={100} unit="m³/s" k="inflowRate" onChange={updateSim} />
                  <SliderParam label="Water Level" value={simParams.waterLevel} min={50} max={700} step={5} unit="m" k="waterLevel" onChange={updateSim} />
                  <SectionTitle>WEATHER</SectionTitle>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    {([
                      { id: 'day' as const, icon: '☀️', label: 'Clear' }, { id: 'storm' as const, icon: '⛈️', label: 'Storm' },
                      { id: 'night' as const, icon: '🌙', label: 'Night' },
                    ]).map(w => (
                      <button key={w.id} onClick={() => setWeatherMode(w.id)} style={{
                        ...pill(weatherMode === w.id), width: '100%', textAlign: 'center', padding: '8px',
                      }}>{w.icon} {w.label}</button>
                    ))}
                  </div>
                </div>
              )}

              {/* GEE */}
              {leftTab === 'gee' && (
                <div>
                  <SectionTitle>GOOGLE EARTH ENGINE</SectionTitle>
                  <div style={{ fontSize: 10, color: S.textDim, marginBottom: 8 }}>
                    {geeState
                      ? `mode ${geeState.mode} · ${geeState.ready ? '● Ready' : '● Not ready'}${geeState.error ? ` · ${geeState.error}` : ''}`
                      : 'status unavailable — backend offline?'}
                  </div>
                  <SectionTitle>WATCH BOXES ({watchBoxes.length})</SectionTitle>
                  {watchBoxes.length === 0 ? (
                    <div style={dimText}>No watch boxes registered.</div>
                  ) : watchBoxes.map(b => (
                    <div key={b.id} style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 4, padding: '6px 8px', marginBottom: 4, fontSize: 10 }}>
                      <div style={{ fontWeight: 700 }}>{b.name ?? b.id}</div>
                      <div style={{ color: S.textDim, fontSize: 9 }}>{b.state ?? 'idle'}{b.created ? ` · since ${new Date(b.created).toLocaleDateString()}` : ''}</div>
                    </div>
                  ))}
                  <SectionTitle>RECENT GEE JOBS</SectionTitle>
                  {watchJobs.length === 0 ? (
                    <div style={dimText}>No GEE jobs yet.</div>
                  ) : watchJobs.slice(0, 8).map((j, i) => (
                    <div key={j.id ?? i} style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 4, padding: '6px 8px', marginBottom: 4, fontSize: 9, display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                      <span style={{ color: S.text }}>{j.kind}</span>
                      <span style={{ color: j.status === 'done' ? S.success : j.status === 'failed' ? S.danger : S.accent, fontWeight: 700 }}>{j.status}{j.day ? ` · ${j.day}` : ''}</span>
                    </div>
                  ))}
                  <button onClick={() => void fetchGee()} disabled={geeFetching} style={{ width: '100%', background: S.accent, color: '#000', border: 'none', borderRadius: 4, padding: '8px', cursor: geeFetching ? 'wait' : 'pointer', fontWeight: 700, fontSize: 11, marginTop: 8, opacity: geeFetching ? 0.6 : 1 }}>
                    {geeFetching ? '⏳ Queuing…' : '🌐 Fetch from GEE'}
                  </button>
                  {geeNote && <div style={{ fontSize: 9, color: S.textDim, marginTop: 6 }}>{geeNote}</div>}
                </div>
              )}

              {/* COMPUTE PIPELINE */}
              {leftTab === 'compute' && (
                <div>
                  <SectionTitle>COMPUTE PIPELINE</SectionTitle>
                  <div style={{ fontSize: 10, color: S.textDim, marginBottom: 8 }}>Configure → Ingest → Compute → Results</div>

                  {/* Pipeline Steps */}
                  <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
                    {[
                      { step: 'Data', icon: '🗂️', done: selectedTiles.size > 0 },
                      { step: 'Config', icon: '⚙️', done: !!scenario },
                      { step: 'Compute', icon: '▶️', done: job?.status === 'done' },
                      { step: 'Results', icon: '📊', done: !!runResult },
                    ].map((s) => (
                      <div key={s.step} style={{ flex: 1, textAlign: 'center', padding: '6px 2px', background: s.done ? `${S.accent}12` : S.card, border: `1px solid ${s.done ? S.accent : S.border}`, borderRadius: 4, fontSize: 8 }}>
                        <div style={{ fontSize: 14, marginBottom: 2 }}>{s.icon}</div>
                        <div style={{ fontWeight: 700, color: s.done ? S.accent : S.textDim }}>{s.step}</div>
                      </div>
                    ))}
                  </div>

                  {/* Engine picker */}
                  <SectionTitle>ENGINE</SectionTitle>
                  <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                    {(['fast', 'sph', 'delft3d'] as const).map(e => (
                      <button key={e} onClick={() => setEngine(e)} style={pill(engine === e)}>{e}</button>
                    ))}
                  </div>

                  {/* Selected Summary */}
                  <SectionTitle>SELECTED DATA</SectionTitle>
                  <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 4, padding: 8, marginBottom: 8, fontSize: 10 }}>
                    <div style={{ color: S.textDim }}>Datasets: <b style={{ color: S.text }}>{selectedTiles.size}</b></div>
                    <div style={{ color: S.textDim }}>Grid: <b style={{ color: S.text }}>{simParams.gridX}×{simParams.gridY}</b></div>
                    <div style={{ color: S.textDim }}>Engine: <b style={{ color: S.text }}>{engine}</b></div>
                    <div style={{ color: S.textDim }}>Horizon: <b style={{ color: S.text }}>{simParams.duration}h</b></div>
                  </div>

                  {/* Compute Job Status */}
                  {job && (
                    <div style={{ background: S.card, border: `1px solid ${job.status === 'done' ? S.success : job.status === 'error' ? S.danger : S.accent}`, borderRadius: 6, padding: 10, marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: job.status === 'done' ? S.success : job.status === 'error' ? S.danger : S.accent }}>
                          {job.status === 'queued' ? '⏳ Queued' : job.status === 'running' ? '🔄 Running' : job.status === 'done' ? '✅ Complete' : '❌ Error'}
                        </span>
                        <span style={{ fontSize: 10, color: S.textDim }}>{job.progress}%</span>
                      </div>
                      <div style={{ height: 6, background: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden', marginBottom: 6 }}>
                        <div style={{ height: '100%', width: `${job.progress}%`, background: job.status === 'done' ? S.success : job.status === 'error' ? S.danger : S.accent, borderRadius: 3, transition: 'width 0.1s' }} />
                      </div>
                      {job.status === 'error' && job.error && (
                        <div style={{ fontSize: 9, color: S.danger }}>{job.error}</div>
                      )}
                      {job.status === 'done' && runResult && (
                        <div style={{ fontSize: 10, lineHeight: 1.6 }}>
                          <div>Max Depth: <b style={{ color: S.accent }}>{fmt(maxDepth, 1, 'm')}</b></div>
                          <div>Flooded Area: <b>{fmt(floodedArea, 1, 'km²')}</b></div>
                          <div>Peak Discharge: <b style={{ color: S.warn }}>{fmt(peakCms, 0, ' m³/s')}</b></div>
                          <div>Affected Pop: <b style={{ color: S.danger }}>{affectedPop != null ? affectedPop.toLocaleString() : '—'}</b></div>
                          <div>Volume: <b>{fmt(metrics?.volume_hm3, 1, ' hm³')}</b></div>
                          <div>Validation: <b style={{ color: S.success }}>{grade ?? '—'}</b></div>
                        </div>
                      )}
                    </div>
                  )}

                  {!jobRunning && (
                    <button onClick={() => void startCompute()} disabled={!scenario}
                      style={{ width: '100%', background: `linear-gradient(135deg, ${S.accent}, #00aa88)`, color: '#000', border: 'none', borderRadius: 6, padding: '10px', cursor: scenario ? 'pointer' : 'not-allowed', fontWeight: 900, fontSize: 12, letterSpacing: 1, opacity: scenario ? 1 : 0.5 }}>
                      ▶ RUN COMPUTE
                    </button>
                  )}

                  {/* Compute History */}
                  {scenarioRuns.length > 0 && (
                    <>
                      <SectionTitle>COMPUTE HISTORY</SectionTitle>
                      {scenarioRuns.slice(0, 4).map((r) => (
                        <div key={r.id} style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 4, padding: '6px 8px', marginBottom: 4, fontSize: 9, display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: r.state === 'VALIDATED' || r.state === 'PUBLISHED' ? S.success : r.state === 'FAILED' ? S.danger : S.accent }}>
                            {r.state === 'VALIDATED' || r.state === 'PUBLISHED' ? '✅' : r.state === 'FAILED' ? '❌' : '🔄'} {r.state}
                          </span>
                          <span style={{ color: S.textDim }}>{r.engine} · {new Date(r.created).toLocaleTimeString()}</span>
                        </div>
                      ))}
                    </>
                  )}

                  <div style={{ fontSize: 9, color: S.textDim, marginTop: 8, padding: 8, background: S.card, borderRadius: 4, lineHeight: 1.5 }}>
                    ⚡ Applied to the run spec: engine, horizon, breach width/formation, reservoir level/inflow, dam type, failure mode. Solver internals use backend defaults.
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── CENTER: 3D VIEWPORT ───────────────────────────── */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {/* Warning Ticker */}
          <div style={{ position: 'absolute', top: 8, left: 80, right: 340, zIndex: 20, background: crisisMode ? 'rgba(255,0,0,0.15)' : 'rgba(239,68,68,0.1)', border: `1px solid ${crisisMode ? 'rgba(255,0,0,0.5)' : 'rgba(239,68,68,0.3)'}`, borderRadius: 6, padding: '4px 12px', color: crisisMode ? '#ff4444' : '#ff6b6b', fontSize: 10, fontWeight: 600, backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', whiteSpace: 'nowrap' }}>
            <span style={{ fontWeight: 800, letterSpacing: 1, flexShrink: 0 }}>🚨</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{tickerText}</span>
          </div>

          {/* 3D Canvas */}
          <Canvas shadows camera={{ position: [600, 900, -1200], fov: 45, near: 10, far: 8000 }}
            style={{ width: '100%', height: '100%' }} gl={{ antialias: true }}
            onCreated={({ scene }) => {
              const bg = weatherMode === 'night' ? '#050d0a' : weatherMode === 'storm' ? '#0a0e14' : '#1e1e1e';
              scene.background = new THREE.Color(bg);
              scene.fog = new THREE.Fog(bg, 2500, 6000);
            }}>
            <CameraRig cameraMode={cameraMode} />
            <CameraFloorConstraint />
            <ambientLight intensity={weatherMode === 'night' ? 0.2 : weatherMode === 'storm' ? 0.3 : 0.5} />
            <directionalLight position={[-600, 800, -800]} intensity={weatherMode === 'night' ? 0.4 : weatherMode === 'storm' ? 1.0 : 2.0} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-far={4000} shadow-camera-left={-1500} shadow-camera-right={1500} shadow-camera-top={2500} shadow-camera-bottom={-2500} />
            <directionalLight position={[800, 300, 800]} intensity={weatherMode === 'night' ? 0.1 : 0.4} />
            <hemisphereLight args={[weatherMode === 'night' ? '#00ffaa' : weatherMode === 'storm' ? '#556688' : '#aaccff', '#3a2a10', 0.3]} />
            <SceneComposer layout={layout} waterPositions={waterPositions} prevWaterPositions={prevWaterPositions} sweptObjects={sweptFrameObjects} drapeMode={drapeMode} weatherMode={weatherMode} onSelectObject={setSelectedObj} realTexture={realMapTex} onGeoHover={setGeoCoord} />
            <OrbitControls target={[0, 0, 0]} minDistance={600} maxDistance={2500} minPolarAngle={0.3} maxPolarAngle={Math.PI / 3} enableDamping dampingFactor={0.07} rotateSpeed={0.4} zoomSpeed={0.8} screenSpacePanning={false} />
          </Canvas>

          {/* Geo Coordinate HUD */}
          {geoCoord && (
            <div style={{ position: 'absolute', bottom: 80, left: 12, zIndex: 20, background: 'rgba(0,0,0,0.88)', border: `1px solid ${S.accent}40`, borderRadius: 6, padding: '6px 12px', fontFamily: 'monospace', fontSize: 11, color: S.accent, lineHeight: 1.6, backdropFilter: 'blur(8px)' }}>
              <div style={{ fontWeight: 800, fontSize: 9, letterSpacing: 1, color: S.textDim, marginBottom: 2 }}>GEO COORDINATES</div>
              <div>📍 {geoCoord.lat.toFixed(6)}°N {geoCoord.lng.toFixed(6)}°E</div>
              <div>⬆ Elevation: {geoCoord.elev.toFixed(1)}m</div>
            </div>
          )}

          {/* Real Map Loading Indicator */}
          {realMapLoading && (
            <div style={{ position: 'absolute', top: 40, left: '50%', transform: 'translateX(-50%)', zIndex: 20, background: 'rgba(0,0,0,0.8)', border: `1px solid ${S.accent}`, borderRadius: 6, padding: '6px 16px', fontSize: 10, color: S.accent, fontWeight: 700 }}>
              🛰️ Fetching real map tiles from OpenStreetMap/Esri...
            </div>
          )}

          {/* Camera Controls Overlay */}
          <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 20, background: 'rgba(18,24,32,0.85)', border: `1px solid ${S.border}`, borderRadius: 8, padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {([
              { id: 'director' as const, label: '🎥 Director' }, { id: 'drone' as const, label: '🚁 Drone' }, { id: 'action' as const, label: '🌊 Action' },
            ]).map(c => (
              <button key={c.id} onClick={() => setCameraMode(c.id)} style={{
                background: cameraMode === c.id ? S.accent : 'transparent',
                color: cameraMode === c.id ? '#000' : S.textDim, border: 'none', borderRadius: 4, padding: '4px 8px',
                cursor: 'pointer', fontSize: 10, fontWeight: 700, textAlign: 'left',
              }}>{c.label}</button>
            ))}
          </div>

          {/* Asset Inspector */}
          {selectedObj && (
            <div style={{ position: 'absolute', bottom: 100, right: 8, zIndex: 25, background: 'rgba(18,24,32,0.92)', border: `1px solid ${S.accent}50`, borderRadius: 8, padding: 12, width: 240, color: S.text, backdropFilter: 'blur(10px)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: S.accent }}>🔍 ASSET INSPECTOR</div>
                <button onClick={() => setSelectedObj(null)} style={{ background: 'none', border: 'none', color: S.textDim, cursor: 'pointer', fontSize: 14 }}>✕</button>
              </div>
              <div style={{ fontSize: 10, lineHeight: 1.8 }}>
                <div><b>ID:</b> {selectedObj.id}</div>
                <div><b>Type:</b> <span style={{ color: S.accent }}>{selectedObj.asset}</span></div>
                <div><b>Elev:</b> {selectedObj.position?.y?.toFixed(1) || selectedObj.y?.toFixed(1)}m</div>
                <div><b>Status:</b> <span style={{ color: hospitalHit && selectedObj.asset === 'hospital' ? S.danger : S.success, fontWeight: 700 }}>
                  {hospitalHit && selectedObj.asset === 'hospital' ? '🔴 IMPACTED' : bridgeHit && selectedObj.asset?.startsWith('bridge') ? '🔴 IMPACTED' : '🟢 SAFE'}
                </span></div>
              </div>
            </div>
          )}

          {/* Bottom Timeline */}
          {floodData && !isDownloading && (
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20, background: 'linear-gradient(to top, rgba(0,0,0,0.92), transparent)', padding: '16px 24px 12px' }}>
              {/* Progress bar */}
              <div onClick={(e) => { const rect = e.currentTarget.getBoundingClientRect(); setFrame(Math.round(((e.clientX - rect.left) / rect.width) * floodData.totalFrames)); }}
                style={{ height: 4, background: 'rgba(255,255,255,0.2)', borderRadius: 2, cursor: 'pointer', marginBottom: 8, position: 'relative' }}>
                <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${pct}%`, background: S.accent, borderRadius: 2, transition: 'width 0.05s' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12 }}>
                <button onClick={() => { setPlaying(false); setFrame(0); }} style={{ background: '#444', color: 'white', border: 'none', borderRadius: 4, padding: '5px 12px', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>⏮</button>
                {playing ? (
                  <button onClick={() => setPlaying(false)} style={{ background: S.accent, color: '#000', border: 'none', borderRadius: 4, padding: '5px 16px', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>⏸ Pause</button>
                ) : (
                  <button onClick={() => { if (frame >= floodData.totalFrames) setFrame(0); setPlaying(true); }} style={{ background: S.danger, color: 'white', border: 'none', borderRadius: 4, padding: '5px 16px', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>▶ Play</button>
                )}
                <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,0.1)', padding: 2, borderRadius: 4 }}>
                  {[0.5, 1, 2, 4].map(s => (
                    <button key={s} onClick={() => setSpeed(s)} style={{
                      background: speed === s ? S.accent : 'transparent', color: speed === s ? '#000' : S.textDim,
                      border: 'none', borderRadius: 3, padding: '2px 6px', cursor: 'pointer', fontSize: 10, fontWeight: 700,
                    }}>{s}x</button>
                  ))}
                </div>
                <span style={{ fontSize: 10, color: S.textDim, fontFamily: 'monospace' }}>Frame {frame}/{floodData.totalFrames}</span>
                <span style={{ fontSize: 10, color: S.accent, fontFamily: 'monospace' }}>T={((frame / floodData.totalFrames) * 24).toFixed(1)}h</span>
              </div>
            </div>
          )}
        </div>

        {/* ─── RIGHT PANEL ───────────────────────────── */}
        {rightOpen && (
          <div style={{ width: 320, borderLeft: `1px solid ${S.border}`, display: 'flex', flexDirection: 'column', background: '#0d0d12', flexShrink: 0 }}>
            <div style={{ display: 'flex', borderBottom: `1px solid ${S.border}`, overflow: 'auto' }}>
              {([
                { id: 'kpi' as const, label: '📈' }, { id: 'assets' as const, label: '🏥' },
                { id: 'charts' as const, label: '📊' }, { id: 'heatmap' as const, label: '🗺️' },
                { id: 'export' as const, label: '📄' }, { id: 'alerts' as const, label: '🔔' },
              ]).map(t => <button key={t.id} onClick={() => setRightTab(t.id)} style={panelTab(rightTab === t.id)}>{t.label}</button>)}
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>

              {/* KPI */}
              {rightTab === 'kpi' && (
                <div>
                  <SectionTitle>LIVE SIMULATION METRICS</SectionTitle>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
                    <KpiCard icon="🌊" label="DEPTH" value={fmt(maxDepth, 1)} unit="m" color={maxDepth != null && maxDepth > 10 ? S.danger : S.accent} />
                    <KpiCard icon="⚡" label="VELOCITY" value={maxVelocity != null ? maxVelocity.toFixed(1) : '—'} unit="m/s" color={S.warn} />
                    <KpiCard icon="📐" label="AREA" value={fmt(floodedArea, 1)} unit="km²" color={S.accent} />
                    <KpiCard icon="👥" label="AFFECTED" value={affectedPop != null ? affectedPop.toLocaleString() : '—'} unit="" color={S.accent} />
                  </div>
                  <SectionTitle>FLOOD PROGRESSION</SectionTitle>
                  <MiniChart data={flowSeries} dataKey="q" color="#00ffcc" width={280} height={100} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: S.textDim, marginTop: 2 }}>
                    <span>{flowSeries.length ? `T+${flowSeries[0].t}h` : '0h'}</span>
                    <span>{flowSeries.length ? `T+${flowSeries[Math.floor(flowSeries.length / 2)].t}h` : '12h'}</span>
                    <span>{flowSeries.length ? `T+${flowSeries[flowSeries.length - 1].t}h` : '24h'}</span>
                  </div>
                  <SectionTitle>DELFT3D TELEMETRY</SectionTitle>
                  <div style={{ fontSize: 10, lineHeight: 1.8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: S.textDim }}>Engine:</span><span style={{ fontWeight: 700, fontFamily: 'monospace' }}>{activeRun?.engine ?? engine}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: S.textDim }}>Peak Q:</span><span style={{ fontWeight: 700, fontFamily: 'monospace' }}>{fmt(peakCms, 0, ' m³/s')}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: S.textDim }}>Mass balance:</span><span style={{ fontWeight: 700 }}>{fmt(metrics?.mass_balance_error_pct, 2, ' %')}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: S.textDim }}>Grade:</span><span style={{ fontWeight: 700, color: S.success }}>{grade ?? '—'}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: S.textDim }}>Villages:</span><span style={{ fontWeight: 700 }}>{runResult?.impact?.villages_affected ?? '—'}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: S.textDim }}>Duration:</span><span style={{ fontWeight: 700 }}>{fmt(metrics?.duration_hr, 1, ' h')}</span></div>
                  </div>
                </div>
              )}

              {/* ASSETS */}
              {rightTab === 'assets' && (
                <div>
                  <SectionTitle>CRITICAL ASSET IMPACT</SectionTitle>
                  <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 6, padding: '8px 10px', marginBottom: 8, fontSize: 10, display: 'flex', justifyContent: 'space-between' }}>
                    <span><b>Hospitals</b> {infra?.hospitals ?? '—'}</span>
                    <span><b>Bridges</b> {infra?.bridges ?? '—'}</span>
                    <span><b>Roads</b> {infra ? `${infra.roads_km.toFixed(1)} km` : '—'}</span>
                  </div>
                  {villages.length === 0 && (
                    <div style={dimText}>No completed run yet — press RUN COMPUTE to populate impact.</div>
                  )}
                  {villages.map((v, i) => {
                    const depth = v.depth_m ?? 0;
                    const status = depth >= 3 ? 'SUBMERGED' : depth >= 0.5 ? 'FLOODED' : 'IMPACTED';
                    const hazard = String(v.hazard ?? 'LOW');
                    const hazardColor = hazard === 'HIGH' ? S.danger : hazard === 'MODERATE' ? S.warn : S.success;
                    return (
                      <div key={i} style={{
                        background: hazard === 'HIGH' ? 'rgba(239,68,68,0.08)' : S.card,
                        border: `1px solid ${hazard === 'HIGH' ? 'rgba(239,68,68,0.3)' : S.border}`,
                        borderRadius: 6, padding: '8px 10px', marginBottom: 6, fontSize: 10,
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <span style={{ fontWeight: 700 }}>{v.name ?? 'Village'}</span>
                          <span style={{
                            padding: '1px 4px', borderRadius: 2, fontWeight: 700, fontSize: 8,
                            background: `${hazardColor}20`, color: hazardColor,
                          }}>{hazard}</span>
                        </div>
                        <div style={{ color: S.textDim, lineHeight: 1.6 }}>
                          {status}
                          <div style={{ marginTop: 4, display: 'flex', gap: 8 }}>
                            <span>Depth: <b style={{ color: S.text }}>{fmt(depth, 1, 'm')}</b></span>
                            <span>Pop: <b style={{ color: S.text }}>{v.population ?? 0}</b></span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* CHARTS */}
              {rightTab === 'charts' && (
                <div>
                  <SectionTitle>TIME SERIES ANALYSIS</SectionTitle>
                  <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 6, padding: 10, marginBottom: 8 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: S.accent, marginBottom: 4 }}>Discharge (m³/s){hydro ? ` · ${Object.keys(hydro)[0] ?? 'station'}` : ''}</div>
                    <MiniChart data={flowSeries} dataKey="q" color="#00ffcc" width={280} height={120} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: S.textDim }}>
                      <span>{flowSeries.length ? `T+${flowSeries[0].t}h` : '0h'}</span>
                      <span>{flowSeries.length ? `T+${flowSeries[flowSeries.length - 1].t}h` : '—'}</span>
                    </div>
                  </div>
                  <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 6, padding: 10, marginBottom: 8 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: S.warn, marginBottom: 4 }}>Peak Discharge by Station (m³/s)</div>
                    <MiniChart data={stationPeak} dataKey="peak" color="#f59e0b" width={280} height={120} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: S.textDim }}>
                      <span>{stationPeak[0]?.label ?? '—'}</span>
                      <span>{stationPeak[stationPeak.length - 1]?.label ?? ''}</span>
                    </div>
                  </div>
                  <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 6, padding: 10 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#3b82f6', marginBottom: 4 }}>Arrival Time by Station (h)</div>
                    <MiniChart data={stationArrival} dataKey="arrival" color="#3b82f6" width={280} height={120} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: S.textDim }}>
                      <span>{stationArrival[0]?.label ?? '—'}</span>
                      <span>{stationArrival[stationArrival.length - 1]?.label ?? ''}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* HEATMAP */}
              {rightTab === 'heatmap' && (
                <div>
                  <SectionTitle>ARRIVAL TIME HEATMAP</SectionTitle>
                  <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 6, padding: 10, marginBottom: 8 }}>
                    <ArrivalHeatmap stations={stations} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <Legend color="rgba(0,255,204,0.9)" label="0-2h" />
                    <Legend color="rgba(0,255,100,0.7)" label="2-6h" />
                    <Legend color="rgba(0,200,50,0.5)" label="6-12h" />
                    <Legend color="rgba(0,150,30,0.3)" label="12-24h" />
                  </div>
                </div>
              )}

              {/* EXPORT */}
              {rightTab === 'export' && (
                <div>
                  <SectionTitle>GEOSPATIAL EXPORT</SectionTitle>
                  {!runResult && <div style={{ ...dimText, marginBottom: 8 }}>Run a simulation to enable exports.</div>}
                  {EXPORT_FORMATS.map(e => {
                    const st = exportState[e.fmt];
                    const ready = st && st.startsWith('/');
                    return (
                      <div key={e.fmt} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: S.card, border: `1px solid ${S.border}`, borderRadius: 6, padding: '8px 10px', marginBottom: 6 }}>
                        <div style={{ fontSize: 10 }}>
                          <div style={{ fontWeight: 700 }}>{e.icon} {e.label}</div>
                          <div style={{ color: S.textDim }}>{e.desc}</div>
                        </div>
                        {ready ? (
                          <a href={st} download style={{ background: e.color, color: '#000', border: 'none', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 9, fontWeight: 700, textDecoration: 'none' }}>DOWNLOAD</a>
                        ) : st === 'busy' ? (
                          <span style={{ fontSize: 9, color: S.accent }}>⏳ packaging…</span>
                        ) : st?.startsWith('error') || st === 'no-run' ? (
                          <button onClick={() => void doExport(e.fmt)} style={{ background: `${S.danger}30`, color: S.danger, border: `1px solid ${S.danger}`, borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 9, fontWeight: 700 }}>RETRY</button>
                        ) : (
                          <button onClick={() => void doExport(e.fmt)} disabled={!runResult} style={{ background: runResult ? e.color : '#333', color: runResult ? '#000' : '#777', border: 'none', borderRadius: 4, padding: '4px 10px', cursor: runResult ? 'pointer' : 'not-allowed', fontSize: 9, fontWeight: 700 }}>DOWNLOAD</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ALERTS */}
              {rightTab === 'alerts' && (
                <div>
                  <SectionTitle>ALERT LOG</SectionTitle>
                  {alerts.length === 0 && (
                    <div style={dimText}>No alerts yet — alerts fire on run completion and GEE events.</div>
                  )}
                  {alerts.slice(0, 30).map(a => {
                    const lvl = a.level === 'CRITICAL' ? 'danger' : a.level === 'WARNING' ? 'warn' : 'info';
                    return (
                      <div key={a.id} style={{
                        background: lvl === 'danger' ? 'rgba(239,68,68,0.08)' : lvl === 'warn' ? 'rgba(245,158,11,0.08)' : S.card,
                        border: `1px solid ${lvl === 'danger' ? 'rgba(239,68,68,0.3)' : lvl === 'warn' ? 'rgba(245,158,11,0.3)' : S.border}`,
                        borderRadius: 6, padding: '8px 10px', marginBottom: 6, fontSize: 10,
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ color: S.accent, fontWeight: 700 }}>{new Date(a.created).toLocaleTimeString()}</span>
                          <span style={{ color: lvl === 'danger' ? S.danger : lvl === 'warn' ? S.warn : S.accent, fontWeight: 700, textTransform: 'uppercase', fontSize: 8 }}>{a.level}</span>
                        </div>
                        <div style={{ color: S.textDim }}>{a.title}{a.body ? ` — ${a.body}` : ''}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub Components ──────────────────────────────────────────────────────────
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 9, fontWeight: 800, color: S.accent, letterSpacing: 1.5, marginBottom: 6, marginTop: 12 }}>{children}</div>;
}

function KpiMini({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 4, padding: '6px 8px' }}>
      <div style={{ fontSize: 8, color: S.textDim, letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 900, color }}>{value}</div>
    </div>
  );
}

function KpiCard({ icon, label, value, unit, color }: { icon: string; label: string; value: string; unit: string; color: string }) {
  return (
    <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 6, padding: 10 }}>
      <div style={{ fontSize: 16, marginBottom: 2 }}>{icon}</div>
      <div style={{ fontSize: 8, color: S.textDim, letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 900, color }}>{value} <span style={{ fontSize: 9, fontWeight: 400 }}>{unit}</span></div>
    </div>
  );
}

function MiniCard({ icon, label, desc, active }: { icon: string; label: string; desc: string; active?: boolean }) {
  return (
    <div style={{ background: active ? `${S.accent}08` : S.card, border: `1px solid ${active ? `${S.accent}40` : S.border}`, borderRadius: 4, padding: 8, fontSize: 10 }}>
      <div style={{ fontWeight: 700 }}>{icon} {label}</div>
      <div style={{ color: S.textDim, fontSize: 9 }}>{desc}</div>
    </div>
  );
}

function SliderParam({ label, value, min, max, step, unit, k, onChange }: {
  label: string; value: number; min: number; max: number; step: number; unit: string; k: string;
  onChange: (key: string, val: number) => void;
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
        <span style={{ fontSize: 10, color: S.textDim }}>{label}</span>
        <span style={{ fontSize: 10, color: S.accent, fontWeight: 700, fontFamily: 'monospace' }}>{value} {unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(k, +e.target.value)} style={{ width: '100%', accentColor: S.accent, height: 3 }} />
    </div>
  );
}

function ArrivalHeatmap({ stations }: { stations: Station[] }) {
  if (!stations.length) {
    return <div style={{ padding: 20, textAlign: 'center', color: S.textDim, fontSize: 10 }}>No completed run yet.</div>;
  }
  const cells = stations.map(s => ({ label: s.name || `${s.km} km`, val: s.arrival_hr }));
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cells.length}, 1fr)`, gap: 2 }}>
      {cells.map((c, i) => {
        const val = c.val;
        const intensity = val != null && Number.isFinite(val) ? Math.min(1, Math.max(0, val / 24)) : 0;
        return (
          <div key={i} style={{
            background: val != null && Number.isFinite(val)
              ? `rgba(0, ${Math.round(255 * (1 - intensity))}, ${Math.round(255 * (1 - intensity * 0.3))}, ${0.3 + intensity * 0.6})`
              : S.border,
            borderRadius: 2, padding: '6px 2px', textAlign: 'center', fontSize: 8, fontWeight: 700, color: '#fff',
          }}>
            <div style={{ opacity: 0.8 }}>{c.label}</div>
            <div>{val != null && Number.isFinite(val) ? `${val.toFixed(1)}h` : '—'}</div>
          </div>
        );
      })}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9 }}>
      <div style={{ width: 10, height: 10, background: color, borderRadius: 2 }} />
      <span>{label}</span>
    </div>
  );
}
