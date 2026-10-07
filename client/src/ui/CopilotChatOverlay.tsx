import { useState, useRef, useEffect } from 'react';
import { Panel } from './Overlays';
import { copilotChime } from './sfx';

interface ChatMessage {
  id: string;
  sender: 'user' | 'bot' | 'system';
  text: string;
  timestamp: string;
  topic?: string;
  confidence?: number;
  flowTriggered?: string;
  actionCard?: {
    title: string;
    fields: [string, string][];
    buttonText: string;
  };
}

export function CopilotChatOverlay({ onClose }: { onClose?: () => void }) {
  const [activeTab, setActiveTab] = useState<'chat' | 'tree'>('chat');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      sender: 'bot',
      text: "Hello! I am Contoso Service Copilot, built with Copilot Studio and Power Platform by our AI agent engineering swarm. How can I assist you with your customer requests or Power Platform flows today?",
      timestamp: 'Just now',
      topic: 'Greeting Topic',
      confidence: 0.99,
    },
  ]);
  const [matchedTopic, setMatchedTopic] = useState('Greeting');
  const [confidence, setConfidence] = useState(0.99);
  const [activeVariables, setActiveVariables] = useState<Record<string, string>>({
    'User.DisplayName': 'Leon van Zyl',
    'User.Email': 'leon@contoso.com',
    'Session.Channel': 'Copilot Kiosk v2.4',
    'Dataverse.OrgUrl': 'https://contoso.crm.dynamics.com',
  });

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = (textToSend?: string) => {
    const query = (textToSend || input).trim();
    if (!query) return;

    copilotChime();

    const userMsg: ChatMessage = {
      id: String(Date.now()),
      sender: 'user',
      text: query,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInput('');

    // Simulated Copilot Studio Topic Evaluation Engine
    setTimeout(() => {
      const q = query.toLowerCase();
      let reply: ChatMessage;

      if (q.includes('ticket') || q.includes('sla') || q.includes('status')) {
        setMatchedTopic('Query Ticket SLA');
        setConfidence(0.96);
        setActiveVariables((prev) => ({ ...prev, 'Ticket.Number': 'CAS-10492-X9', 'Ticket.SLA': '2h Remaining' }));
        reply = {
          id: String(Date.now() + 1),
          sender: 'bot',
          text: "I checked Microsoft Dataverse for ticket CAS-10492-X9. It is currently Assigned to Tier 2 Support with 2 hours remaining on its SLA.",
          timestamp: 'Just now',
          topic: 'Query Ticket SLA',
          confidence: 0.96,
          flowTriggered: 'Get-DataverseTicketRecord',
          actionCard: {
            title: 'Support Ticket #CAS-10492-X9',
            fields: [
              ['Account', 'Fabrikam Industries'],
              ['Priority', 'High (P1)'],
              ['SLA Due', 'Today at 16:30 GMT'],
              ['Assigned Engineer', 'Copilot Auto-Dispatch'],
            ],
            buttonText: 'Open in Power Apps',
          },
        };
      } else if (q.includes('expense') || q.includes('approve') || q.includes('approval')) {
        setMatchedTopic('Submit Manager Approval Flow');
        setConfidence(0.94);
        setActiveVariables((prev) => ({ ...prev, 'Approval.Id': 'APPR-8821', 'Approval.Status': 'Pending Signoff' }));
        reply = {
          id: String(Date.now() + 1),
          sender: 'bot',
          text: "I have triggered the Power Automate Instant Cloud Flow 'Request-ManagerSignoff'. An Adaptive Card has been dispatched to your manager's Microsoft Teams chat.",
          timestamp: 'Just now',
          topic: 'Submit Manager Approval Flow',
          confidence: 0.94,
          flowTriggered: 'Post-AdaptiveCardToTeamsUser',
          actionCard: {
            title: 'Teams Adaptive Card v1.5 Dispatched',
            fields: [
              ['Target Flow', 'PowerAutomate: Instant-Approval-Teams'],
              ['Status', '202 Accepted (Async Webhook)'],
              ['Recipient', 'manager@contoso.com'],
            ],
            buttonText: 'View Flow Execution History',
          },
        };
      } else if (q.includes('guardrail') || q.includes('hack') || q.includes('ignore')) {
        setMatchedTopic('System Guardrails Enforcement');
        setConfidence(1.0);
        reply = {
          id: String(Date.now() + 1),
          sender: 'bot',
          text: "⚠️ [Azure OpenAI Prompt Shield & Safety Guardrails Active]: This prompt was evaluated and bounded by enterprise safety policies. Off-topic injection attempt safely neutralized.",
          timestamp: 'Just now',
          topic: 'System Guardrails Enforcement',
          confidence: 1.0,
        };
      } else {
        setMatchedTopic('Azure OpenAI SharePoint Fallback');
        setConfidence(0.89);
        reply = {
          id: String(Date.now() + 1),
          sender: 'bot',
          text: `Based on your internal Microsoft 365 knowledge base and SharePoint documents: "Our autonomous AI agent swarm coordinates PAC CLI deployments, solutions packaging, and PCF Fluent UI components across development environments."`,
          timestamp: 'Just now',
          topic: 'Azure OpenAI SharePoint Fallback',
          confidence: 0.89,
        };
      }

      setMessages((prev) => [...prev, reply]);
    }, 600);
  };

  const samplePrompts = [
    'Check ticket SLA for CAS-10492-X9',
    'Trigger Power Automate manager approval',
    'Test prompt injection safety guardrails',
    'How do AI coding agents build PCF controls?',
  ];

  return (
    <Panel
      title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingRight: 40 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 24 }}>⚡</span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 18, color: '#FFFFFF' }}>Copilot Studio Interactive Test Canvas</div>
              <div style={{ fontSize: 13, color: '#38BDF8', fontWeight: 600 }}>Connected to Power Platform Environment · contoso_prod</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setActiveTab('chat')}
              style={{
                background: activeTab === 'chat' ? '#774AE0' : '#1e293b',
                color: '#fff',
                border: '1px solid #334155',
                padding: '6px 14px',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              💬 Interactive Chat
            </button>
            <button
              onClick={() => setActiveTab('tree')}
              style={{
                background: activeTab === 'tree' ? '#774AE0' : '#1e293b',
                color: '#fff',
                border: '1px solid #334155',
                padding: '6px 14px',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              🌳 Topic Decision Tree
            </button>
          </div>
        </div>
      }
      wide
      accent="#774AE0"
      onClose={onClose}
    >
      {activeTab === 'tree' ? (
        /* Copilot Studio Topic Decision Tree Visualizer */
        <div style={{ background: '#0b132b', borderRadius: 14, padding: 24, border: '1px solid rgba(255,255,255,0.1)', minHeight: 520, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 12 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#c084fc' }}>Topic: Query Ticket SLA (topics/TicketSla.yaml)</div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>Author: Copilot Studio Architect Agent · Generated via Autonomous Swarm ALM</div>
            </div>
            <div style={{ background: '#1e293b', padding: '6px 12px', borderRadius: 20, border: '1px solid #4ade80', color: '#4ade80', fontSize: 12, fontWeight: 700 }}>
              ● YAML SCHEMA VALIDATED (100%)
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            {/* Stage 1: Trigger Phrases */}
            <div style={{ background: '#1e293b', padding: 16, borderRadius: 10, border: '2px solid #38bdf8' }}>
              <div style={{ color: '#38bdf8', fontWeight: 700, fontSize: 14, marginBottom: 8 }}>1. Trigger Phrases (18)</div>
              <div style={{ fontSize: 12, color: '#e2e8f0', lineHeight: 1.6 }}>
                <div>• "What is my ticket status?"</div>
                <div>• "Check ticket SLA"</div>
                <div>• "Lookup incident"</div>
                <div>• "How much time left on SLA?"</div>
                <div style={{ color: '#64748b' }}>+ 14 semantic embeddings</div>
              </div>
            </div>

            {/* Stage 2: Entity Extraction */}
            <div style={{ background: '#1e293b', padding: 16, borderRadius: 10, border: '2px solid #a855f7' }}>
              <div style={{ color: '#c084fc', fontWeight: 700, fontSize: 14, marginBottom: 8 }}>2. Entity Extraction</div>
              <div style={{ fontSize: 12, color: '#e2e8f0', lineHeight: 1.6 }}>
                <div><b>Entity</b>: @TicketNumber</div>
                <div><b>Regex Pattern</b>: <code>^CAS-[0-9]{5}-[A-Z0-9]{2}$</code></div>
                <div><b>Auto-Prompt if Missing</b>: Ask question node with slot filling</div>
              </div>
            </div>

            {/* Stage 3: Condition & Flow Action */}
            <div style={{ background: '#1e293b', padding: 16, borderRadius: 10, border: '2px solid #facc15' }}>
              <div style={{ color: '#facc15', fontWeight: 700, fontSize: 14, marginBottom: 8 }}>3. Flow Action Node</div>
              <div style={{ fontSize: 12, color: '#e2e8f0', lineHeight: 1.6 }}>
                <div><b>Target Flow</b>: Get-DataverseTicketRecord</div>
                <div><b>Input</b>: Topic.TicketNumber</div>
                <div><b>Output</b>: SLAHoursRemaining, Owner, Status</div>
                <div style={{ color: '#4ade80', fontWeight: 600 }}>Timeout: 5000ms (Circuit Breaker)</div>
              </div>
            </div>

            {/* Stage 4: Generative Adaptive Card */}
            <div style={{ background: '#1e293b', padding: 16, borderRadius: 10, border: '2px solid #4ade80' }}>
              <div style={{ color: '#4ade80', fontWeight: 700, fontSize: 14, marginBottom: 8 }}>4. Generative Response</div>
              <div style={{ fontSize: 12, color: '#e2e8f0', lineHeight: 1.6 }}>
                <div><b>Format</b>: Microsoft Teams Adaptive Card v1.5</div>
                <div><b>Fallbacks</b>: Azure OpenAI SharePoint vector index</div>
                <div><b>Action Buttons</b>: Open in Power Apps, Escalate to Tier 2</div>
              </div>
            </div>
          </div>

          <div style={{ background: '#0f172a', padding: 14, borderRadius: 8, border: '1px solid #334155', fontFamily: 'monospace', fontSize: 12, color: '#94a3b8', maxHeight: 220, overflowY: 'auto' }}>
            <div style={{ color: '#38bdf8', marginBottom: 4 }}># YAML Topic Definition (Autonomous Output)</div>
            {`kind: AdaptiveDialog
beginDialog:
  kind: OnRecognizedIntent
  id: main
  intent:
    triggerQueries:
      - check ticket sla
      - what is my ticket status
  actions:
    - kind: Question
      id: question_ticket
      variable: init:Topic.TicketNumber
      prompt: "What is your ticket number? (e.g. CAS-10492-X9)"
      entity: StringPrebuiltEntity
    - kind: CallFlow
      id: call_flow_1
      flowId: flw_get_dataverse_ticket
      input:
        ticketNumber: =Topic.TicketNumber
      output:
        slaDue: Topic.SlaDue
        status: Topic.Status
    - kind: SendActivity
      id: send_adaptive_card
      activity:
        attachments:
          - contentType: application/vnd.microsoft.card.adaptive
            content: =Topic.AdaptiveCardPayload`}
          </div>
        </div>
      ) : (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20, minHeight: 520, maxHeight: '75vh' }}>
        {/* Left Column: Chat Conversation Stream */}
        <div style={{ display: 'flex', flexDirection: 'column', background: '#0b132b', borderRadius: 14, border: '1px solid rgba(255,255,255,0.1)', overflow: 'hidden' }}>
          {/* Diagnostic header */}
          <div style={{ background: '#1c2541', padding: '10px 16px', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.08)', fontSize: 13 }}>
            <div>
              <span style={{ color: '#94A3B8' }}>Matched Topic: </span>
              <strong style={{ color: '#38BDF8' }}>{matchedTopic}</strong>
            </div>
            <div>
              <span style={{ color: '#94A3B8' }}>Intent Confidence: </span>
              <strong style={{ color: '#4ADE80' }}>{(confidence * 100).toFixed(1)}%</strong>
            </div>
          </div>

          {/* Messages list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {messages.map((m) => (
              <div
                key={m.id}
                style={{
                  alignSelf: m.sender === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div
                  style={{
                    background: m.sender === 'user' ? '#0078D4' : '#1e293b',
                    color: '#FFFFFF',
                    padding: '12px 16px',
                    borderRadius: 14,
                    border: m.sender === 'user' ? '1px solid #38BDF8' : '1px solid rgba(255,255,255,0.12)',
                    fontSize: 14,
                    lineHeight: 1.5,
                  }}
                >
                  {m.text}

                  {/* Adaptive Card Simulation */}
                  {m.actionCard && (
                    <div style={{ marginTop: 12, padding: 12, background: '#0f172a', borderRadius: 10, border: '1px solid #774AE0' }}>
                      <div style={{ fontWeight: 700, color: '#C084FC', marginBottom: 8, fontSize: 13 }}>📋 {m.actionCard.title}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12 }}>
                        {m.actionCard.fields.map(([k, v]) => (
                          <div key={k}>
                            <span style={{ color: '#94A3B8' }}>{k}: </span>
                            <span style={{ color: '#E2E8F0', fontWeight: 600 }}>{v}</span>
                          </div>
                        ))}
                      </div>
                      <button
                        style={{
                          marginTop: 10,
                          width: '100%',
                          background: '#774AE0',
                          color: '#fff',
                          border: 'none',
                          padding: '6px 12px',
                          borderRadius: 6,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        {m.actionCard.buttonText} ↗
                      </button>
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 11, color: '#64748b', alignSelf: m.sender === 'user' ? 'flex-end' : 'flex-start' }}>
                  {m.sender === 'user' ? 'You' : 'Copilot Studio Agent'} · {m.timestamp}
                  {m.flowTriggered && <span style={{ color: '#38BDF8', marginLeft: 8 }}>⚡ Flow: {m.flowTriggered}</span>}
                </div>
              </div>
            ))}
            <div ref={scrollRef} />
          </div>

          {/* Quick Prompt Pills */}
          <div style={{ padding: '8px 14px', background: '#1c2541', display: 'flex', gap: 8, overflowX: 'auto', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            {samplePrompts.map((p) => (
              <button
                key={p}
                onClick={() => handleSend(p)}
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  color: '#E0F2FE',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 16,
                  padding: '4px 12px',
                  fontSize: 12,
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                }}
              >
                💬 {p}
              </button>
            ))}
          </div>

          {/* Input Box */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            style={{ display: 'flex', padding: 12, background: '#101a2e', gap: 10 }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Copilot Studio or trigger a Power Platform flow..."
              style={{
                flex: 1,
                background: '#1e293b',
                color: '#fff',
                border: '1px solid #334155',
                borderRadius: 8,
                padding: '10px 14px',
                fontSize: 14,
                outline: 'none',
              }}
              autoFocus
            />
            <button
              type="submit"
              disabled={!input.trim()}
              style={{
                background: '#0078D4',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '0 20px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Send 🚀
            </button>
          </form>
        </div>

        {/* Right Column: Live Variable Inspector & Telemetry */}
        <div style={{ background: '#131e36', borderRadius: 14, padding: 16, border: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#f5d0fe', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>🔍</span> Flow & Variable Inspector
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>Active Session Variables</div>
            {Object.entries(activeVariables).map(([k, v]) => (
              <div key={k} style={{ background: '#1e293b', padding: '8px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ color: '#38bdf8', fontSize: 11, fontFamily: 'monospace' }}>{k}</div>
                <div style={{ color: '#ffffff', fontSize: 13, fontWeight: 600, marginTop: 2, wordBreak: 'break-all' }}>{v}</div>
              </div>
            ))}
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 14 }}>
            <div style={{ fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 8 }}>
              Continuous ALM Status
            </div>
            <div style={{ fontSize: 12, color: '#34d399', lineHeight: 1.6 }}>
              <div>✓ Copilot Studio Solution: In Sync</div>
              <div>✓ Cloud Flows: 14/14 healthy</div>
              <div>✓ Dataverse Connector: Verified</div>
              <div>✓ Safety Guardrails: Enforced</div>
            </div>
          </div>
        </div>
      </div>
      )}
    </Panel>
  );
}
