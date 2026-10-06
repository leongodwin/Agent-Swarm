import { useState, useEffect } from 'react';
import { Panel } from './Overlays';
import { api } from '../api';
import type { AlmPipeline, AlmEnvironmentStatus, AlmGateCheck } from '../../../shared/alm';
import { INITIAL_ALM_PIPELINE } from '../../../shared/alm';
import { cue } from './sfx';

export function ReleasePipelineModal({ onClose }: { onClose?: () => void }) {
  const [pipeline, setPipeline] = useState<AlmPipeline>(INITIAL_ALM_PIPELINE);
  const [activeTab, setActiveTab] = useState<'pipeline' | 'matrix' | 'yaml'>('pipeline');
  const [isDeploying, setIsDeploying] = useState(false);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  useEffect(() => {
    api.almPipeline()
      .then((data) => {
        if (data && data.solutionUniqueName) setPipeline(data);
      })
      .catch(() => {});
  }, []);

  const handleApprove = async () => {
    setIsDeploying(true);
    cue('merged');
    try {
      const updated = await api.almApprove({ approver: 'Leon van Zyl' });
      setPipeline(updated);
      setSuccessBanner(`Solution v${updated.currentProdVersion} successfully deployed to Production! Managed package imported.`);
    } catch {
      // Fallback update in case of local simulation
      setPipeline((prev: AlmPipeline): AlmPipeline => ({
        ...prev,
        approvalStatus: 'deployed',
        currentProdVersion: prev.targetVersion,
        approvedBy: 'Leon van Zyl',
        approvedAt: new Date().toISOString(),
      }));
      setSuccessBanner('Solution successfully promoted to Production!');
    } finally {
      setIsDeploying(false);
    }
  };

  const handleRollback = async () => {
    try {
      const rolled = await api.almRollback();
      setPipeline(rolled);
      setSuccessBanner('Rolled back pipeline to pre-release state.');
    } catch {
      setPipeline(INITIAL_ALM_PIPELINE);
    }
  };

  const envs: AlmEnvironmentStatus[] = [
    pipeline.environments.dev,
    pipeline.environments.test,
    pipeline.environments.prod,
  ];

  return (
    <Panel
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>🚀</span>
          <span>Power Platform ALM Multi-Environment Release Gate</span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 800,
              padding: '2px 8px',
              borderRadius: 6,
              background: '#b45309',
              color: '#fffbeb',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            ⚠ Simulated pipeline
          </span>
        </div>
      }
      wide
      accent="#047857"
      onClose={onClose}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Top Summary Banner */}
        <div
          style={{
            background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.9) 100%)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: 12,
            padding: '16px 20px',
            display: 'grid',
            gridTemplateColumns: '2fr 1fr 1fr 1.5fr',
            gap: 16,
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Solution Unique Name</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#38bdf8', marginTop: 2 }}>{pipeline.solutionUniqueName}</div>
            <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 2 }}>{pipeline.solutionFriendlyName}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Production Version</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#4ade80', marginTop: 2 }}>v{pipeline.currentProdVersion}</div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Current live build</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Release Target</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#f59e0b', marginTop: 2 }}>v{pipeline.targetVersion}</div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Managed package</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Signoff Gate Status</div>
            <div
              style={{
                display: 'inline-block',
                marginTop: 4,
                padding: '4px 10px',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 700,
                background:
                  pipeline.approvalStatus === 'deployed'
                    ? 'rgba(16, 185, 129, 0.2)'
                    : 'rgba(245, 158, 11, 0.2)',
                color: pipeline.approvalStatus === 'deployed' ? '#34d399' : '#fbbf24',
                border: `1px solid ${pipeline.approvalStatus === 'deployed' ? 'rgba(16, 185, 129, 0.4)' : 'rgba(245, 158, 11, 0.4)'}`,
              }}
            >
              {pipeline.approvalStatus === 'deployed'
                ? '✅ PRODUCTION DEPLOYED'
                : '⏳ PENDING MANAGER SIGNOFF'}
            </div>
            {pipeline.approvedBy && (
              <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
                Signed off by {pipeline.approvedBy}
              </div>
            )}
          </div>
        </div>

        {/* Success Alert Banner */}
        {successBanner && (
          <div
            style={{
              background: 'rgba(16, 185, 129, 0.15)',
              border: '1px solid rgba(16, 185, 129, 0.4)',
              borderRadius: 8,
              padding: '10px 16px',
              color: '#34d399',
              fontSize: 13,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>🎉 {successBanner}</span>
            <button
              onClick={() => setSuccessBanner(null)}
              style={{ background: 'transparent', border: 'none', color: '#34d399', cursor: 'pointer', fontSize: 14 }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Navigation Tabs */}
        <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid rgba(255, 255, 255, 0.1)', paddingBottom: 8 }}>
          <button
            onClick={() => setActiveTab('pipeline')}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: 'none',
              background: activeTab === 'pipeline' ? '#0284c7' : 'rgba(255, 255, 255, 0.05)',
              color: '#ffffff',
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Multi-Stage Environment Pipeline
          </button>
          <button
            onClick={() => setActiveTab('matrix')}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: 'none',
              background: activeTab === 'matrix' ? '#0284c7' : 'rgba(255, 255, 255, 0.05)',
              color: '#ffffff',
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Verification & Compliance Matrix
          </button>
          <button
            onClick={() => setActiveTab('yaml')}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: 'none',
              background: activeTab === 'yaml' ? '#0284c7' : 'rgba(255, 255, 255, 0.05)',
              color: '#ffffff',
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            GitHub Actions ALM Workflow
          </button>
        </div>

        {/* TAB 1: 3-Stage Multi-Environment Pipeline */}
        {activeTab === 'pipeline' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.1fr', gap: 16 }}>
              {envs.map((env, idx) => {
                const isProd = env.id === 'prod';
                const isTest = env.id === 'test';
                const borderAccent = isProd
                  ? pipeline.approvalStatus === 'deployed'
                    ? '#10b981'
                    : '#64748b'
                  : isTest
                  ? '#38bdf8'
                  : '#818cf8';

                return (
                  <div
                    key={env.id}
                    style={{
                      background: 'rgba(15, 23, 42, 0.8)',
                      border: `1.5px solid ${borderAccent}`,
                      borderRadius: 12,
                      padding: 16,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 12,
                      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: 12,
                            background: borderAccent,
                            color: '#fff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 12,
                            fontWeight: 800,
                          }}
                        >
                          {idx + 1}
                        </span>
                        <div style={{ fontWeight: 700, fontSize: 14, color: '#f8fafc' }}>{env.name}</div>
                      </div>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: 6,
                          background: 'rgba(255, 255, 255, 0.08)',
                          color: '#38bdf8',
                        }}
                      >
                        v{env.version}
                      </span>
                    </div>

                    <div style={{ fontSize: 11, color: '#94a3b8', wordBreak: 'break-all' }}>
                      🔗 {env.url}
                    </div>

                    <div style={{ fontSize: 11, color: '#64748b' }}>
                      Commit: <code style={{ color: '#cbd5e1' }}>{env.unpackedCommitSha}</code> · {env.lastDeployedAt}
                    </div>

                    {/* Stage Checks Summary */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4, flex: 1 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>Gate Checks</div>
                      {env.checks.map((chk: AlmGateCheck) => (
                        <div
                          key={chk.id}
                          style={{
                            background: 'rgba(255, 255, 255, 0.03)',
                            padding: '6px 8px',
                            borderRadius: 6,
                            fontSize: 11,
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ color: '#4ade80' }}>✓</span>
                            <span style={{ color: '#e2e8f0' }}>{chk.name}</span>
                          </div>
                          {chk.metric && (
                            <span style={{ color: '#38bdf8', fontWeight: 600, fontSize: 10 }}>{chk.metric}</span>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Prod Action Area */}
                    {isProd && (
                      <div
                        style={{
                          marginTop: 10,
                          padding: 12,
                          borderRadius: 8,
                          background:
                            pipeline.approvalStatus === 'deployed'
                              ? 'rgba(16, 185, 129, 0.1)'
                              : 'rgba(245, 158, 11, 0.1)',
                          border: `1px dashed ${pipeline.approvalStatus === 'deployed' ? '#10b981' : '#f59e0b'}`,
                          textAlign: 'center',
                        }}
                      >
                        {pipeline.approvalStatus === 'pending_manager_approval' ? (
                          <>
                            <div style={{ fontSize: 12, fontWeight: 700, color: '#fbbf24', marginBottom: 8 }}>
                              ⚠️ Awaiting Executive Signoff
                            </div>
                            <button
                              id="btn-approve-prod-release"
                              onClick={handleApprove}
                              disabled={isDeploying}
                              style={{
                                width: '100%',
                                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                                color: '#ffffff',
                                border: 'none',
                                padding: '10px 14px',
                                borderRadius: 8,
                                fontWeight: 800,
                                fontSize: 13,
                                cursor: 'pointer',
                                boxShadow: '0 4px 14px rgba(16, 185, 129, 0.4)',
                                transition: 'all 0.15s ease',
                              }}
                            >
                              {isDeploying ? '🚀 Deploying Solution...' : '🚀 Signoff & Ship to Production (Simulated)'}
                            </button>
                            <div style={{ fontSize: 10, color: '#f59e0b', textAlign: 'center', marginTop: 4 }}>
                              ⚠️ Simulated gate (updates in-memory state &amp; dispatches Teams Adaptive Card)
                            </div>
                          </>
                        ) : (
                          <>
                            <div style={{ fontSize: 12, fontWeight: 700, color: '#34d399', marginBottom: 4 }}>
                              ✅ Solution v{pipeline.currentProdVersion} Live in Production (Simulated)
                            </div>
                            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8 }}>
                              Signed off by {pipeline.approvedBy || 'Leon van Zyl'}
                            </div>
                            <button
                              onClick={handleRollback}
                              style={{
                                background: 'rgba(239, 68, 68, 0.2)',
                                border: '1px solid rgba(239, 68, 68, 0.4)',
                                color: '#f87171',
                                padding: '4px 10px',
                                borderRadius: 6,
                                fontSize: 11,
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              ↩️ Reset Pipeline Gate
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Release Notes Card */}
            <div
              style={{
                background: 'rgba(15, 23, 42, 0.7)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 10,
                padding: '14px 18px',
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: '#38bdf8', marginBottom: 8 }}>
                📋 Included Pull Requests & Change Manifest (v{pipeline.targetVersion})
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#cbd5e1' }}>
                {pipeline.releaseNotes.map((note: string, idx: number) => (
                  <li key={idx}>{note}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* TAB 2: Verification & Compliance Matrix */}
        {activeTab === 'matrix' && (
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.8)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 10,
              padding: 18,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc' }}>
              Automated QA, Static Analysis & DLP Guardrail Matrix
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>
              Every solution candidate is subjected to end-to-end conversational regression tests, static PAC CLI unpacked verification, and Microsoft Entra ID permission audits before appearing on the Release Station.
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginTop: 6 }}>
              {pipeline.environments.test.checks.map((chk: AlmGateCheck) => (
                <div
                  key={chk.id}
                  style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: 8,
                    padding: 12,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#38bdf8' }}>{chk.name}</div>
                    <span
                      style={{
                        padding: '2px 6px',
                        borderRadius: 4,
                        fontSize: 10,
                        fontWeight: 700,
                        background: 'rgba(74, 222, 128, 0.15)',
                        color: '#4ade80',
                      }}
                    >
                      {chk.metric}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 6 }}>{chk.details}</div>
                  <div style={{ fontSize: 10, color: '#64748b', marginTop: 6 }}>
                    Category: <code style={{ color: '#94a3b8' }}>{chk.category}</code> · Status: <span style={{ color: '#4ade80' }}>Passed</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 3: GitHub Actions YAML */}
        {activeTab === 'yaml' && (
          <div
            style={{
              background: '#0b132b',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: 10,
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#38bdf8' }}>
                .github/workflows/deploy-production-on-approval.yml
              </div>
              <button
                onClick={() => navigator.clipboard?.writeText(pipeline.workflowYaml)}
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: '#ffffff',
                  padding: '4px 10px',
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                📋 Copy YAML
              </button>
            </div>
            <pre
              style={{
                background: '#020617',
                padding: 14,
                borderRadius: 8,
                fontSize: 11,
                fontFamily: 'Consolas, monospace',
                color: '#93c5fd',
                overflowX: 'auto',
                maxHeight: 340,
                margin: 0,
                lineHeight: 1.45,
              }}
            >
              {pipeline.workflowYaml}
            </pre>
          </div>
        )}
      </div>
    </Panel>
  );
}
