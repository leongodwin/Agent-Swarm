import { useState, useMemo, useEffect } from 'react';
import { Panel } from './Overlays';
import { useStore } from '../store';
import { api } from '../api';
import { generateHldContent, type HldResult } from '../../../shared/hld';

export function HldViewerModal({ repoId }: { repoId?: string }) {
  const repos = useStore((s) => s.repos);
  const repo = repos.find((r) => r.id === repoId) ?? repos[0];
  const pushToast = useStore((s) => s.pushToast);

  const [activeTab, setActiveTab] = useState<'topology' | 'erd' | 'sequence' | 'security' | 'alm' | 'raw'>('topology');
  const [tenantName, setTenantName] = useState<string>('Not configured');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    api.tenancy()
      .then((t) => {
        if (!active) return;
        if (t?.tenantDomain) setTenantName(t.tenantDomain);
        else if (t?.tenantName) setTenantName(t.tenantName);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const hldInput = useMemo(() => {
    return {
      solutionName: repo ? repo.fullName : 'Contoso Copilot Field Claims Accelerator',
      problemContext: repo
        ? repo.mission || 'Unified Power Apps & Copilot Studio solution automating field claims inspection and approval workflows.'
        : 'Automating multi-point inspection workflows via Copilot Studio, Power Automate, and Dataverse.',
      components: [
        {
          role: 'Copilot Studio Architect',
          title: 'Conversational Voice & Web Topic Orchestrator',
          badge: 'COPILOT STUDIO',
          details: 'Dispatches multi-turn inspection workflows, entity extraction, and generative fallback.',
          deliverables: ['Topics/FieldInspection.yaml', 'Azure OpenAI Safety Filter', 'Direct Line Channel'],
        },
        {
          role: 'Dataverse Data Modeler',
          title: 'Enterprise Relational Incident & WorkOrder Schema',
          badge: 'DATAVERSE',
          details: 'Core relational tables with column-level security on repair cost estimates.',
          deliverables: ['cr_incident.xml', 'cr_workorder.xml', 'Column Security Profiles'],
        },
        {
          role: 'Power Automate Specialist',
          title: 'Transactional Cloud Flow & Adaptive Approvals',
          badge: 'POWER AUTOMATE',
          details: 'High-throughput trigger flow dispatching Teams Adaptive Card v1.5 approvals.',
          deliverables: ['Workflows/DispatchWorkOrder.json', 'SAP ERP Webhook', 'Dead-Letter Alert Queue'],
        },
        {
          role: 'PCF Engineer',
          title: 'Fluent UI v9 Custom Photo & Geo-Tag Control',
          badge: 'PCF REACT V9',
          details: 'Embedded React canvas control for multi-photo capture and offline damage pin annotations.',
          deliverables: ['ControlManifest.Input.xml', 'DamagePinCanvas.tsx'],
        },
      ],
      tenantName,
    };
  }, [repo, tenantName]);

  const hldData: HldResult = useMemo(() => generateHldContent(hldInput), [hldInput]);
  const handleCopyMarkdown = async () => {
    try { await navigator.clipboard.writeText(hldData.markdownContent); } catch { pushToast('error', 'Could not copy HLD'); return; }
    pushToast('success', 'HLD Markdown copied to clipboard!');
  };

  const handleSaveToRepo = async () => {
    if (!repo || saving) return;
    setSaving(true);
    try {
      const result = await api.generateHld<HldResult>({ ...hldInput, repoId: repo.id });
      if (!result.savedFilePath) throw new Error('Server did not return a saved path');
      pushToast('success', `HLD saved to ${result.savedFilePath}`);
    } catch { /* API errors already appear as toasts. */ } finally { setSaving(false); }
  };

  return (
    <Panel
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>📐</span>
          <span>High-Level Design (HLD) Document · Principal Architect</span>
          <span style={{ fontSize: 11, background: '#7c3aed', color: '#fff', padding: '2px 8px', borderRadius: 6, fontWeight: 700 }}>
            {hldData.docId}
          </span>
          <span style={{ fontSize: 11, background: '#082f49', color: '#38bdf8', padding: '2px 8px', borderRadius: 6, fontWeight: 600 }}>
            TENANT: {tenantName}
          </span>
          <span style={{ fontSize: 11, background: '#052e16', color: '#4ade80', padding: '2px 8px', borderRadius: 6, fontWeight: 700 }}>
            ● Well-Architected Framework
          </span>
        </div>
      }
      wide
      accent="#7c3aed"
      className="hld-modal"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minHeight: 620 }}>
        {/* Header Ribbon & Action Bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0a0f1d', border: '1px solid #1e293b', borderRadius: 10, padding: '12px 16px' }}>
          <div>
            <div style={{ fontSize: 11, color: '#38bdf8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>System Architecture Blueprint</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginTop: 2 }}>{hldData.solutionName}</div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              onClick={handleCopyMarkdown}
              style={{ background: '#1e293b', color: '#fff', border: '1px solid #334155', padding: '7px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
            >
              📋 Copy Markdown
            </button>
            <button
              onClick={() => void handleSaveToRepo()} disabled={saving || !repo}
              style={{ background: '#0078D4', color: '#fff', border: 'none', padding: '7px 16px', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 700 }}
            >
              💾 Save to docs/architecture/HLD.md
            </button>
          </div>
        </div>

        {/* Tab Switcher */}
        <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid #1e293b', paddingBottom: 8 }}>
          {[
            { id: 'topology', label: '🌐 System Topology (C4)' },
            { id: 'erd', label: '🗄️ Dataverse Schema (ERD)' },
            { id: 'sequence', label: '⚡ Interaction Sequence' },
            { id: 'security', label: '🛡️ Security & DLP Boundary' },
            { id: 'alm', label: '🚀 ALM & Release Pipeline' },
            { id: 'raw', label: '📝 Full HLD Document' },
          ].map((t) => {
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id as any)}
                style={{
                  background: active ? '#1e293b' : 'transparent',
                  color: active ? '#c084fc' : '#94a3b8',
                  border: `1px solid ${active ? '#c084fc' : 'transparent'}`,
                  padding: '6px 14px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Tab Content Display */}
        <div style={{ background: '#0a0f1d', border: '1px solid #1e293b', borderRadius: 12, padding: 18, flex: 1, overflowY: 'auto' }}>
          {activeTab === 'topology' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h4 style={{ margin: 0, color: '#ffffff', fontSize: 15 }}>5-Tier Cloud Architecture Topology</h4>
                <span style={{ fontSize: 11, color: '#38bdf8', background: '#082f49', padding: '2px 8px', borderRadius: 4 }}>Mermaid C4 Architecture</span>
              </div>
              <div style={{ background: '#060a14', border: '1px solid #1e293b', borderRadius: 8, padding: 16 }}>
                <pre style={{ margin: 0, fontSize: 12, color: '#a5f3fc', fontFamily: 'Consolas, monospace', lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>
                  {hldData.mermaidDiagrams.topology}
                </pre>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginTop: 8 }}>
                <div style={{ background: '#0f172a', padding: 10, borderRadius: 8, border: '1px solid #1e293b' }}>
                  <div style={{ fontSize: 11, color: '#38bdf8', fontWeight: 700 }}>1. CHANNELS</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>Teams, Mobile App & Power Pages Webchat</div>
                </div>
                <div style={{ background: '#0f172a', padding: 10, borderRadius: 8, border: '1px solid #1e293b' }}>
                  <div style={{ fontSize: 11, color: '#c084fc', fontWeight: 700 }}>2. COPILOT STUDIO</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>Autonomous dialog topics & Azure OpenAI guardrails</div>
                </div>
                <div style={{ background: '#0f172a', padding: 10, borderRadius: 8, border: '1px solid #1e293b' }}>
                  <div style={{ fontSize: 11, color: '#4ade80', fontWeight: 700 }}>3. AUTOMATION</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>Power Automate cloud flows & Adaptive Cards</div>
                </div>
                <div style={{ background: '#0f172a', padding: 10, borderRadius: 8, border: '1px solid #1e293b' }}>
                  <div style={{ fontSize: 11, color: '#f43f5e', fontWeight: 700 }}>4. DATAVERSE</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>Relational schema with Column-Level Security</div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'erd' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h4 style={{ margin: 0, color: '#ffffff', fontSize: 15 }}>Microsoft Dataverse Relational Entity Schema (ERD)</h4>
                <span style={{ fontSize: 11, color: '#c084fc', background: '#2e1065', padding: '2px 8px', borderRadius: 4 }}>Dataverse Web API v9.2</span>
              </div>
              <div style={{ background: '#060a14', border: '1px solid #1e293b', borderRadius: 8, padding: 16 }}>
                <pre style={{ margin: 0, fontSize: 12, color: '#f5d0fe', fontFamily: 'Consolas, monospace', lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>
                  {hldData.mermaidDiagrams.erd}
                </pre>
              </div>
              <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.5 }}>
                • <strong>cr_incident</strong>: Core case entity capturing severity, status, and sentiment analysis.<br />
                • <strong>cr_workorder</strong>: Child execution record managing assigned technician, repair budget signoff, and supervisor approval state.<br />
                • <strong>cr_agent_audit</strong>: High-frequency telemetry stored in Dataverse Elastic Tables for audit compliance without transactional friction.
              </div>
            </div>
          )}

          {activeTab === 'sequence' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h4 style={{ margin: 0, color: '#ffffff', fontSize: 15 }}>End-to-End Orchestration Sequence</h4>
                <span style={{ fontSize: 11, color: '#4ade80', background: '#052e16', padding: '2px 8px', borderRadius: 4 }}>Zero-Trust Flow</span>
              </div>
              <div style={{ background: '#060a14', border: '1px solid #1e293b', borderRadius: 8, padding: 16 }}>
                <pre style={{ margin: 0, fontSize: 12, color: '#bbf7d0', fontFamily: 'Consolas, monospace', lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>
                  {hldData.mermaidDiagrams.sequence}
                </pre>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <h4 style={{ margin: 0, color: '#ffffff', fontSize: 15 }}>Security Architecture & Data Loss Prevention (DLP)</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 14 }}>
                  <div style={{ fontSize: 12, color: '#38bdf8', fontWeight: 700, marginBottom: 6 }}>🛡️ Microsoft Entra ID Integration</div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
                    <li>Single Sign-On (SSO) with OAuth 2.0 On-Behalf-Of (OBO) flow for Microsoft Teams users.</li>
                    <li>Application User in Dataverse with custom least-privilege security roles.</li>
                    <li>Conditional Access (CA) enforcement with compliant managed device requirement.</li>
                  </ul>
                </div>
                <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 14 }}>
                  <div style={{ fontSize: 12, color: '#4ade80', fontWeight: 700, marginBottom: 6 }}>🔒 Power Platform DLP Boundary</div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
                    <li><strong>Business Tier Connectors:</strong> Dataverse, Office 365 Users, Teams Approvals, SharePoint.</li>
                    <li><strong>Blocked Connectors:</strong> Twitter/X, Dropbox, Google Drive, generic untrusted HTTP endpoints.</li>
                    <li>Automated DLP verification in GitHub pull request merge gate.</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'alm' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <h4 style={{ margin: 0, color: '#ffffff', fontSize: 15 }}>ALM & Multi-Environment Promotion Strategy</h4>
              <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 14 }}>
                <div style={{ fontSize: 13, color: '#fff', fontWeight: 600, marginBottom: 8 }}>ALM Lifecycle Stages</div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 12, color: '#94a3b8' }}>
                  <span style={{ background: '#1e293b', padding: '6px 12px', borderRadius: 6, color: '#38bdf8' }}>1. Developer Desk (Git Worktree)</span>
                  <span>➔</span>
                  <span style={{ background: '#1e293b', padding: '6px 12px', borderRadius: 6, color: '#c084fc' }}>2. PAC CLI Unpack (/src)</span>
                  <span>➔</span>
                  <span style={{ background: '#1e293b', padding: '6px 12px', borderRadius: 6, color: '#fbbf24' }}>3. PR Quality Gate (pac check)</span>
                  <span>➔</span>
                  <span style={{ background: '#1e293b', padding: '6px 12px', borderRadius: 6, color: '#4ade80' }}>4. Test Deploy & 3D Manager Signoff</span>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'raw' && (
            <pre style={{ margin: 0, fontSize: 11, color: '#94a3b8', fontFamily: 'Consolas, monospace', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
              {hldData.markdownContent}
            </pre>
          )}
        </div>
      </div>
    </Panel>
  );
}
