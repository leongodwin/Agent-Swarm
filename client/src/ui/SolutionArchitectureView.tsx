import { useState } from 'react';
import { Panel } from './Overlays';
import { useStore } from '../store';

interface NodeDetail {
  id: string;
  category: string;
  name: string;
  badge: string;
  badgeBg: string;
  summary: string;
  techStack: string[];
  telemetry: {
    invocations: string;
    avgLatency: string;
    successRate: string;
  };
  details: string;
}

const ARCH_NODES: Record<string, NodeDetail> = {
  teams: {
    id: 'teams',
    category: '1. Engagement Channel',
    name: 'Microsoft Teams & Outlook Channels',
    badge: 'ACTIVE CHANNEL',
    badgeBg: '#464EB8',
    summary: 'Interactive Conversational frontend leveraging Adaptive Cards v1.5 for desktop and mobile.',
    techStack: ['Bot Framework SDK', 'Adaptive Cards v1.5', 'Teams Activity Handler', 'SSO / Entra ID'],
    telemetry: { invocations: '1,420 msgs/hr', avgLatency: '82 ms', successRate: '99.9%' },
    details: 'Handles user prompt ingestion, rich action buttons for approvals, and streaming chunk responses directly into personal chats or collaborative channels.',
  },
  pages: {
    id: 'pages',
    category: '1. Engagement Channel',
    name: 'Power Pages & Web Canvas Webchat',
    badge: 'AUTHENTICATED',
    badgeBg: '#0284C7',
    summary: 'Customer self-service portal embedding Microsoft Copilot Studio webchat with Entra ID B2C.',
    techStack: ['Power Pages Liquid Templates', 'Copilot Webchat v4', 'Entra ID External Identities'],
    telemetry: { invocations: '890 sessions/day', avgLatency: '94 ms', successRate: '99.8%' },
    details: 'Enables unauthenticated anonymous knowledge lookup with gated escalation to authenticated support tickets upon customer login.',
  },
  pcf: {
    id: 'pcf',
    category: '1. Engagement Channel',
    name: 'Custom PCF Control Form Host',
    badge: 'FLUENT REACT',
    badgeBg: '#742774',
    summary: 'Custom React Fluent UI v9 controls integrated into Model-Driven & Canvas App forms.',
    techStack: ['Power Apps Component Framework (PCF)', 'Fluent UI React v9', 'Dataverse Web API'],
    telemetry: { invocations: '4,210 renders', avgLatency: '16 ms', successRate: '100%' },
    details: 'Empowers back-office claim adjusters with rich multi-photo inspection grids and direct trigger hooks into Copilot topics.',
  },
  voice: {
    id: 'voice',
    category: '1. Engagement Channel',
    name: 'Voice & Omnichannel Telephony Gateway',
    badge: 'REAL-TIME STREAM',
    badgeBg: '#059669',
    summary: 'Azure Communication Services bidirectional audio stream connected to Copilot Studio IVR.',
    techStack: ['Azure Communication Services (ACS)', 'Cognitive Services Speech-to-Text', 'Neural TTS'],
    telemetry: { invocations: '142 calls/hr', avgLatency: '240 ms', successRate: '99.4%' },
    details: 'Real-time conversational voice bot handling telephone support queues with automatic sentiment detection and human handover.',
  },
  copilot_engine: {
    id: 'copilot_engine',
    category: '2. Copilot Studio Agent Core',
    name: 'Copilot Studio Topics Engine',
    badge: 'GENERATIVE AI',
    badgeBg: '#774AE0',
    summary: 'Autonomous orchestrator classifying customer intents, extracting entities, and executing adaptive topics.',
    techStack: ['Microsoft Copilot Studio', 'Conversational AI System Prompts', 'Dynamic Chaining'],
    telemetry: { invocations: '2,940 decisions/hr', avgLatency: '145 ms', successRate: '99.6%' },
    details: 'Hosts 28 enterprise support topics. Dynamic generative chaining automatically determines if pre-authored topic flows or RAG fallbacks should answer.',
  },
  azure_openai: {
    id: 'azure_openai',
    category: '2. Copilot Studio Agent Core',
    name: 'Azure OpenAI Fallback Node & Vector RAG',
    badge: 'GROUNDED RAG',
    badgeBg: '#0078D4',
    summary: 'GPT-4o reasoning over enterprise SharePoint documents and knowledge bases with citation grounding.',
    techStack: ['Azure OpenAI GPT-4o', 'Azure AI Search (Hybrid Vector)', 'Cognitive Reranking'],
    telemetry: { invocations: '620 queries/hr', avgLatency: '410 ms', successRate: '99.2%' },
    details: 'Semantic search across 12,000 internal policy documents. Every response includes verifiable inline citations before returning to the user.',
  },
  guardrails: {
    id: 'guardrails',
    category: '2. Copilot Studio Agent Core',
    name: 'Guardrails & Safety Evaluator',
    badge: 'ZERO JAILBREAKS',
    badgeBg: '#059669',
    summary: 'Pre- and post-processing filters scanning for prompt injections, jailbreaks, and PII leakage.',
    techStack: ['Azure AI Content Safety', 'Prompt Shield', 'PII Masking Regex & NER'],
    telemetry: { invocations: '3,560 checks/hr', avgLatency: '18 ms', successRate: '100%' },
    details: 'Guarantees enterprise compliance. Redacts social security and credit card numbers automatically; blocks adversarial jailbreak attempts.',
  },
  flow_instant: {
    id: 'flow_instant',
    category: '3. Power Automate & Logic',
    name: 'Instant Cloud Flows (Power Automate)',
    badge: 'FLOW ORCHESTRATOR',
    badgeBg: '#0066FF',
    summary: 'High-performance workflow orchestrator triggered via HTTP actions from Copilot Studio.',
    techStack: ['Power Automate Cloud Flows', 'HTTP Webhook Trigger', 'JSON Schema Validation'],
    telemetry: { invocations: '840 runs/hr', avgLatency: '312 ms', successRate: '99.7%' },
    details: 'Validates ticket payloads, queries SLA thresholds in Dataverse, and routes incident updates to responsible engineering tiers.',
  },
  flow_approval: {
    id: 'flow_approval',
    category: '3. Power Automate & Logic',
    name: 'Adaptive Card Approval Flow',
    badge: 'APPROVAL ENGINE',
    badgeBg: '#D97706',
    summary: 'Multi-stage asynchronous manager sign-off delivered directly to Teams mobile and desktop.',
    techStack: ['Approvals Connector v2', 'Microsoft Teams Webhook', 'Wait for Approval Action'],
    telemetry: { invocations: '45 approvals/day', avgLatency: '1.2h response', successRate: '98.9%' },
    details: 'Dispatches manager sign-off cards for high-value claims or SLA overrides with complete audit history recorded in Dataverse.',
  },
  custom_connector: {
    id: 'custom_connector',
    category: '3. Power Automate & Logic',
    name: 'Custom Connector Broker (Pro-Code Gateway)',
    badge: 'PRO-CODE GATEWAY',
    badgeBg: '#7C3AED',
    summary: 'OpenAPI-defined microservice gateway connecting the low-code swarm to internal ERPs and Graph.',
    techStack: ['OpenAPI 3.0 / Swagger', 'OAuth 2.0 Client Credentials', 'Redis Token Cache'],
    telemetry: { invocations: '1,120 calls/hr', avgLatency: '42 ms', successRate: '99.9%' },
    details: 'Translates REST endpoints into reusable drag-and-drop connectors for citizen developers and autonomous coding agents.',
  },
  dataverse: {
    id: 'dataverse',
    category: '4. Dataverse & Enterprise Data',
    name: 'Microsoft Dataverse System of Record',
    badge: 'SYSTEM OF RECORD',
    badgeBg: '#742774',
    summary: 'Relational business data platform with role-based column security, business units, and auditing.',
    techStack: ['Dataverse (Common Data Service)', 'Elastic Tables', 'Azure Synapse Link for Dataverse'],
    telemetry: { invocations: '18,400 CRUD ops/hr', avgLatency: '34 ms', successRate: '99.99%' },
    details: 'Stores cr_ServiceTicket, cr_KnowledgeTopic, and cr_AgentAuditLog with automated column masking and point-in-time recovery.',
  },
  graph_api: {
    id: 'graph_api',
    category: '4. Dataverse & Enterprise Data',
    name: 'Microsoft Graph API v1.0',
    badge: 'M365 CONNECTED',
    badgeBg: '#0284C7',
    summary: 'Unified gateway accessing Microsoft 365 services: user org charts, emails, calendars, and SharePoint files.',
    techStack: ['Microsoft Graph .NET SDK', 'App-Only Permissions', 'Delta Sync Queries'],
    telemetry: { invocations: '3,200 req/hr', avgLatency: '68 ms', successRate: '99.9%' },
    details: 'Empowers agents to dynamically discover employee supervisors, organizational hierarchies, and recent customer correspondence.',
  },
  power_bi: {
    id: 'power_bi',
    category: '4. Dataverse & Enterprise Data',
    name: 'Power BI Live Telemetry Hub',
    badge: 'STREAMING BI',
    badgeBg: '#D97706',
    summary: 'Real-time analytics and executive ROI reporting streaming topic resolution rates and token efficiencies.',
    techStack: ['Power BI REST API', 'DirectQuery over Synapse', 'Push Streaming Datasets'],
    telemetry: { invocations: '60 refreshes/hr', avgLatency: '120 ms', successRate: '100%' },
    details: 'Visualizes agent swarm velocity, cost savings compared to manual ticket resolution, and resolution accuracy trends.',
  },
};

