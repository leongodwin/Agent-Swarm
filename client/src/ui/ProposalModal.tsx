import { useState, useMemo } from 'react';
import { Panel } from './Overlays';
import { useStore } from '../store';
import {
  generateProposal,
  type ProposalInput,
  type ProposalResult,
  type LicenseCostItem,
  type SprintItem,
} from '../../../shared/proposals';

export function ProposalModal({ ideaId: _ideaId }: { ideaId?: string }) {
  const pushToast = useStore((s) => s.pushToast);
  const openOverlay = useStore((s) => s.openOverlay);
  const companyName = useStore((s) => s.settings.companyName);

  // Input states
  const [clientName, setClientName] = useState(companyName || 'Grasp AI');
  const [title, setTitle] = useState(`${companyName || 'Enterprise'} Copilot Swarm & Power Platform Modernization`);
  const [industry] = useState('Technology & Professional Services');
  const [problemStatement, setProblemStatement] = useState(
    'Disparate back-office systems and manual cross-department handoffs create approval bottlenecks. Autonomous Copilot Studio agents with Power Automate cloud flows and Dataverse governance accelerate turnaround and eliminate manual reconciliation.'
  );
  const [userCount, setUserCount] = useState<number>(450);
  const [monthlyTransactions, setMonthlyTransactions] = useState<number>(35000);
  const [complianceTier, setComplianceTier] = useState<'standard' | 'hipaa' | 'financial'>('standard');
  const [selectedChannels] = useState<string[]>(['Microsoft Teams', 'Power Pages Webchat', 'Custom PCF Mobile']);
  const [selectedIntegrations, setSelectedIntegrations] = useState<string[]>(['Dataverse', 'SAP ERP', 'Azure Blob Storage']);

  const [activeTab, setActiveTab] = useState<'overview' | 'licensing' | 'roadmap' | 'markdown'>('overview');
  const [isGenerating, setIsGenerating] = useState(false);

  // Current proposal data
  const proposalInput: ProposalInput = useMemo(
    () => ({
      title,
      clientName,
      industry,
      problemStatement,
      userCount,
      monthlyTransactions,
      complianceTier,
      targetChannels: selectedChannels,
      integrationPoints: selectedIntegrations,
    }),
    [title, clientName, industry, problemStatement, userCount, monthlyTransactions, complianceTier, selectedChannels, selectedIntegrations]
  );

  const [proposal, setProposal] = useState<ProposalResult>(() => generateProposal(proposalInput));

  const handleRegenerate = () => {
    setIsGenerating(true);
    setTimeout(() => {
      const res = generateProposal(proposalInput);
      setProposal(res);
      setIsGenerating(false);
      pushToast('success', 'Commercial proposal & licensing BOM recomputed!');
    }, 300);
  };

  const handleCopyMarkdown = () => {
    navigator.clipboard.writeText(proposal.markdownContent);
    pushToast('success', 'Full proposal Markdown copied to clipboard!');
  };

  const handleDownload = () => {
    const blob = new Blob([proposal.markdownContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Proposal_${proposal.proposalId}.md`;
    a.click();
    URL.revokeObjectURL(url);
    pushToast('success', `Proposal_${proposal.proposalId}.md downloaded!`);
  };

  const handleOpenHld = () => {
    openOverlay({ kind: 'hld' });
    pushToast('info', 'Opening High-Level Design (HLD) Document Studio…');
  };

  return (
    <Panel
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>💼</span>
          <span>Proposal Generator & Pre-Sales Solution Consultant</span>
          <span style={{ fontSize: 11, background: '#0284c7', color: '#fff', padding: '2px 8px', borderRadius: 6, fontWeight: 700 }}>
            {proposal.proposalId}
          </span>
          <span style={{ fontSize: 11, background: '#052e16', color: '#4ade80', border: '1px solid #166534', padding: '2px 8px', borderRadius: 6, fontWeight: 700 }}>
            ● Well-Architected SOW
          </span>
        </div>
      }
      wide
      accent="#0284c7"
      className="proposal-modal"
    >
      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 18, minHeight: 620 }}>
        {/* Left Column: Parameter Form & Controls */}
        <div
          style={{
            background: '#0a0f1d',
            borderRadius: 12,
            padding: 16,
            border: '1px solid #1e293b',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            overflowY: 'auto',
          }}
        >
          <div style={{ fontSize: 12, color: '#38bdf8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Client & Scope Configuration
          </div>

          <div>
            <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: 4 }}>Client Organization</label>
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '7px 10px', color: '#fff', fontSize: 13 }}
            />
          </div>

          <div>
            <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: 4 }}>Solution Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '7px 10px', color: '#fff', fontSize: 13 }}
            />
          </div>

          <div>
            <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: 4 }}>Problem Statement</label>
            <textarea
              rows={3}
              value={problemStatement}
              onChange={(e) => setProblemStatement(e.target.value)}
              style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '7px 10px', color: '#fff', fontSize: 12, resize: 'vertical' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: 4 }}>Active Users</label>
              <input
                type="number"
                min={10}
                max={50000}
                step={50}
                value={userCount}
                onChange={(e) => setUserCount(Number(e.target.value))}
                style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '7px 10px', color: '#fff', fontSize: 13 }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: 4 }}>Msgs / Mo</label>
              <input
                type="number"
                min={1000}
                max={500000}
                step={5000}
                value={monthlyTransactions}
                onChange={(e) => setMonthlyTransactions(Number(e.target.value))}
                style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '7px 10px', color: '#fff', fontSize: 13 }}
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: 4 }}>Compliance Standard</label>
            <select
              value={complianceTier}
              onChange={(e) => setComplianceTier(e.target.value as any)}
              style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '7px 10px', color: '#fff', fontSize: 13 }}
            >
              <option value="standard">Standard Commercial (ISO 27001)</option>
              <option value="hipaa">Healthcare / HIPAA Tier</option>
              <option value="financial">Financial Services / SOC2 Tier</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: 6 }}>Integration Points</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {['Dataverse', 'SAP ERP', 'Azure Blob', 'Graph API', 'ServiceNow'].map((ig) => {
                const active = selectedIntegrations.includes(ig);
                return (
                  <button
                    key={ig}
                    type="button"
                    onClick={() => {
                      setSelectedIntegrations(active ? selectedIntegrations.filter((x) => x !== ig) : [...selectedIntegrations, ig]);
                    }}
                    style={{
                      background: active ? '#0284c7' : '#1e293b',
                      color: active ? '#fff' : '#94a3b8',
                      border: '1px solid #334155',
                      padding: '4px 8px',
                      borderRadius: 6,
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    {active ? '✓ ' : '+ '}
                    {ig}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            onClick={handleRegenerate}
            disabled={isGenerating}
            style={{
              marginTop: 'auto',
              background: '#0284c7',
              color: '#fff',
              border: 'none',
              padding: '10px 16px',
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 13,
              cursor: isGenerating ? 'wait' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <span>{isGenerating ? '⟳' : '⚡'}</span>
            <span>{isGenerating ? 'Recalculating SOW…' : 'Update Proposal & BOM'}</span>
          </button>
        </div>

        {/* Right Column: Proposal Preview & Analytics */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
          {/* Top KPI Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <div style={{ background: '#0a0f1d', border: '1px solid #1e293b', borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>Monthly Licensing</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#38bdf8', marginTop: 4 }}>
                ${proposal.totalMonthlyLicenseCost.toLocaleString()}
                <span style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>/mo</span>
              </div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>${proposal.annualLicenseCost.toLocaleString()} / year</div>
            </div>

            <div style={{ background: '#0a0f1d', border: '1px solid #1e293b', borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>Delivery Timeline</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#c084fc', marginTop: 4 }}>{proposal.estimatedTimelineWeeks} Weeks</div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>6 Milestone Sprints</div>
            </div>

            <div style={{ background: '#0a0f1d', border: '1px solid #1e293b', borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>Annual Operational Gain</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#4ade80', marginTop: 4 }}>
                ${(proposal.projectedAnnualSavings / 1000).toFixed(0)}k
                <span style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>/yr</span>
              </div>
              <div style={{ fontSize: 10, color: '#16a34a', marginTop: 2 }}>Labor hours recovered</div>
            </div>

            <div style={{ background: '#0a0f1d', border: '1px solid #1e293b', borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>Net 3-Year ROI</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#fbbf24', marginTop: 4 }}>{proposal.threeYearRoiPercent}%</div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>Payback in &lt;14 mos</div>
            </div>
          </div>

          {/* Tab Navigation */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1e293b', paddingBottom: 8 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { id: 'overview', label: '📄 Executive Summary' },
                { id: 'licensing', label: '💳 Licensing BOM' },
                { id: 'roadmap', label: '🗓️ Sprint Roadmap' },
                { id: 'markdown', label: '📝 Raw Markdown' },
              ].map((t) => {
                const active = activeTab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setActiveTab(t.id as any)}
                    style={{
                      background: active ? '#1e293b' : 'transparent',
                      color: active ? '#38bdf8' : '#94a3b8',
                      border: `1px solid ${active ? '#38bdf8' : 'transparent'}`,
                      padding: '6px 12px',
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

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleCopyMarkdown}
                style={{ background: '#1e293b', color: '#fff', border: '1px solid #334155', padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
              >
                📋 Copy
              </button>
              <button
                onClick={handleDownload}
                style={{ background: '#1e293b', color: '#fff', border: '1px solid #334155', padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
              >
                💾 Export .md
              </button>
              <button
                onClick={handleOpenHld}
                style={{ background: '#7c3aed', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 700 }}
              >
                📐 Generate HLD
              </button>
            </div>
          </div>

          {/* Tab Content Display */}
          <div style={{ background: '#0a0f1d', border: '1px solid #1e293b', borderRadius: 12, padding: 18, flex: 1, overflowY: 'auto' }}>
            {activeTab === 'overview' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <h3 style={{ margin: 0, fontSize: 18, color: '#ffffff' }}>{proposal.title}</h3>
                <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.5 }}>
                  Prepared exclusively for <strong style={{ color: '#fff' }}>{proposal.clientName}</strong> ({industry}) under the{' '}
                  <span style={{ color: '#38bdf8', fontWeight: 700 }}>{complianceTier.toUpperCase()} Compliance Tier</span>.
                </div>
                <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 14 }}>
                  <div style={{ fontSize: 12, color: '#38bdf8', fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>Problem Statement</div>
                  <div style={{ fontSize: 13, color: '#cbd5e1', fontStyle: 'italic', lineHeight: 1.4 }}>"{problemStatement}"</div>
                </div>
                <div style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.5 }}>
                  Our recommended architecture incorporates an autonomous Copilot Studio agent orchestrating Power Automate cloud flows and Dataverse entity logic. Target engagement channels include{' '}
                  <strong>{selectedChannels.join(', ')}</strong>, secured with Microsoft Entra ID Conditional Access.
                </div>
              </div>
            )}

            {activeTab === 'licensing' && (
              <div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, textAlign: 'left' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                      <th style={{ padding: '8px 6px' }}>Category</th>
                      <th style={{ padding: '8px 6px' }}>SKU / Capability</th>
                      <th style={{ padding: '8px 6px' }}>Qty</th>
                      <th style={{ padding: '8px 6px' }}>Unit / mo</th>
                      <th style={{ padding: '8px 6px' }}>Total / mo</th>
                      <th style={{ padding: '8px 6px' }}>Allocation Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proposal.licensingBOM.map((b: LicenseCostItem, i: number) => (
                      <tr key={i} style={{ borderBottom: '1px solid #1e293b', color: '#e2e8f0' }}>
                        <td style={{ padding: '10px 6px', fontWeight: 700, color: '#38bdf8' }}>{b.category}</td>
                        <td style={{ padding: '10px 6px' }}>{b.sku}</td>
                        <td style={{ padding: '10px 6px' }}>{b.quantity}</td>
                        <td style={{ padding: '10px 6px' }}>${b.unitPriceMonthly}</td>
                        <td style={{ padding: '10px 6px', fontWeight: 700 }}>${b.totalMonthly.toLocaleString()}</td>
                        <td style={{ padding: '10px 6px', color: '#94a3b8', fontSize: 11 }}>{b.notes}</td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: '2px solid #38bdf8', color: '#ffffff', fontWeight: 800 }}>
                      <td colSpan={4} style={{ padding: '12px 6px' }}>
                        TOTAL ESTIMATED CLOUD LICENSING
                      </td>
                      <td style={{ padding: '12px 6px', color: '#38bdf8', fontSize: 14 }}>${proposal.totalMonthlyLicenseCost.toLocaleString()} / mo</td>
                      <td style={{ padding: '12px 6px', color: '#94a3b8', fontSize: 11 }}>${proposal.annualLicenseCost.toLocaleString()} / year</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === 'roadmap' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {proposal.sprintRoadmap.map((s: SprintItem) => (
                  <div key={s.sprint} style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>
                        Sprint {s.sprint}: {s.title}
                      </div>
                      <span style={{ fontSize: 11, color: '#38bdf8', background: '#082f49', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
                        {s.weeks}
                      </span>
                    </div>
                    <ul style={{ margin: '4px 0 0 16px', padding: 0, fontSize: 12, color: '#94a3b8' }}>
                      {s.deliverables.map((d: string, di: number) => (
                        <li key={di} style={{ marginBottom: 3 }}>
                          {d}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'markdown' && (
              <pre style={{ margin: 0, fontSize: 11, color: '#94a3b8', fontFamily: 'Consolas, monospace', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
                {proposal.markdownContent}
              </pre>
            )}
          </div>
        </div>
      </div>
    </Panel>
  );
}
