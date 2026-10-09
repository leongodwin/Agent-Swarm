import { useState, useEffect, useRef } from 'react';
import { useStore, repoOnFloor } from '../store';
import { api } from '../api';
import type { TeamsAdaptiveCard } from '../../../shared/teams';

export function TeamsToastFeed() {
  const [messages, setMessages] = useState<TeamsAdaptiveCard[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [hasNew, setHasNew] = useState(false);

  const repo = useStore((s) => repoOnFloor(s.repos, s.floor));
  const lastSeen = useRef('');
  useEffect(() => {
    setMessages([]); setHasNew(false); lastSeen.current = '';
    let active = true;
    const fetchFeed = () => {
      api.teamsFeed(repo?.id)
        .then((data) => {
          if (active && Array.isArray(data)) {
            setMessages(data);
            if (data[0]?.id && data[0].id !== lastSeen.current) { setHasNew(true); lastSeen.current = data[0].id; }
          }
        })
        .catch(() => {});
    };

    fetchFeed();
    const interval = setInterval(fetchFeed, 8000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [repo?.id]);

  const toggleOpen = () => {
    setIsOpen(!isOpen);
    if (!isOpen) setHasNew(false);
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 96,
        right: 24,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 8,
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      {/* Expanded Card Feed Drawer */}
      {isOpen && (
        <div
          style={{
            width: 360,
            maxHeight: 460,
            background: 'rgba(15, 23, 42, 0.95)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(70, 78, 184, 0.4)',
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45)',
            borderRadius: 12,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              background: 'linear-gradient(90deg, #464EB8 0%, #5B62D6 100%)',
              padding: '10px 14px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              color: '#ffffff',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16 }}>💬</span>
              <span style={{ fontSize: 13, fontWeight: 700 }}>Office notification feed</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#fff',
                fontSize: 16,
                cursor: 'pointer',
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>

          {/* Cards List */}
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
            {messages.length === 0 ? (
              <div style={{ color: '#94a3b8', fontSize: 12, textAlign: 'center', padding: '24px 0' }}>
                No recent Teams notifications.
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  style={{
                    background: '#090e1a',
                    border: '1px solid #1e293b',
                    borderLeft: `4px solid ${m.color}`,
                    borderRadius: 8,
                    padding: 10,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>{m.title}</div>
                    <span style={{ fontSize: 9, background: '#1e293b', color: '#94a3b8', padding: '2px 5px', borderRadius: 4 }}>
                      Adaptive Card
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: '#38bdf8', fontWeight: 600 }}>{m.subtitle}</div>
                  <div style={{ fontSize: 11, color: '#cbd5e1', lineHeight: 1.4 }}>{m.summary}</div>

                  {m.facts.length > 0 && (
                    <div
                      style={{
                        background: '#040814',
                        borderRadius: 6,
                        padding: '6px 8px',
                        display: 'grid',
                        gridTemplateColumns: 'repeat(2, 1fr)',
                        gap: 4,
                        fontSize: 10,
                        marginTop: 2,
                      }}
                    >
                      {m.facts.map((f, i) => (
                        <div key={i}>
                          <span style={{ color: '#64748b', fontWeight: 600 }}>{f.title}: </span>
                          <span style={{ color: '#e2e8f0', fontWeight: 700 }}>{f.value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Floating Pill Toggle */}
      <button
        id="teams-feed-pill-btn"
        onClick={toggleOpen}
        style={{
          background: 'linear-gradient(135deg, #464EB8 0%, #3B429F 100%)',
          color: '#ffffff',
          border: '1.5px solid rgba(255, 255, 255, 0.2)',
          padding: '8px 14px',
          borderRadius: 999,
          fontSize: 12,
          fontWeight: 700,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          boxShadow: '0 4px 14px rgba(70, 78, 184, 0.45)',
          transition: 'all 0.15s ease',
        }}
      >
        <span style={{ fontSize: 14 }}>💬</span>
        <span>Teams Feed {messages.length > 0 ? `(${messages.length})` : ''}</span>
        {hasNew && (
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              background: '#4ade80',
              boxShadow: '0 0 6px #4ade80',
            }}
          />
        )}
      </button>
    </div>
  );
}
