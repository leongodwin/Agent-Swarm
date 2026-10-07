import { useState } from 'react';
import { Panel } from './Overlays';

interface FlowRun {
  id: string;
  triggerName: string;
  triggerType: string;
  status: 'Succeeded' | 'Failed' | 'Running';
  startedAt: string;
  duration: string;
  flowId: string;
  steps: {
    num: number;
    name: string;
    type: string;
    duration: string;
    status: string;
    color: string;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
  }[];
}

const DEMO_RUNS: FlowRun[] = [
  {
    id: '20261003-0948-21',
    triggerName: 'When a HTTP request is received (Copilot Studio Action)',
    triggerType: 'Request Trigger',
    status: 'Succeeded',
    startedAt: 'Just now',
    duration: '312 ms',
    flowId: 'flw_dispatch_ticket_v2',
    steps: [
      {
        num: 1,
        name: 'When a HTTP request is received (Copilot Studio Action)',
        type: 'Trigger · Request',
        duration: '14 ms',
        status: '200 OK',
        color: '#38bdf8',
        input: { method: 'POST', schema: 'ServiceRequestTicketSchema' },
        output: { ticketId: 'CAS-10492-X9', urgency: 'High', customerEmail: 'alex.w@contoso.com' },
      },
      {
        num: 2,
        name: 'Microsoft Dataverse: Get row by ID (cr_ticket)',
        type: 'Action · Dataverse Connector',
        duration: '124 ms',
        status: '200 OK',
        color: '#c084fc',
        input: { table: 'cr_tickets', rowId: '7f91a2bc-33d1-4e89-a1b2' },
        output: { cr_ticketnumber: 'CAS-10492-X9', cr_slahours: 2, cr_owner: 'Fabrikam Support' },
      },
      {
        num: 3,
        name: 'Condition: Evaluate SLA Urgency & Routing Policy',
        type: 'Control · Condition Branch',
        duration: '2 ms',
        status: 'TRUE',
        color: '#facc15',
        input: { expression: 'less(body("Dataverse")?["cr_slahours"], 4)' },
        output: { branchTaken: 'EscalationTier2' },
      },
      {
        num: 4,
        name: 'Microsoft Teams: Post Adaptive Card to Tier 2 Escalations',
        type: 'Action · Teams Connector v3',
        duration: '168 ms',
        status: '201 Created',
        color: '#60a5fa',
        input: { channelId: '19:support-escalations@thread.tacv2', cardVersion: '1.5' },
        output: { messageId: 'msg_9941', status: 'Delivered', recipientCount: 8 },
      },
      {
        num: 5,
        name: 'Respond to Copilot Studio with Adaptive Card Payload',
        type: 'Action · HTTP Response',
        duration: '4 ms',
        status: '200 OK',
        color: '#4ade80',
        input: { statusCode: 200, contentType: 'application/json' },
        output: { escalationDispatched: true, ticketNumber: 'CAS-10492-X9', queueStatus: 'Assigned to Tier 2' },
      },
    ],
  },
  {
    id: '20261003-0944-10',
    triggerName: 'When a row is added or modified (Dataverse Webhook)',
    triggerType: 'Dataverse Trigger',
    status: 'Succeeded',
    startedAt: '4m ago',
    duration: '428 ms',
    flowId: 'flw_dataverse_sync_audit',
    steps: [
      {
        num: 1,
        name: 'When a row is added or modified (Dataverse)',
        type: 'Trigger · Dataverse',
        duration: '18 ms',
        status: '200 OK',
        color: '#e879f9',
        input: { entityName: 'cr_servicetickets', message: 'Update' },
        output: { rowId: '5420-bba-112', modifiedBy: 'copilot-agent' },
      },
      {
        num: 2,
        name: 'Audit Trail Logger (Blob Storage)',
        type: 'Action · Azure Blob',
        duration: '410 ms',
        status: '200 OK',
        color: '#38bdf8',
        input: { container: 'audit-logs-2026' },
        output: { blobUrl: 'https://contosostorage.blob.core.windows.net/audit/20261003.json' },
      },
    ],
  },
  {
    id: '20261003-0938-55',
    triggerName: 'Adaptive Card Submit Action from Teams Mobile',
    triggerType: 'Teams Webhook',
    status: 'Succeeded',
    startedAt: '9m ago',
    duration: '184 ms',
    flowId: 'flw_adaptive_card_response',
    steps: [
      {
        num: 1,
        name: 'When an Adaptive Card action is submitted',
        type: 'Trigger · Teams',
        duration: '12 ms',
        status: '200 OK',
        color: '#60a5fa',
        input: { action: 'ApproveEscalation' },
        output: { approvedBy: 'leon@contoso.com', notes: 'Approved for priority handling' },
      },
      {
        num: 2,
        name: 'Update Dataverse Row Status (Approved)',
        type: 'Action · Dataverse',
        duration: '172 ms',
        status: '200 OK',
        color: '#4ade80',
        input: { statusCode: 100001 },
        output: { updated: true },
      },
    ],
  },
];

export function FlowRunHistoryView(_props: { repoId?: string }) {
  const [selectedRunId, setSelectedRunId] = useState<string>(DEMO_RUNS[0].id);
  const [selectedStepIdx, setSelectedStepIdx] = useState<number>(0);
  const selectedRun = DEMO_RUNS.find((r) => r.id === selectedRunId) ?? DEMO_RUNS[0];
  const selectedStep = selectedRun.steps[selectedStepIdx] ?? selectedRun.steps[0];

  return (
    <Panel
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>⚡</span>
          <span>Power Automate · Cloud Flow Telemetry & Run Engine</span>
          <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 999, background: '#0066FF', color: '#fff', fontWeight: 600 }}>
            FLOW: {selectedRun.flowId}
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
            <span style={{ fontSize: 11, color: '#38bdf8' }}>5 Succeeded</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}>
            {DEMO_RUNS.map((r) => {
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
            onClick={() => alert(`Re-testing flow ${selectedRun.flowId} with payload from run ${selectedRun.id}`)}
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
