import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import type { Run, Scenario } from '../lib/api';

// Per-case product labels (SIH brief content); projects below are live catalog data.
const missionMeta: Record<string, { name: string; classification: string }> = {
  '01': { name: 'RISHI GANGA FLASH FLOOD', classification: 'UNCLASSIFIED' },
  '02': { name: 'KOSI RIVER BARRAGE', classification: 'CONFIDENTIAL' },
  '03': { name: 'BRAHMAPUTRA SCENARIO', classification: 'TOP SECRET' },
};

const workflowSteps = [
  { id: 'data', label: 'DATA INGEST', icon: '🗂️', desc: 'DEM + Satellite + OSM' },
  { id: 'config', label: 'SIM CONFIG', icon: '⚙️', desc: 'Breach + solver params' },
  { id: 'run', label: 'SIMULATION', icon: '▶️', desc: 'Run flood model' },
  { id: 'results', label: 'ANALYTICS', icon: '📈', desc: 'Impact + charts' },
  { id: 'export', label: 'EXPORT', icon: '📄', desc: 'KML + SHP + GeoTIFF' },
];

interface Project {
  id: string;
  name: string;
  status: string;
  coord: string;
  engine: string;
  breachMethod: string;
  durationHr: number;
  storageMcm: number;
  runsDone: number;
  stepsDone: number;
}

function toProject(sc: Scenario, runs: Run[]): Project {
  const mine = runs.filter((r) => r.scenario_id === sc.id);
  const latest = mine.find((r) => r.state === 'VALIDATED' || r.state === 'PUBLISHED')
    ?? mine.find((r) => r.state === 'RUNNING')
    ?? mine[0];
  const spec = (sc.spec ?? {}) as Record<string, any>;
  const bbox: number[] | undefined = spec.aoi?.coords?.length === 4 ? spec.aoi.coords : undefined;
  const coord = bbox
    ? `${(((bbox[1] + bbox[3]) / 2)).toFixed(2)}°N, ${(((bbox[0] + bbox[2]) / 2)).toFixed(2)}°E`
    : 'AOI not set';
  const validated = mine.some((r) => r.state === 'VALIDATED' || r.state === 'PUBLISHED');
  const status = validated ? 'COMPLETE'
    : latest?.state === 'RUNNING' ? 'RUNNING'
    : sc.status === 'draft' ? 'IN_PREP'
    : 'READY';
  const stepsDone = !latest ? 2
    : validated ? 5
    : latest.state === 'RUNNING' ? (latest.progress >= 70 ? 4 : 3)
    : 2;
  return {
    id: sc.id,
    name: sc.name || `Scenario ${sc.id.slice(0, 8)}`,
    status,
    coord,
    engine: String(spec.engine ?? 'fast'),
    breachMethod: String(spec.breach?.method ?? 'froehlich2008'),
    durationHr: Number(spec.horizon?.duration_hr ?? 24),
    storageMcm: Number(spec.reservoir?.storage_mcm ?? 0),
    runsDone: mine.length,
    stepsDone,
  };
}