export function SolutionArchitectureView({ repoId }: { repoId?: string }) {
  const [selectedId, setSelectedId] = useState<string>('copilot_engine');
  const selectedNode = ARCH_NODES[selectedId] ?? ARCH_NODES.copilot_engine;
  const repos = useStore((s) => s.repos);
  const repo = repos.find((r) => r.id === repoId) ?? repos[0];

  return (
    <Panel
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>🏛️</span>
          <span>Power Platform & Copilot Studio Solution Architecture</span>
          <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 999, background: '#0078D4', color: '#fff', fontWeight: 600 }}>
            ALM PIPELINE: ACTIVE
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
              Showing solution components for <strong>{repo ? repo.fullName : 'contoso/copilot-customer-service'}</strong>
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#38bdf8', background: '#082f49', padding: '3px 8px', borderRadius: 6 }}>● PAC CLI Connected</span>
              <span style={{ fontSize: 12, color: '#4ade80', background: '#052e16', padding: '3px 8px', borderRadius: 6 }}>● Dataverse Solution: Unmanaged</span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, flex: 1 }}>
            {/* Tier 1: Channels */}
            <div style={{ background: '#0a0f1d', borderRadius: 12, padding: 12, border: '1px solid #1e293b', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ color: '#38bdf8', fontSize: 12, fontWeight: 700, borderBottom: '1px solid #1e293b', paddingBottom: 6 }}>1. ENGAGEMENT</div>
              {(['teams', 'pages', 'pcf', 'voice'] as const).map((id) => {
                const n = ARCH_NODES[id];
                const active = selectedId === id;
                return (
                  <button
                    key={id}
                    onClick={() => setSelectedId(id)}
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
            <div style={{ background: '#0a0f1d', borderRadius: 12, padding: 12, border: '1px solid #1e293b', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ color: '#c084fc', fontSize: 12, fontWeight: 700, borderBottom: '1px solid #1e293b', paddingBottom: 6 }}>2. COPILOT STUDIO</div>
              {(['copilot_engine', 'azure_openai', 'guardrails'] as const).map((id) => {
                const n = ARCH_NODES[id];
                const active = selectedId === id;
                return (
                  <button
                    key={id}
                    onClick={() => setSelectedId(id)}
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
            <div style={{ background: '#0a0f1d', borderRadius: 12, padding: 12, border: '1px solid #1e293b', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ color: '#60a5fa', fontSize: 12, fontWeight: 700, borderBottom: '1px solid #1e293b', paddingBottom: 6 }}>3. POWER AUTOMATE</div>
              {(['flow_instant', 'flow_approval', 'custom_connector'] as const).map((id) => {
                const n = ARCH_NODES[id];
                const active = selectedId === id;
                return (
                  <button
                    key={id}
                    onClick={() => setSelectedId(id)}
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
            <div style={{ background: '#0a0f1d', borderRadius: 12, padding: 12, border: '1px solid #1e293b', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ color: '#f472b6', fontSize: 12, fontWeight: 700, borderBottom: '1px solid #1e293b', paddingBottom: 6 }}>4. DATAVERSE & DATA</div>
              {(['dataverse', 'graph_api', 'power_bi'] as const).map((id) => {
                const n = ARCH_NODES[id];
                const active = selectedId === id;
                return (
                  <button
                    key={id}
                    onClick={() => setSelectedId(id)}
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

          <div style={{ background: '#1e293b', borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 11, color: '#38bdf8', fontWeight: 700, marginBottom: 8, textTransform: 'uppercase' }}>Live Telemetry</div>
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
              {selectedNode.techStack.map((tech) => (
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
            <span>⚡</span> Sync Component with Dataverse (PAC CLI)
          </button>
        </div>
      </div>
    </Panel>
  );
}
