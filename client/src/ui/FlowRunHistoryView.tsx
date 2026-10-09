import { useState, useEffect, useRef } from 'react';
import { useResource } from '../useResource';
import { Panel } from './Overlays';
import { useStore } from '../store';
import { api } from '../api';
import type { FlowRun } from '../../../shared/flowTelemetry';


export function FlowRunHistoryView({ repoId }: { repoId?: string }) {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [runs, setRuns] = useState<FlowRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>('');
  const [selectedStepIdx, setSelectedStepIdx] = useState<number>(0);
  const repos = useStore((s) => s.repos);
  const pushToast = useStore((s) => s.pushToast);
  const repo = repoId ? repos.find((r) => r.id === repoId) : repos[0];

  const resource = useResource(repo?.id ?? '', () => repo ? api.flowRuns(repo.id) : Promise.resolve([]));
  useEffect(() => {
    setRuns(resource.value ?? []);
    setSelectedRunId(resource.value?.[0]?.id ?? '');
    setSelectedStepIdx(0);
  }, [resource.value, repo?.id]);
  const isRefreshing = resource.loading;
  const fetchRuns = resource.refresh;
  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? runs[0];
  const selectedStep = selectedRun?.steps?.[selectedStepIdx] ?? selectedRun?.steps?.[0] ?? {
    num: 1, name: 'Default Step', type: 'Action', duration: '0 ms', status: '200 OK', color: '#38bdf8', input: {}, output: {}
  };

  const handleResubmit = async () => {
    if (!repo || !selectedRun) return;
    try {
      const res = await api.resubmitFlowRun(repo.id, selectedRun.id);
      if (!mounted.current) return;
      if (res?.resubmitted) {
        setRuns((prev) => [res.resubmitted, ...prev]);
        setSelectedRunId(res.resubmitted.id);
        setSelectedStepIdx(0);
        pushToast('success', 'Simulated resubmission saved. No cloud flow was triggered.');
      }
    } catch {
      if (mounted.current) pushToast('error', 'Failed to resubmit flow run');
    }
  };

  if (!selectedRun || resource.loading || resource.error) return <Panel title="Simulated flow history" wide><p>{resource.loading ? 'Loading flow history…' : resource.error || 'No runs in this repository.'}</p><button onClick={fetchRuns}>Refresh</button></Panel>;

  return (
    <Panel
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>⚡</span>
          <span>Power Automate · Cloud Flow Telemetry & Run Engine {repo ? `(${repo.fullName})` : ''}</span>
          <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 999, background: '#0066FF', color: '#fff', fontWeight: 600 }}>
            FLOW: {selectedRun.flowId}
          </span>
          <span style={{ fontSize: 11, color: '#f59e0b', background: '#451a03', border: '1px solid #b45309', padding: '2px 8px', borderRadius: 6, fontWeight: 700, letterSpacing: '0.04em' }}>
            ⚠️ SIMULATED TELEMETRY
          </span>
        </div>
      }
      wide
      accent="#0066FF"
      className="flow-run-modal"
    >
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr 340px', gap: 16, minHeight: 560 }}>
        {/* Left: Run History List */}
        <div style={{ background: '#0f172a', borderRadius: 12, padding: 14, border: '1px solid #1e293b', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1e293b', paddingBottom: 8 }}>
            <span style={{ fontSize: 13, color: '#94a3b8', fontWeight: 700 }}>RECENT RUN HISTORY</span>
            <button
              onClick={fetchRuns}
              disabled={isRefreshing}
              style={{
                background: 'transparent',
                border: '1px solid #334155',
                color: '#38bdf8',
                borderRadius: 4,
                padding: '2px 6px',
                fontSize: 11,
                cursor: isRefreshing ? 'wait' : 'pointer',
              }}
            >
              {isRefreshing ? '…' : '🔄 Refresh'}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}>
            {runs.map((r) => {
              const active = r.id === selectedRunId;

              return (
                <button
                  key={r.id}
                  onClick={() => {
                    setSelectedRunId(r.id);
                    setSelectedStepIdx(0);
                  }}
                  style={{
                    textAlign: 'left',
                    background: active ? '#1e293b' : '#090e1a',
                    border: `1.5px solid ${active ? '#38bdf8' : '#1e293b'}`,
                    borderRadius: 8,
                    padding: 10,
                    cursor: 'pointer',
                    color: '#f8fafc',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: active ? '#38bdf8' : '#f8fafc' }}>{r.triggerName.split('(')[0]}</span>
                    <span style={{ fontSize: 11, color: '#4ade80', fontWeight: 700 }}>✓ {r.status}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>
                    Run {r.id} · ⏱️ {r.duration}
                  </div>
                  <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>{r.startedAt}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Center: Step Execution Pipeline */}
        <div style={{ background: '#0f172a', borderRadius: 12, padding: 14, border: '1px solid #1e293b', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1e293b', paddingBottom: 8 }}>
            <div>
              <span style={{ fontSize: 13, color: '#94a3b8', fontWeight: 700 }}>STEP EXECUTION PIPELINE</span>
              <span style={{ fontSize: 12, color: '#64748b', marginLeft: 8 }}>Run {selectedRun.id}</span>
            </div>
            <span style={{ fontSize: 12, color: '#4ade80', background: '#052e16', padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>
              Total: {selectedRun.duration}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
            {selectedRun.steps.map((s, idx) => {
              const active = idx === selectedStepIdx;
              return (
                <button
                  key={s.num}
                  onClick={() => setSelectedStepIdx(idx)}
                  style={{
                    textAlign: 'left',
                    background: active ? '#1e293b' : '#090e1a',
                    border: `1.5px solid ${active ? s.color : '#1e293b'}`,
                    borderRadius: 10,
                    padding: 12,
                    cursor: 'pointer',
                    color: '#f8fafc',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    boxShadow: active ? `0 0 12px ${s.color}33` : 'none',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      background: s.color,
                      color: '#0f172a',
                      fontWeight: 800,
                      fontSize: 14,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {s.num}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#ffffff', marginBottom: 2 }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: s.color, fontWeight: 600 }}>{s.type}</div>
                  </div>

                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 12, color: '#4ade80', fontWeight: 700 }}>✓ {s.status}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>⏱️ {s.duration}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Selected Step Raw Payloads (Input / Output Inspection) */}
        <div style={{ background: '#0f172a', borderRadius: 12, padding: 14, border: '1px solid #1e293b', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ borderBottom: '1px solid #1e293b', paddingBottom: 8 }}>
            <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>STEP {selectedStep.num} TELEMETRY</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#ffffff' }}>{selectedStep.name}</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 11, color: '#38bdf8', fontWeight: 700, textTransform: 'uppercase' }}>Inputs</span>
            <pre
              style={{
                background: '#090e1a',
                border: '1px solid #1e293b',
                borderRadius: 8,
                padding: 10,
                fontSize: 11,
                color: '#94a3b8',
                overflowX: 'auto',
                margin: 0,
                maxHeight: 140,
              }}
            >
              {JSON.stringify(selectedStep.input, null, 2)}
            </pre>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
            <span style={{ fontSize: 11, color: '#4ade80', fontWeight: 700, textTransform: 'uppercase' }}>Outputs / Raw JSON</span>
            <pre
              style={{
                background: '#090e1a',
                border: '1px solid #1e293b',
                borderRadius: 8,
                padding: 10,
                fontSize: 11,
                color: '#cbd5e1',
                overflowX: 'auto',
                margin: 0,
                flex: 1,
                maxHeight: 180,
              }}
            >
              {JSON.stringify(selectedStep.output, null, 2)}
            </pre>
          </div>

          <button
            onClick={handleResubmit}
            style={{
              background: '#0066FF',
              color: '#fff',
              border: 'none',
              padding: '10px 14px',
              borderRadius: 8,
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <span>▶</span> Resubmit Flow Run with Payload
          </button>
        </div>
      </div>
    </Panel>
  );
}