export default function MissionOverview() {
  const { missionId } = useParams<{ missionId: string }>();
  const navigate = useNavigate();
  const [scenarios, setScenarios] = useState<Scenario[] | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);

  const caseId = missionId?.replace(/^0+/, '') ?? '';
  const meta = missionId && missionMeta[missionId] ? missionMeta[missionId] : null;

  useEffect(() => {
    let alive = true;
    setScenarios(null);
    setError(null);
    Promise.all([api.scenarios(caseId), api.runs()])
      .then(([sc, rn]) => {
        if (!alive) return;
        setScenarios(sc);
        setRuns(rn);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [caseId]);

  const projects = (scenarios ?? []).map((sc) => toProject(sc, runs));

  const S = { bg: '#0a0a0f', card: '#12141a', border: '#1e2230', accent: '#00ffcc', text: '#e0e0e0', textDim: '#6b7280', danger: '#ff3b3b', warn: '#f59e0b', success: '#22c55e' };

  return (
    <div style={{ backgroundColor: S.bg, color: S.text, minHeight: '100vh', fontFamily: 'Inter, sans-serif' }}>
      {/* Header */}
      <div style={{ borderBottom: `1px solid ${S.border}`, padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button onClick={() => navigate('/')} style={{ background: 'none', border: `1px solid ${S.border}`, color: S.textDim, padding: '6px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
            ← BACK TO HUB
          </button>
          <div>
            <div style={{ fontSize: 10, color: S.accent, letterSpacing: 2, fontWeight: 800 }}>
              {meta?.classification || 'UNCLASSIFIED'}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              MISSION {missionId}: {meta?.name || 'UNKNOWN'}
            </div>
          </div>
        </div>
        <div style={{ fontSize: 11, color: error ? S.danger : S.textDim }}>
          {error ? `catalog error: ${error}` : scenarios === null ? 'loading catalog…' : `${projects.length} project${projects.length === 1 ? '' : 's'}`}
        </div>
      </div>

      {/* Workflow Steps */}
      <div style={{ borderBottom: `1px solid ${S.border}`, padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 0 }}>
        {workflowSteps.map((step, i) => (
          <React.Fragment key={step.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: S.card, border: `1px solid ${S.border}`, borderRadius: 6 }}>
              <span style={{ fontSize: 16 }}>{step.icon}</span>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: S.accent }}>{step.label}</div>
                <div style={{ fontSize: 9, color: S.textDim }}>{step.desc}</div>
              </div>
            </div>
            {i < workflowSteps.length - 1 && (
              <div style={{ width: 30, height: 1, background: S.border, flexShrink: 0 }} />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Main Content */}
      <div style={{ display: 'flex', height: 'calc(100vh - 120px)' }}>
        {/* Map Placeholder */}
        <div style={{ flex: 1, background: '#0f1419', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', borderRight: `1px solid ${S.border}` }}>
          <div style={{ textAlign: 'center', color: S.textDim }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🗺️</div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>2D MAP VIEW</div>
            <div style={{ fontSize: 11 }}>Leaflet / OpenStreetMap integration</div>
            <div style={{ fontSize: 11, color: S.accent, marginTop: 8 }}>Phase 2: Live map with project markers</div>
          </div>
          {/* Project markers */}
          {projects.map((p, i) => (
            <div key={p.id} style={{
              position: 'absolute', left: `${30 + i * 25}%`, top: `${35 + i * 15}%`,
              width: 12, height: 12, borderRadius: '50%', background: p.status === 'COMPLETE' || p.status === 'READY' ? S.accent : '#f59e0b',
              boxShadow: `0 0 12px ${p.status === 'COMPLETE' || p.status === 'READY' ? S.accent : '#f59e0b'}`, cursor: 'pointer',
            }} onClick={() => navigate(`/mission/${missionId}/project/${p.id}`)} title={p.name} />
          ))}
        </div>

        {/* Project List */}
        <div style={{ width: 380, padding: 16, overflow: 'auto' }}>
          <div style={{ fontSize: 10, color: S.accent, letterSpacing: 1.5, fontWeight: 800, marginBottom: 12 }}>
            ACTIVE PROJECTS ({projects.length})
          </div>
          {projects.map(p => (
            <div key={p.id} style={{
              background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, padding: 16, marginBottom: 10, cursor: 'pointer', transition: 'border-color 0.15s',
            }}
            onClick={() => navigate(`/mission/${missionId}/project/${p.id}`)}
            onMouseOver={e => e.currentTarget.style.borderColor = S.accent}
            onMouseOut={e => e.currentTarget.style.borderColor = S.border}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{p.name}</div>
                <span style={{
                  padding: '2px 6px', borderRadius: 3, fontSize: 9, fontWeight: 700,
                  background: p.status === 'COMPLETE' ? `${S.success}20` : p.status === 'IN_PREP' ? `${S.warn}20` : `${S.accent}20`,
                  color: p.status === 'COMPLETE' ? S.success : p.status === 'IN_PREP' ? S.warn : S.accent,
                }}>{p.status.replace('_', ' ')}</span>
              </div>
              <div style={{ fontSize: 10, color: S.textDim, lineHeight: 1.8, marginBottom: 8 }}>
                <div>📍 {p.coord}</div>
                <div>⚙️ engine: {p.engine} · breach: {p.breachMethod}</div>
                <div>🌊 horizon: {p.durationHr}h · reservoir: {p.storageMcm} MCM · runs: {p.runsDone}</div>
              </div>
              {/* Workflow mini-steps */}
              <div style={{ display: 'flex', gap: 3 }}>
                {workflowSteps.map((s, i) => (
                  <div key={s.id} style={{
                    flex: 1, height: 3, borderRadius: 2,
                    background: i < p.stepsDone ? S.accent : `${S.accent}40`,
                  }} />
                ))}
              </div>
              <div style={{ fontSize: 9, color: S.accent, marginTop: 8, textAlign: 'right' }}>
                OPEN DASHBOARD →
              </div>
            </div>
          ))}
          {scenarios !== null && projects.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: S.textDim }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
              <div>No active projects for this mission.</div>
            </div>
          )}
          {scenarios === null && !error && (
            <div style={{ textAlign: 'center', padding: 40, color: S.textDim }}>Loading scenarios…</div>
          )}
        </div>
      </div>
    </div>
  );
}
