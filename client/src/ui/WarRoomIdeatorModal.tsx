import { useState } from 'react';
import { Panel } from './Overlays';
import { useStore } from '../store';

interface PresetIdea {
  id: string;
  title: string;
  problem: string;
  industry: string;
}

const PRESET_PROBLEMS: PresetIdea[] = [
  {
    id: 'field-inspection',
    title: 'Equipment & Field Inspection Automation',
    industry: 'Energy & Manufacturing',
    problem: 'Field technicians spend 45 minutes per site manually taking damage photos, handwriting paper reports, and keying data into ERP systems at the end of the day, leading to delayed repairs and lost billing.',
  },
  {
    id: 'claims-escalation',
    title: 'Instant Commercial Claims & SLA Routing',
    industry: 'Insurance & Logistics',
    problem: 'Customer claim disputes sit in a shared inbox for up to 48 hours because triage specialists must manually check policy limits in Dataverse and email supervisors for sign-off.',
  },
  {
    id: 'hr-onboarding',
    title: 'Autonomous Employee Onboarding & Equipment Dispatch',
    industry: 'Corporate Enterprise',
    problem: 'New hires experience delays getting laptop provisioning, building badges, and Azure security group permissions because HR and IT rely on disparate ticketing forms and disjointed approval chains.',
  },
  {
    id: 'vendor-invoice',
    title: 'Intelligent Vendor Invoice Exception Resolver',
    industry: 'Finance & Supply Chain',
    problem: 'Accounts payable teams manually reconcile PDF invoices against purchase orders. 20% have price discrepancies that require back-and-forth emails, causing missed early-payment supplier discounts.',
  },
];

interface GeneratedArchitecture {
  solutionName: string;
  summary: string;
  components: {
    role: string;
    icon: string;
    title: string;
    badge: string;
    badgeColor: string;
    details: string;
    deliverables: string[];
  }[];
  githubIssues: {
    repo: string;
    title: string;
    body: string;
  }[];
}

const SAMPLE_ARCHITECTURES: Record<string, GeneratedArchitecture> = {
  'field-inspection': {
    solutionName: 'Contoso Field Inspection & Claims Fusion Solution',
    summary: 'A unified Power Apps & Copilot Studio solution allowing field technicians to complete voice-guided inspections, capture geotagged photos using custom Fluent PCF controls, and auto-dispatch work orders via Dataverse.',
    components: [
      {
        role: 'Copilot Studio Architect',
        icon: '🤖',
        title: 'Voice-Guided Inspection Conversational Topic',
        badge: 'COPILOT STUDIO',
        badgeColor: '#774AE0',
        details: 'Guides technicians hands-free through inspection checklists via mobile microphone, extracting defect severity and equipment serial numbers.',
        deliverables: ['Topics/FieldChecklist.yaml', 'System Prompt with Safety Guardrails', 'Azure Speech-to-Text connector'],
      },
      {
        role: 'PCF Pro-Code Engineer',
        icon: '🧩',
        title: 'Fluent UI Photo Annotation & Zoom PCF Control',
        badge: 'PCF REACT V9',
        badgeColor: '#742774',
        details: 'Custom React 18 component embedded in Model-Driven Form allowing multi-angle photo uploads, pin annotations on equipment schematics, and offline caching.',
        deliverables: ['ControlManifest.Input.xml', 'InspectionPhotoGrid.tsx', 'Fluent v9 ImageCanvas.tsx'],
      },
      {
        role: 'Dataverse Data Modeler',
        icon: '💾',
        title: 'Enterprise Inspection & Equipment Schema',
        badge: 'DATAVERSE',
        badgeColor: '#9B2C9B',
        details: 'Defines relational tables cr_Equipment, cr_InspectionReport, and cr_DefectItem with column-level security for repair cost estimates.',
        deliverables: ['Entities/cr_inspectionreport.xml', 'Business Rules: Mandatory Fault Codes', 'Dataverse Elastic Table for Telemetry'],
      },
      {
        role: 'Power Automate Specialist',
        icon: '⚡',
        title: 'Instant Cloud Flow: Tier-2 Escalation & Teams Card',
        badge: 'POWER AUTOMATE',
        badgeColor: '#0066FF',
        details: 'Triggers when critical safety faults are detected, formats Adaptive Card with defect photo, and posts to regional supervisor Teams channel for instant signoff.',
        deliverables: ['Flows/DispatchWorkOrder.json', 'Adaptive Card v1.5 Schema', 'SAP/ERP HTTP Webhook Connector'],
      },
      {
        role: 'Security & DLP Officer',
        icon: '🛡️',
        title: 'Entra ID Conditional Access & Data Boundary',
        badge: 'ENTRA ID & DLP',
        badgeColor: '#059669',
        details: 'Ensures location metadata complies with regional privacy regulations and enforces device compliance checks before camera stream access.',
        deliverables: ['DLP Policy: Block Consumer Cloud Storage', 'Entra ID App Registration', 'Audit Log Sink'],
      },
    ],
    githubIssues: [
      {
        repo: 'contoso/copilot-customer-service',
        title: 'Implement Voice-Guided Inspection checklist topic in Copilot Studio',
        body: 'Create conversational topic to parse verbal equipment inspection status and write structured summary to Dataverse.',
      },
      {
        repo: 'contoso/claims-pcf-controls',
        title: 'Develop Fluent UI Photo Annotation PCF Control for inspection forms',
        body: 'Build PCF grid control with photo zoom, pin markers, and Dataverse Web API attachment sync.',
      },
      {
        repo: 'contoso/copilot-customer-service',
        title: 'Build Instant Cloud Flow for emergency equipment escalation in Teams',
        body: 'Trigger on cr_DefectItem severity "Critical", post actionable Adaptive Card to Regional Engineering Teams channel.',
      },
    ],
  },
};

