import { useState, useEffect } from 'react';
import { Panel } from './Overlays';
import { useStore } from '../store';
import { api } from '../api';
import { INITIAL_FLOW_RUNS, type FlowRun } from '../../../shared/flowTelemetry';

const DEMO_RUNS = INITIAL_FLOW_RUNS;

export function FlowRunHistoryView({ repoId }: { repoId?: string }) {
  const [runs, setRuns] = useState<FlowRun[]>(INITIAL_FLOW_RUNS);
  const [selectedRunId, setSelectedRunId] = useState<string>(INITIAL_FLOW_RUNS[0].id);
  const [selectedStepIdx, setSelectedStepIdx] = useState<number>(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const repos = useStore((s) => s.repos);
  const pushToast = useStore((s) => s.pushToast);
  const repo = repos.find((r) => r.id === repoId) ?? repos[0];

  const fetchRuns = () => {
    if (!repo?.id) return;
    setIsRefreshing(true);
    api.flowRuns(repo.id)
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setRuns(data);
          if (!data.some((r) => r.id === selectedRunId)) {
            setSelectedRunId(data[0].id);
          }
        }
      })
      .catch(() => {})
      .finally(() => setIsRefreshing(false));
  };

  useEffect(() => {
    fetchRuns();
  }, [repo?.id]);

  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? runs[0] ?? DEMO_RUNS[0];
  const selectedStep = selectedRun?.steps?.[selectedStepIdx] ?? selectedRun?.steps?.[0] ?? {
    num: 1, name: 'Default Step', type: 'Action', duration: '0 ms', status: '200 OK', color: '#38bdf8', input: {}, output: {}
  };

  const handleResubmit = async () => {
    try {
      const res = await api.resubmitFlowRun(repo?.id || 'demo', selectedRun.id);
      if (res?.resubmitted) {
        setRuns((prev) => [res.resubmitted, ...prev]);
        setSelectedRunId(res.resubmitted.id);
        setSelectedStepIdx(0);
        pushToast('success', `⚡ Resubmitted flow ${selectedRun.flowId} successfully (ID: ${res.resubmitted.id})`);
      }
    } catch {
      pushToast('error', 'Failed to resubmit flow run');
    }
  };

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
