import { useState, useRef, useEffect } from 'react';
import { Panel } from './Overlays';
import { copilotChime } from './sfx';
import { api } from '../api';

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
      text: "This is a scripted simulation. I am Contoso Service Copilot, built with Copilot Studio and Power Platform by our AI agent engineering swarm. How can I assist you with your customer requests or Power Platform flows today?",
      timestamp: 'Just now',
      topic: 'Greeting Topic',
      confidence: 0.99,
    },
  ]);
  const [matchedTopic, setMatchedTopic] = useState('Greeting');
  const [confidence, setConfidence] = useState(0.99);
  const [selectedStage, setSelectedStage] = useState<number>(1);
  const [showDirectLineInspector, setShowDirectLineInspector] = useState(false);
  const [environmentName, setEnvironmentName] = useState('Loading connected environment…');
  const [activeVariables, setActiveVariables] = useState<Record<string, string>>({
    'User.DisplayName': 'Not configured',
    'User.Email': 'Not configured',
    'Session.Channel': 'Copilot Kiosk v2.4',
    'Dataverse.OrgUrl': 'Loading…',
  });

  useEffect(() => {
    let cancelled = false;
    api.tenancy().then((tenancy) => {
      if (cancelled) return;
      const environment = tenancy.environments.find((env) => env.active);
      setEnvironmentName(environment?.name || 'No connected environment');
      setActiveVariables((prev) => ({
        ...prev,
        'Dataverse.OrgUrl': environment?.url || 'No connected environment',
        'User.Email': tenancy.user || 'Not configured',
      }));
    }).catch(() => {
      if (cancelled) return;
      setEnvironmentName('Connected environment unavailable');
      setActiveVariables((prev) => ({ ...prev, 'Dataverse.OrgUrl': 'Unavailable' }));
    });
    return () => { cancelled = true; };
  }, []);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => () => { for (const timer of timers.current) clearTimeout(timer); timers.current.clear(); }, []);
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
    const timer = setTimeout(() => {
      timers.current.delete(timer);
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

      reply.text = `Simulated response (no external action): ${reply.text}`;
      setMessages((prev) => [...prev, reply]);
    }, 600);
    timers.current.add(timer);
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
              <div style={{ fontWeight: 800, fontSize: 18, color: '#FFFFFF' }}>Copilot Studio Simulated Test Canvas</div>
              <div style={{ fontSize: 13, color: '#38BDF8', fontWeight: 600 }}>Simulation · Environment reference: {environmentName}</div>
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
            <div
              onClick={() => setSelectedStage(1)}
              style={{
                background: selectedStage === 1 ? 'rgba(56, 189, 248, 0.15)' : '#1e293b',
                padding: 16,
                borderRadius: 10,
                border: selectedStage === 1 ? '2px solid #38bdf8' : '1px solid rgba(255,255,255,0.1)',
                boxShadow: selectedStage === 1 ? '0 0 16px rgba(56, 189, 248, 0.35)' : 'none',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ color: '#38bdf8', fontWeight: 700, fontSize: 14, marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                <span>1. Trigger Phrases</span>
                {selectedStage === 1 && <span style={{ fontSize: 11 }}>● ACTIVE</span>}
              </div>
              <div style={{ fontSize: 12, color: '#e2e8f0', lineHeight: 1.6 }}>
                <div>• "What is my ticket status?"</div>
                <div>• "Check ticket SLA"</div>
                <div>• "Lookup incident"</div>
                <div style={{ color: '#64748b', marginTop: 4 }}>+ 14 semantic embeddings</div>
              </div>
            </div>

            {/* Stage 2: Entity Extraction */}
            <div
              onClick={() => setSelectedStage(2)}
              style={{
                background: selectedStage === 2 ? 'rgba(192, 132, 252, 0.15)' : '#1e293b',
                padding: 16,
                borderRadius: 10,
                border: selectedStage === 2 ? '2px solid #c084fc' : '1px solid rgba(255,255,255,0.1)',
                boxShadow: selectedStage === 2 ? '0 0 16px rgba(192, 132, 252, 0.35)' : 'none',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ color: '#c084fc', fontWeight: 700, fontSize: 14, marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                <span>2. Entity Extraction</span>
                {selectedStage === 2 && <span style={{ fontSize: 11 }}>● ACTIVE</span>}
              </div>
              <div style={{ fontSize: 12, color: '#e2e8f0', lineHeight: 1.6 }}>
                <div><b>Entity</b>: @TicketNumber</div>
                <div><b>Regex</b>: <code>^CAS-[0-9]{5}-[A-Z0-9]{2}$</code></div>
                <div style={{ color: '#94a3b8', marginTop: 4 }}>Auto-slot filling prompt</div>
              </div>
            </div>

            {/* Stage 3: Condition & Flow Action */}
            <div
              onClick={() => setSelectedStage(3)}
              style={{
                background: selectedStage === 3 ? 'rgba(250, 204, 21, 0.15)' : '#1e293b',
                padding: 16,
                borderRadius: 10,
                border: selectedStage === 3 ? '2px solid #facc15' : '1px solid rgba(255,255,255,0.1)',
                boxShadow: selectedStage === 3 ? '0 0 16px rgba(250, 204, 21, 0.35)' : 'none',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ color: '#facc15', fontWeight: 700, fontSize: 14, marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                <span>3. Flow Action Node</span>
                {selectedStage === 3 && <span style={{ fontSize: 11 }}>● ACTIVE</span>}
              </div>
              <div style={{ fontSize: 12, color: '#e2e8f0', lineHeight: 1.6 }}>
                <div><b>Target Flow</b>: flw_get_dataverse_ticket</div>
                <div><b>Input</b>: Topic.TicketNumber</div>
                <div style={{ color: '#4ade80', fontWeight: 600, marginTop: 4 }}>Dataverse SLA Table</div>
              </div>
            </div>

            {/* Stage 4: Generative Adaptive Card */}
            <div
              onClick={() => setSelectedStage(4)}
              style={{
                background: selectedStage === 4 ? 'rgba(74, 222, 128, 0.15)' : '#1e293b',
                padding: 16,
                borderRadius: 10,
                border: selectedStage === 4 ? '2px solid #4ade80' : '1px solid rgba(255,255,255,0.1)',
                boxShadow: selectedStage === 4 ? '0 0 16px rgba(74, 222, 128, 0.35)' : 'none',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ color: '#4ade80', fontWeight: 700, fontSize: 14, marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                <span>4. Generative Response</span>
                {selectedStage === 4 && <span style={{ fontSize: 11 }}>● ACTIVE</span>}
              </div>
              <div style={{ fontSize: 12, color: '#e2e8f0', lineHeight: 1.6 }}>
                <div><b>Format</b>: Adaptive Card v1.5</div>
                <div><b>Fallbacks</b>: Azure OpenAI SharePoint</div>
                <div style={{ color: '#38bdf8', marginTop: 4 }}>Direct Line WebChat + Teams</div>
              </div>
            </div>
          </div>

          {/* Dynamic Node Inspector for Selected Stage */}
          <div style={{ background: '#111827', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>
                🔍 Topic Node Inspector: Stage {selectedStage}
              </div>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>Click any stage card above to inspect Power Fx expressions</span>
            </div>

            {selectedStage === 1 && (
              <div style={{ fontSize: 12, color: '#cbd5e1', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div><b>Node Kind:</b> <code>OnRecognizedIntent</code> · Intent Trigger: <code>Query Ticket SLA</code></div>
                <div><b>Power Fx Trigger Condition:</b> <code style={{ color: '#38bdf8' }}>=Activity.Confidence &gt;= 0.85 &amp;&amp; !IsBlank(Activity.Text)</code></div>
                <div><b>Direct Line Event:</b> <code>message.received</code> via DirectLine channel</div>
              </div>
            )}

            {selectedStage === 2 && (
              <div style={{ fontSize: 12, color: '#cbd5e1', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div><b>Node Kind:</b> <code>QuestionNode (SlotFilling)</code> · Target Variable: <code>Topic.TicketNumber</code></div>
                <div><b>Power Fx Extraction Formula:</b> <code style={{ color: '#c084fc' }}>=Set(Topic.TicketNumber, Coalesce(Match(Activity.Text, "CAS-[0-9]{5}-[A-Z0-9]{2}").FullMatch, "PROMPT_USER"))</code></div>
                <div><b>Validation Behavior:</b> Reprompts if invalid after 3 attempts, with fallback to human escalation.</div>
              </div>
            )}

            {selectedStage === 3 && (
              <div style={{ fontSize: 12, color: '#cbd5e1', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div><b>Node Kind:</b> <code>CallFlowAction</code> · Flow ID: <code>flw_get_dataverse_ticket</code></div>
                <div><b>Power Fx Flow Invocation:</b> <code style={{ color: '#facc15' }}>=flw_get_dataverse_ticket.Run(Topic.TicketNumber, System.User.Email)</code></div>
                <div><b>Output Bindings:</b> <code>Topic.SlaDue</code>, <code>Topic.Status</code>, <code>Topic.Owner</code> from Microsoft Dataverse table <code>cr_ticket</code>.</div>
              </div>
            )}

            {selectedStage === 4 && (
              <div style={{ fontSize: 12, color: '#cbd5e1', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div><b>Node Kind:</b> <code>SendActivity (AdaptiveCardAttachment)</code></div>
                <div><b>Power Fx Card Payload:</b> <code style={{ color: '#4ade80' }}>=RenderAdaptiveCard(Topic.TicketDetails, "CustomerServiceTicketSummary")</code></div>
                <div><b>Channel Rendering:</b> Dispatched via Direct Line 3.0 protocol payload with action buttons (Power Apps deep link & Escalate).</div>
              </div>
            )}
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

          {/* Direct Line v3.0 Protocol Status Bar */}
          <div style={{ background: 'rgba(2, 6, 23, 0.75)', padding: '6px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: 11 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: '#f59e0b', boxShadow: '0 0 6px #f59e0b' }} />
              <span style={{ color: '#f59e0b', fontWeight: 700 }}>⚠ SIMULATED DIRECT LINE</span>
              <span style={{ color: '#64748b' }}>·</span>
              <span style={{ color: '#94a3b8' }}>Local topic matcher, no Copilot Studio connection</span>
            </div>
            <button
              onClick={() => setShowDirectLineInspector(!showDirectLineInspector)}
              style={{
                background: showDirectLineInspector ? '#774AE0' : 'rgba(255,255,255,0.08)',
                color: '#fff',
                border: 'none',
                padding: '2px 8px',
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {showDirectLineInspector ? 'Hide Activity JSON' : 'Inspect DirectLine JSON'}
            </button>
          </div>

          {showDirectLineInspector && (
            <div style={{ background: '#020617', padding: '10px 16px', borderBottom: '1px solid #334155', maxHeight: 120, overflowY: 'auto', fontFamily: 'monospace', fontSize: 10, color: '#94a3b8' }}>
              <span style={{ color: '#38bdf8' }}>// Latest Bot Framework Activity Payload:</span>
              <pre style={{ margin: 0 }}>
                {JSON.stringify(
                  {
                    type: 'message',
                    id: messages[messages.length - 1]?.id,
                    timestamp: new Date().toISOString(),
                    channelId: 'directline',
                    from: { id: messages[messages.length - 1]?.sender, name: messages[messages.length - 1]?.sender === 'user' ? 'Leon' : 'Contoso Copilot' },
                    conversation: { id: 'conv-contoso-kiosk-94b2' },
                    text: messages[messages.length - 1]?.text,
                    channelData: { topic: matchedTopic, confidence },
                  },
                  null,
                  2
                )}
              </pre>
            </div>
          )}

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