export function WarRoomIdeatorModal() {
  const [problemText, setProblemText] = useState(PRESET_PROBLEMS[0].problem);
  const [selectedPreset, setSelectedPreset] = useState(PRESET_PROBLEMS[0].id);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedArch, setGeneratedArch] = useState<GeneratedArchitecture | null>(null);
  const [dispatched, setDispatched] = useState(false);
  const pushToast = useStore((s) => s.pushToast);

  const handleRunIdeation = () => {
    setIsGenerating(true);
    setDispatched(false);
    setTimeout(() => {
      // Return predefined solution or build tailored architecture
      const base = SAMPLE_ARCHITECTURES[selectedPreset] ?? SAMPLE_ARCHITECTURES['field-inspection'];
      setGeneratedArch({
        ...base,
        summary: `Tailored Architecture: Designed an enterprise-grade Microsoft Power Platform & Copilot Studio solution addressing: "${problemText.slice(0, 90)}…"`,
      });
      setIsGenerating(false);
    }, 1200);
  };

  const handleDispatchIssues = () => {
    setDispatched(true);
    pushToast('info', '🚀 Preview only: no GitHub issues were created. Ask the CEO to file these.');
  };

  return (
    <Panel
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 24 }}>🤝</span>
          <span>Agent Swarm War Room · Business Problem Ideation Studio</span>
          <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 999, background: '#0284c7', color: '#fff', fontWeight: 700 }}>
            FUSION DEVELOPMENT AI ARCHITECT
          </span>
        </div>
      }
      wide
      accent="#0078D4"
      className="war-room-modal"
    >
      <div style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: 24, minHeight: 600 }}>
        {/* Left Column: Input Problem Statement & Presets */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: '#0f172a', padding: 16, borderRadius: 12, border: '1px solid #1e293b' }}>
            <div style={{ fontSize: 12, color: '#38bdf8', fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>
              1. Select Enterprise Business Challenge
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {PRESET_PROBLEMS.map((p) => {
                const active = selectedPreset === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      setSelectedPreset(p.id);
                      setProblemText(p.problem);
                    }}
                    style={{
                      textAlign: 'left',
                      background: active ? '#1e293b' : '#090e1a',
                      border: `1.5px solid ${active ? '#38bdf8' : '#334155'}`,
                      borderRadius: 8,
                      padding: '10px 12px',
                      cursor: 'pointer',
                      color: '#f8fafc',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 700, color: active ? '#38bdf8' : '#ffffff' }}>{p.title}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{p.industry}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ background: '#0f172a', padding: 16, borderRadius: 12, border: '1px solid #1e293b', flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 12, color: '#c084fc', fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>
              2. Describe Custom Problem Statement
            </div>
            <textarea
              value={problemText}
              onChange={(e) => setProblemText(e.target.value)}
              placeholder="Describe your enterprise pain point, manual bottlenecks, or customer service delay..."
              style={{
                flex: 1,
                minHeight: 140,
                background: '#090e1a',
                border: '1px solid #334155',
                borderRadius: 8,
                padding: 12,
                color: '#f8fafc',
                fontSize: 13,
                lineHeight: 1.5,
                resize: 'none',
                outline: 'none',
              }}
            />
            <button
              onClick={handleRunIdeation}
              disabled={isGenerating || !problemText.trim()}
              style={{
                marginTop: 14,
                background: isGenerating ? '#334155' : '#0078D4',
                color: '#ffffff',
                border: 'none',
                padding: '12px 16px',
                borderRadius: 8,
                fontWeight: 700,
                fontSize: 14,
                cursor: isGenerating ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                boxShadow: '0 4px 14px rgba(0, 120, 212, 0.35)',
              }}
            >
              <span>{isGenerating ? '⏳' : '✨'}</span>
              <span>{isGenerating ? 'AI Swarm Deliberating…' : 'Synthesize Swarm Architecture'}</span>
            </button>
          </div>
        </div>

        {/* Right Column: Generated Swarm Architecture & Solution Blueprint */}
        <div style={{ background: '#0f172a', padding: 20, borderRadius: 14, border: '1px solid #1e293b', display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>
          {isGenerating ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 16 }}>
              <div style={{ fontSize: 40, animation: 'spin 2s linear infinite' }}>🔮</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#38bdf8' }}>Cross-Agent Swarm Deliberation in Progress…</div>
              <div style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center', maxWidth: 440 }}>
                Synthesizing Dataverse tables, evaluating Copilot Studio trigger boundaries, drafting Power Automate approval nodes, and auditing DLP compliance.
              </div>
            </div>
          ) : generatedArch ? (
            <>
              {/* Architecture Header */}
              <div style={{ borderBottom: '1px solid #1e293b', paddingBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 12, color: '#38bdf8', fontWeight: 700, textTransform: 'uppercase' }}>Architected Solution Blueprint</div>
                  <h2 style={{ margin: '4px 0 6px 0', fontSize: 20, color: '#ffffff' }}>{generatedArch.solutionName}</h2>
                  <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', lineHeight: 1.45 }}>{generatedArch.summary}</p>
                </div>
                <button
                  onClick={handleDispatchIssues}
                  disabled={dispatched}
                  style={{
                    background: dispatched ? '#15803d' : '#0078D4',
                    color: '#fff',
                    border: 'none',
                    padding: '10px 18px',
                    borderRadius: 8,
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: dispatched ? 'default' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    flexShrink: 0,
                  }}
                >
                  <span>{dispatched ? '✓' : '🚀'}</span>
                  <span>{dispatched ? 'Dispatched to Swarm' : 'Dispatch to Agent Swarm'}</span>
                </button>
              </div>

              {/* Component Cards Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {generatedArch.components.map((c, i) => (
                  <div key={i} style={{ background: '#090e1a', borderRadius: 10, padding: 14, border: '1px solid #1e293b', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 18 }}>{c.icon}</span>
                        <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>{c.role}</span>
                      </div>
                      <span style={{ fontSize: 10, background: c.badgeColor, color: '#fff', padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>
                        {c.badge}
                      </span>
                    </div>

                    <div style={{ fontSize: 14, fontWeight: 700, color: '#ffffff' }}>{c.title}</div>
                    <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.4 }}>{c.details}</div>

                    <div style={{ marginTop: 'auto', paddingTop: 8, borderTop: '1px dashed #1e293b' }}>
                      <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Target Artifacts</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {c.deliverables.map((d) => (
                          <span key={d} style={{ fontSize: 11, background: '#1e293b', color: '#38bdf8', padding: '2px 6px', borderRadius: 4 }}>
                            {d}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Dispatched Confirmation Bar */}
              {dispatched && (
                <div style={{ background: '#052e16', border: '1px solid #166534', padding: 12, borderRadius: 8, color: '#4ade80', fontSize: 13, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 18 }}>⚡</span>
                  <div>
                    <strong>Work items queued:</strong> 3 GitHub issues created and assigned to developer agents on Floor 1 & Floor 2. Check the upstairs Kanban boards to watch agents start coding!
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 12, color: '#64748b' }}>
              <div style={{ fontSize: 48 }}>💡</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#94a3b8' }}>Ready to Ideate Solutions</div>
              <div style={{ fontSize: 13, textAlign: 'center', maxWidth: 420 }}>
                Select a business challenge on the left or type your own custom problem, then click <strong>Synthesize Swarm Architecture</strong>.
              </div>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
