import { Panel } from './Overlays';

export function VisualCvView() {
  return (
    <Panel
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>📋</span>
          <span>Leon's Visual CV · Microsoft AI & Power Platform Specialist</span>
          <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 999, background: '#0078D4', color: '#fff', fontWeight: 600 }}>
            MICROSOFT AI HEAD NERD
          </span>
        </div>
      }
      wide
      accent="#0078D4"
      className="visual-cv-modal"
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '10px 0', minHeight: 600 }}>
        <div style={{ background: '#0f172a', padding: 10, borderRadius: 12, border: '1px solid #334155', maxWidth: '100%', maxHeight: '78vh', overflowY: 'auto', display: 'flex', justifyContent: 'center' }}>
          <img
            src="/Leon-visual-cv.jpg"
            alt="Leon Visual CV"
            style={{
              maxWidth: '100%',
              maxHeight: '75vh',
              objectFit: 'contain',
              borderRadius: 8,
              boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
            }}
          />
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 16, alignItems: 'center' }}>
          <a
            href="/Leon-visual-cv.jpg"
            target="_blank"
            rel="noreferrer"
            style={{
              background: '#0078D4',
              color: '#ffffff',
              padding: '8px 18px',
              borderRadius: 6,
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: 13,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span>↗</span> Open Full Image in New Tab
          </a>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>
            Press <kbd>Esc</kbd> or click ✕ to return to the office
          </span>
        </div>
      </div>
    </Panel>
  );
}
