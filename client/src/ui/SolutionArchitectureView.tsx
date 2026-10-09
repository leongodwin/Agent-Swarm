import { useState } from 'react';
import { useResource } from '../useResource';
import { Panel } from './Overlays';
import { useStore } from '../store';
import { api } from '../api';
import type { SolutionComponentNode } from '../../../shared/solutionTypes';

export type { SolutionComponentNode };

export function SolutionArchitectureView({ repoId }: { repoId?: string }) {
  const [selectedId, setSelectedId] = useState('');
  const repos = useStore((s) => s.repos);
  const repo = repoId ? repos.find((r) => r.id === repoId) : repos[0];
  const resource = useResource(repo?.id ?? '', () => repo ? api.solutionArchitecture(repo.id) : Promise.resolve({ solutionName: 'No repository', totalComponents: 0, components: {}, isUnpacked: false, simulated: false }));
  const nodes = resource.value?.components ?? {};
  const isUnpacked = Boolean(resource.value?.isUnpacked);
  const simulated = Boolean(resource.value?.simulated);
  const selectedNode = nodes[selectedId] ?? Object.values(nodes)[0];
  if (!selectedNode) return <Panel title="Solution architecture" wide><p>{resource.loading ? 'Loading architecture…' : resource.error || 'No supported solution artifacts found in this repository.'}</p></Panel>;

  const tier1 = Object.values(nodes).filter((n) => n.category.includes('1.') || n.category.toLowerCase().includes('channel') || n.category.toLowerCase().includes('engagement'));
  const tier2 = Object.values(nodes).filter((n) => n.category.includes('2.') || n.category.toLowerCase().includes('copilot'));
  const tier3 = Object.values(nodes).filter((n) => n.category.includes('3.') || n.category.toLowerCase().includes('automate') || n.category.toLowerCase().includes('logic') || n.category.toLowerCase().includes('flow'));
  const tier4 = Object.values(nodes).filter((n) => n.category.includes('4.') || n.category.toLowerCase().includes('dataverse') || n.category.toLowerCase().includes('storage') || n.category.toLowerCase().includes('data'));

  return (
    <Panel
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>🏛️</span>
          <span>Power Platform & Copilot Studio Solution Architecture</span>
          <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 999, background: '#0078D4', color: '#fff', fontWeight: 600 }}>
            REPOSITORY ARTIFACTS
          </span>
        </div>
      }
      wide
      accent="#774AE0"
      className="solution-arch-modal"
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20, minHeight: 560 }}>
        {/* Main Interactive Diagram Grid */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: '#0f172a', padding: '12px 18px', borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #1e293b' }}>
            <span style={{ color: '#94a3b8', fontSize: 13, fontWeight: 500 }}>
              Showing solution components for <strong>{repo ? repo.fullName : 'No repository'}</strong>
            </span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {isUnpacked ? (
                <span style={{ fontSize: 11, color: '#34d399', background: '#064e3b', border: '1px solid #059669', padding: '3px 8px', borderRadius: 6, fontWeight: 700, letterSpacing: '0.04em' }}>
                  ● REPO UNPACKED SOLUTION
                </span>
              ) : (
                <span style={{ fontSize: 11, color: '#f59e0b', background: '#451a03', border: '1px solid #b45309', padding: '3px 8px', borderRadius: 6, fontWeight: 700, letterSpacing: '0.04em' }}>
                  {simulated ? '⚠️ SIMULATED ARCHITECTURE' : 'No unpacked solution detected'}
                </span>
              )}
              <span style={{ fontSize: 12, color: '#38bdf8', background: '#082f49', padding: '3px 8px', borderRadius: 6 }}>Local artifact scan</span>
              <span style={{ fontSize: 12, color: '#4ade80', background: '#052e16', padding: '3px 8px', borderRadius: 6 }}>
                ● Dataverse Solution: {isUnpacked ? 'Unpacked Repo' : 'Unmanaged'}
              </span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, flex: 1 }}>
            {/* Tier 1: Channels */}
            <div style={{ background: '#0a0f1d', borderRadius: 12, padding: 12, border: '1px solid #1e293b', display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 480, overflowY: 'auto' }}>
              <div style={{ color: '#38bdf8', fontSize: 12, fontWeight: 700, borderBottom: '1px solid #1e293b', paddingBottom: 6 }}>1. ENGAGEMENT</div>
              {tier1.map((n) => {
                const active = selectedId === n.id;
                return (
                  <button
                    key={n.id}
                    onClick={() => setSelectedId(n.id)}
                    style={{
                      textAlign: 'left',
                      background: active ? '#1e293b' : '#0f172a',
                      border: `1.5px solid ${active ? '#38bdf8' : '#1e293b'}`,
                      borderRadius: 8,
                      padding: 10,
                      cursor: 'pointer',
                      color: '#f8fafc',
                      transition: 'all 0.15s ease',
                      boxShadow: active ? '0 0 12px rgba(56, 189, 248, 0.25)' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.name}</span>
                        <span style={{ fontSize: 9, background: n.badgeBg, color: '#fff', padding: '2px 6px', borderRadius: 4, fontWeight: 700, whiteSpace: 'nowrap' }}>{n.badge}</span>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.3 }}>{n.summary.slice(0, 50)}…</div>
                  </button>
                );
              })}
            </div>

            {/* Tier 2: Copilot Studio Core */}
            <div style={{ background: '#0a0f1d', borderRadius: 12, padding: 12, border: '1px solid #1e293b', display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 480, overflowY: 'auto' }}>
              <div style={{ color: '#c084fc', fontSize: 12, fontWeight: 700, borderBottom: '1px solid #1e293b', paddingBottom: 6 }}>2. COPILOT STUDIO</div>
              {tier2.map((n) => {
                const active = selectedId === n.id;
                return (
                  <button
                    key={n.id}
                    onClick={() => setSelectedId(n.id)}
                    style={{
                      textAlign: 'left',
                      background: active ? '#1e293b' : '#0f172a',
                      border: `1.5px solid ${active ? '#c084fc' : '#1e293b'}`,
                      borderRadius: 8,
                      padding: 10,
                      cursor: 'pointer',
                      color: '#f8fafc',
                      transition: 'all 0.15s ease',
                      boxShadow: active ? '0 0 12px rgba(192, 132, 252, 0.25)' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.name}</span>
                        <span style={{ fontSize: 9, background: n.badgeBg, color: '#fff', padding: '2px 6px', borderRadius: 4, fontWeight: 700, whiteSpace: 'nowrap' }}>{n.badge}</span>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.3 }}>{n.summary.slice(0, 50)}…</div>
                  </button>
                );
              })}
            </div>

            {/* Tier 3: Power Automate */}
            <div style={{ background: '#0a0f1d', borderRadius: 12, padding: 12, border: '1px solid #1e293b', display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 480, overflowY: 'auto' }}>
              <div style={{ color: '#60a5fa', fontSize: 12, fontWeight: 700, borderBottom: '1px solid #1e293b', paddingBottom: 6 }}>3. POWER AUTOMATE</div>
              {tier3.map((n) => {
                const active = selectedId === n.id;
                return (
                  <button
                    key={n.id}
                    onClick={() => setSelectedId(n.id)}
                    style={{
                      textAlign: 'left',
                      background: active ? '#1e293b' : '#0f172a',
                      border: `1.5px solid ${active ? '#60a5fa' : '#1e293b'}`,
                      borderRadius: 8,
                      padding: 10,
                      cursor: 'pointer',
                      color: '#f8fafc',
                      transition: 'all 0.15s ease',
                      boxShadow: active ? '0 0 12px rgba(96, 165, 250, 0.25)' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.name}</span>
                        <span style={{ fontSize: 9, background: n.badgeBg, color: '#fff', padding: '2px 6px', borderRadius: 4, fontWeight: 700, whiteSpace: 'nowrap' }}>{n.badge}</span>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.3 }}>{n.summary.slice(0, 50)}…</div>
                  </button>
                );
              })}
            </div>

            {/* Tier 4: Dataverse & Enterprise Data */}
            <div style={{ background: '#0a0f1d', borderRadius: 12, padding: 12, border: '1px solid #1e293b', display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 480, overflowY: 'auto' }}>
              <div style={{ color: '#f472b6', fontSize: 12, fontWeight: 700, borderBottom: '1px solid #1e293b', paddingBottom: 6 }}>4. DATAVERSE & DATA</div>
              {tier4.map((n) => {
                const active = selectedId === n.id;
                return (
                  <button
                    key={n.id}
                    onClick={() => setSelectedId(n.id)}
                    style={{
                      textAlign: 'left',
                      background: active ? '#1e293b' : '#0f172a',
                      border: `1.5px solid ${active ? '#f472b6' : '#1e293b'}`,
                      borderRadius: 8,
                      padding: 10,
                      cursor: 'pointer',
                      color: '#f8fafc',
                      transition: 'all 0.15s ease',
                      boxShadow: active ? '0 0 12px rgba(244, 114, 182, 0.25)' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.name}</span>
                        <span style={{ fontSize: 9, background: n.badgeBg, color: '#fff', padding: '2px 6px', borderRadius: 4, fontWeight: 700, whiteSpace: 'nowrap' }}>{n.badge}</span>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.3 }}>{n.summary.slice(0, 50)}…</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Selected Component Inspection Drawer */}
        <div style={{ background: '#0f172a', borderRadius: 14, padding: 18, border: '1px solid #1e293b', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{selectedNode.category}</span>
            <span style={{ fontSize: 10, background: selectedNode.badgeBg, color: '#fff', padding: '2px 8px', borderRadius: 6, fontWeight: 700 }}>{selectedNode.badge}</span>
          </div>

          <div>
            <h3 style={{ margin: '0 0 6px 0', fontSize: 18, color: '#f8fafc' }}>{selectedNode.name}</h3>
            <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', lineHeight: 1.4 }}>{selectedNode.summary}</p>
          </div>

          {selectedNode.sourceFile && (
            <div style={{ background: '#064e3b', border: '1px solid #059669', borderRadius: 8, padding: '8px 12px' }}>
              <div style={{ fontSize: 10, color: '#34d399', fontWeight: 700, textTransform: 'uppercase' }}>Source File in Repository</div>
              <div style={{ fontSize: 11, color: '#a7f3d0', fontFamily: 'monospace', wordBreak: 'break-all', marginTop: 2 }}>
                📄 {selectedNode.sourceFile}
              </div>
            </div>
          )}

          <div style={{ background: '#1e293b', borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 11, color: '#38bdf8', fontWeight: 700, marginBottom: 8, textTransform: 'uppercase' }}>Telemetry (unavailable for local scans)</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, textAlign: 'center' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc' }}>{selectedNode.telemetry.invocations}</div>
                <div style={{ fontSize: 10, color: '#94a3b8' }}>Load</div>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#facc15' }}>{selectedNode.telemetry.avgLatency}</div>
                <div style={{ fontSize: 10, color: '#94a3b8' }}>Latency</div>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#4ade80' }}>{selectedNode.telemetry.successRate}</div>
                <div style={{ fontSize: 10, color: '#94a3b8' }}>Health</div>
              </div>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, color: '#c084fc', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase' }}>Tech Stack & Protocols</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {selectedNode.techStack.map((tech: string) => (
                <span key={tech} style={{ fontSize: 11, background: '#1e293b', color: '#e2e8f0', padding: '3px 8px', borderRadius: 6, border: '1px solid #334155' }}>
                  {tech}
                </span>
              ))}
            </div>
          </div>

          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: '#cbd5e1', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase' }}>Architectural Function</div>
            <p style={{ margin: 0, fontSize: 12, color: '#94a3b8', lineHeight: 1.45, background: '#111827', padding: 10, borderRadius: 8, border: '1px solid #1f2937' }}>
              {selectedNode.details}
            </p>
          </div>

          <button
            onClick={() => alert(`Triggered simulated PAC CLI solution sync for component: ${selectedNode.name}`)}
            style={{
              background: '#0078D4',
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
            <span>⚡</span> Preview simulated component sync
          </button>
        </div>
      </div>
    </Panel>
  );
}

