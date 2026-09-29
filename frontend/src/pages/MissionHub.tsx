import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import type { Run, Scenario } from '../lib/api';

// The three SIH26161 use cases are fixed product definitions (content);
// counts and statuses below are live from the backend catalog.
const missions = [
  {
    id: '01',
    caseId: '1',
    title: 'Himalayan GLOF (Rishi Ganga)',
    description: 'Natural disaster focus. Glacial Lake Outburst Floods in steep terrain.',
    classified: false,
  },
  {
    id: '02',
    caseId: '2',
    title: 'Reservoir Overspill (Kosi River)',
    description: 'Water release issues from major river dams impacting lower encroachment.',
    classified: false,
  },
  {
    id: '03',
    caseId: '3',
    title: 'Crisis Sabotage (Transboundary Threat)',
    description: 'Geopolitical dam breach scenario impacting critical infrastructure.',
    classified: true,
  },
];

export default function MissionHub() {
  const navigate = useNavigate();
  const [scenarios, setScenarios] = useState<Scenario[] | null>(null);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([api.scenarios(), api.runs()])
      .then(([sc, rn]) => {
        if (!alive) return;
        setScenarios(sc);
        setRuns(rn);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  const statusOf = (mission: (typeof missions)[number]) => {
    if (mission.classified) return 'CLASSIFIED';
    const sc = scenarios?.filter((s) => s.case === mission.caseId) ?? [];
    const scIds = new Set(sc.map((s) => s.id));
    const hasRun = (runs ?? []).some((r) => scIds.has(r.scenario_id));
    if (hasRun) return 'ACTIVE';
    if (sc.length > 0) return 'STANDBY';
    return scenarios === null ? '…' : 'STANDBY';
  };

  const countsOf = (mission: (typeof missions)[number]) => {
    const sc = scenarios?.filter((s) => s.case === mission.caseId) ?? [];
    const scIds = new Set(sc.map((s) => s.id));
    const rn = (runs ?? []).filter((r) => scIds.has(r.scenario_id));
    return { scenarios: sc.length, runs: rn.length };
  };

  return (
    <div style={{ backgroundColor: '#0a0a0a', color: '#e0e0e0', minHeight: '100vh', fontFamily: 'monospace', padding: '2rem' }}>
      <div style={{ borderBottom: '1px solid #333', paddingBottom: '1rem', marginBottom: '2rem' }}>
        <h1 style={{ margin: 0, color: '#fff', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ color: '#00ffcc' }}>▶</span> NIYANTA : MISSION COMMAND
        </h1>
        <p style={{ margin: '0.5rem 0 0 0', color: '#888' }}>NATIONAL TECHNICAL RESEARCH ORGANISATION (NTRO) - SIH26161</p>
        {error && <p style={{ margin: '0.5rem 0 0 0', color: '#ff5555' }}>backend unreachable: {error}</p>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
        {missions.map(mission => {
          const status = statusOf(mission);
          const counts = countsOf(mission);
          return (
            <div
              key={mission.id}
              style={{
                backgroundColor: '#151515',
                border: '1px solid #333',
                padding: '1.5rem',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onMouseOver={(e) => e.currentTarget.style.borderColor = '#00ffcc'}
              onMouseOut={(e) => e.currentTarget.style.borderColor = '#333'}
              onClick={() => navigate(`/mission/${mission.id}`)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                <h2 style={{ margin: 0, fontSize: '1.2rem', color: '#fff' }}>MISSION {mission.id}</h2>
                <span style={{
                  fontSize: '0.8rem',
                  padding: '0.2rem 0.5rem',
                  backgroundColor: mission.classified ? '#ff333333' : '#33ff3333',
                  color: mission.classified ? '#ff4444' : '#44ff44',
                  border: `1px solid ${mission.classified ? '#ff4444' : '#44ff44'}`
                }}>
                  {status}
                </span>
              </div>
              <h3 style={{ margin: '0 0 1rem 0', color: '#ccc', fontSize: '1rem' }}>{mission.title}</h3>
              <p style={{ margin: '0 0 0.75rem 0', color: '#888', fontSize: '0.9rem', lineHeight: '1.4' }}>{mission.description}</p>
              <p style={{ margin: 0, color: '#00ffcc', fontSize: '0.8rem' }}>
                {scenarios === null && !error
                  ? 'loading catalog…'
                  : `${counts.scenarios} scenario${counts.scenarios === 1 ? '' : 's'} · ${counts.runs} run${counts.runs === 1 ? '' : 's'}`}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
