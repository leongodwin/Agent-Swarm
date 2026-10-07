import { useState, useEffect } from 'react';
import { fluentChime } from './sfx';

export interface TeamsToast {
  id: string;
  sender: string;
  channel: string;
  title: string;
  body: string;
  time: string;
  badge?: string;
}

const SAMPLE_EVENTS: Omit<TeamsToast, 'id' | 'time'>[] = [
  {
    sender: 'Contoso Copilot Swarm',
    channel: 'IT Escalations & Approvals',
    title: 'Adaptive Card Action Completed',
    body: 'Manager approved fast-track SLA resolution for Ticket #CAS-10492-X9 via Teams card.',
    badge: 'FLOW COMPLETED',
  },
  {
    sender: 'ALM Solution Bot',
    channel: 'Power Platform DevOps',
    title: 'Solution Checker Passed: 100%',
    body: 'Package contoso_copilot_service.zip verified with 0 rule violations. Ready to promote.',
    badge: 'PAC CHECKER',
  },
  {
    sender: 'Copilot Studio Engine',
    channel: 'Agent Swarm Telemetry',
    title: 'New Conversational Topic Deployed',
    body: "Topic 'Query Ticket SLA' compiled with 18 trigger phrases and Dataverse entity slot filling.",
    badge: 'COPILOT STUDIO',
  },
  {
    sender: 'Dataverse Migration Agent',
    channel: 'Enterprise Architecture',
    title: 'Entity Schema Synchronized',
    body: 'cr_ticket and cr_copilotsession schema migration applied to sandbox environment.',
    badge: 'DATAVERSE',
  },
];

/**
 * Microsoft Teams Ambient Notification Toast Feed.
 * Displays realistic Teams desktop notification popups in the bottom-right corner of the HUD,
 * synchronized with synthesized Teams harmonic notification chimes.
 */
export function TeamsToastFeed() {
  const [toasts, setToasts] = useState<TeamsToast[]>([]);

  useEffect(() => {
    // Post initial welcome Teams notification after 3.5s
    const t1 = setTimeout(() => {
      postTeamsNotification(SAMPLE_EVENTS[0]);
    }, 3500);

    // Ambient periodic updates during demo every 35-45 seconds
    const interval = setInterval(() => {
      const ev = SAMPLE_EVENTS[Math.floor(Math.random() * SAMPLE_EVENTS.length)];
      postTeamsNotification(ev);
    }, 42000);

    return () => {
      clearTimeout(t1);
      clearInterval(interval);
    };
  }, []);

  const postTeamsNotification = (ev: Omit<TeamsToast, 'id' | 'time'>) => {
    fluentChime();
    const item: TeamsToast = {
      ...ev,
      id: String(Date.now()),
      time: 'Just now',
    };

    setToasts((prev) => [...prev.slice(-2), item]);

    // Auto dismiss after 7.5 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== item.id));
    }, 7500);
  };

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 96,
        right: 24,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            width: 360,
            background: 'rgba(31, 35, 68, 0.95)',
            backdropFilter: 'blur(16px)',
            border: '1px solid #464EB8',
            borderLeft: '5px solid #6264A7',
            borderRadius: 10,
            boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
            padding: '12px 16px',
            color: '#ffffff',
            pointerEvents: 'auto',
            animation: 'slideInRight 0.3s ease-out',
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  width: 22,
                  height: 22,
                  background: '#5059C9',
                  borderRadius: 4,
                  display: 'grid',
                  placeItems: 'center',
                  fontWeight: 900,
                  fontSize: 12,
                }}
              >
                T
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#c7d2fe' }}>Microsoft Teams</span>
            </div>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>{t.time}</span>
          </div>

          {/* Title */}
          <div style={{ fontWeight: 700, fontSize: 14, color: '#ffffff', marginBottom: 4 }}>
            {t.title}
          </div>

          {/* Body */}
          <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.4, marginBottom: 8 }}>
            {t.body}
          </div>

          {/* Footer Channel Info */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: '#94a3b8' }}>
            <span>📢 {t.channel}</span>
            {t.badge && (
              <span style={{ background: '#312e81', color: '#a5b4fc', padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>
                {t.badge}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
