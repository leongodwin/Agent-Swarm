import { useMemo } from 'react';
import { repoOnFloor, usePhoneBadge, useStore, TOUR_WAYPOINTS } from '../store';
import { CEO_ID } from '../../../shared/types';
import { HeldHint } from './HeldHint';
import { WorkersPanel } from './WorkersPanel';
import { officeUpdateChip } from '../officeUpdate';
import { TeamsToastFeed } from './TeamsToastFeed';

function PresenterTourBar() {
  const tourIndex = useStore((s) => s.tourIndex);
  if (tourIndex == null) return null;
  const waypoint = TOUR_WAYPOINTS[tourIndex];
  if (!waypoint) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(15, 23, 42, 0.94)',
        backdropFilter: 'blur(12px)',
        border: '1.5px solid #38bdf8',
        borderRadius: 14,
        padding: '12px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        boxShadow: '0 10px 35px rgba(0,0,0,0.6), 0 0 20px rgba(56, 189, 248, 0.25)',
        zIndex: 99,
        color: '#fff',
        maxWidth: '90vw',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 24 }}>🎥</span>
        <div>
          <div style={{ fontSize: 11, color: '#38bdf8', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Station {tourIndex + 1} of {TOUR_WAYPOINTS.length} · {waypoint.floor === 0 ? 'Lobby' : `Floor ${waypoint.floor}`}
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#ffffff' }}>{waypoint.title}</div>
          <div style={{ fontSize: 12, color: '#94a3b8', maxWidth: 460 }}>{waypoint.description}</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={() => useStore.getState().prevTourWaypoint()}
          style={{
            background: '#1e293b',
            color: '#fff',
            border: '1px solid #334155',
            padding: '7px 12px',
            borderRadius: 8,
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: 12,
          }}
          title="Previous Station (ArrowLeft or B)"
        >
          ◀ Prev
        </button>
        <button
          onClick={() => useStore.getState().nextTourWaypoint()}
          style={{
            background: '#0284c7',
            color: '#fff',
            border: 'none',
            padding: '7px 16px',
            borderRadius: 8,
            cursor: 'pointer',
            fontWeight: 700,
            fontSize: 12,
          }}
          title="Next Station (ArrowRight or N)"
        >
          Next ▶
        </button>
        <button
          onClick={() => useStore.getState().setTourIndex(null)}
          style={{
            background: 'transparent',
            color: '#94a3b8',
            border: '1px solid #475569',
            padding: '7px 10px',
            borderRadius: 8,
            cursor: 'pointer',
            fontSize: 12,
          }}
          title="Exit Tour (T or WASD)"
        >
          ✕ Exit
        </button>
      </div>
    </div>
  );
}

/** While the office is on its way to updating itself (or restarting to do it); opens the console's Office row. */
function OfficeUpdateChip() {
  const text = useStore((s) => (s.restarting ? '⟳ Office restarting…' : officeUpdateChip(s.officeUpdate)));
  const overlay = useStore((s) => s.overlay);
  const openOverlay = useStore((s) => s.openOverlay);
  if (!text || overlay?.kind === 'manager') return null;
  return (
    <button className="office-chip" onClick={() => openOverlay({ kind: 'manager', tab: 'floors' })} title="The office is updating itself. Open the manager's console">
      {text}
    </button>
  );
}

/** The phone in your pocket: always one key (or click) away, with a badge when the CEO is waiting on you. */
function PhoneButton() {
  const badge = usePhoneBadge();
  const started = useStore((s) => s.started);
  const overlay = useStore((s) => s.overlay);
  const openOverlay = useStore((s) => s.openOverlay);
  const ceo = useStore((s) => s.agents[CEO_ID]);
  if (!started || overlay?.kind === 'phone') return null;
  const busy = ceo?.status === 'working';
  return (
    <button className={`phone-btn ${badge ? 'phone-btn-ring' : ''}`} onClick={() => openOverlay({ kind: 'phone' })} title="Your phone (P)">
      <span className="phone-btn-icon">📱</span>
      {badge > 0 && <span className="badge phone-btn-badge">{badge}</span>}
      <span className="phone-btn-label">
        <kbd>P</kbd> {badge ? `${badge} waiting` : busy ? `${ceo.name} is working` : 'Phone'}
      </span>
    </button>
  );
}

export function HUD() {
  const floor = useStore((s) => s.floor);
  const repos = useStore((s) => s.repos);
  const agents = useStore((s) => s.agents);
  const settings = useStore((s) => s.settings);
  const connected = useStore((s) => s.connected);
  const restarting = useStore((s) => s.restarting);
  const demo = useStore((s) => s.demo);
  const user = useStore((s) => s.user);
  const ghReady = useStore((s) => s.ghReady);
  const ghError = useStore((s) => s.ghError);
  const focus = useStore((s) => s.focus);
  const held = useStore((s) => s.held);
  const overlay = useStore((s) => s.overlay);
  const locked = useStore((s) => s.locked);
  const started = useStore((s) => s.started);
  const travel = useStore((s) => s.travel);
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);

  const repo = floor === 0 ? null : repoOnFloor(repos, floor);
  const running = useMemo(() => Object.values(agents).filter((a) => a.status === 'working' || a.status === 'preparing').length, [agents]);
  const floorAgents = repo ? Object.values(agents).filter((a) => a.repoId === repo.id) : [];
  const qa = useStore((s) => s.qa);
  const floorQa = repo ? Object.values(qa).filter((q) => q.repoId === repo.id) : [];

  return (
    <div className="hud">
      <div className="hud-floor" style={{ ['--accent' as string]: repo?.color ?? '#ff8a5b' }}>
        <div className="floor-num">{repo ? repo.floor : 'G'}</div>
        <div>
          <div className="floor-name">{repo ? repo.fullName : `${settings.companyName || 'Copilot Swarm'} · Lobby`}</div>
          <div className="floor-sub">
            {repo
              ? `${floorAgents.length} agents · ${floorAgents.filter((a) => a.status === 'working' || a.status === 'preparing').length} working · ${floorQa.filter((q) => q.status !== 'passed').length} in QA · ${floorQa.filter((q) => q.status === 'passed').length} ready to merge`
              : `${repos.length} floor${repos.length === 1 ? '' : 's'} connected`}
          </div>
        </div>
      </div>

      <div className="hud-status">
        {demo && <span className="pill pill-demo">DEMO</span>}
        <span className={`pill ${connected ? 'pill-ok' : restarting ? 'pill-demo' : 'pill-bad'}`}>{connected ? '● live' : restarting ? '○ restarting' : '○ reconnecting'}</span>
        <button
          className="pill"
          onClick={() => useStore.getState().toggleLightMode()}
          style={{ cursor: 'pointer', background: 'rgba(255, 255, 255, 0.12)', border: '1px solid rgba(255, 255, 255, 0.2)' }}
          title="Toggle Daylight / Keynote Lighting (or press K)"
        >
          {useStore((s) => s.lightMode === 'keynote' ? '🌙 Keynote' : '☀️ Daylight')} <kbd style={{ marginLeft: 4, fontSize: '0.7em' }}>K</kbd>
        </button>
        <button
          className="pill"
          onClick={() => useStore.getState().toggleTour()}
          style={{
            cursor: 'pointer',
            background: useStore((s) => s.tourIndex !== null) ? '#0284c7' : 'rgba(255, 255, 255, 0.12)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            color: '#fff',
            fontWeight: 600,
          }}
          title="Presenter Tour Mode (or press T)"
        >
          🎥 Tour <kbd style={{ marginLeft: 4, fontSize: '0.7em' }}>T</kbd>
        </button>
        <span className="pill">
          ⚙️ {settings.sessionLimit ? `${running}/${settings.sessionLimit}` : running} sessions
        </span>
        {user && <span className="pill">🐙 {user}</span>}
      </div>

      <PresenterTourBar />

      <WorkersPanel />
      <OfficeUpdateChip />

      {!ghReady && ghError && <div className="hud-banner">⚠️ {ghError}</div>}

      {started && !overlay && !travel && <div className={`crosshair ${focus ? 'crosshair-hot' : ''}`} />}
      {started && !overlay && focus && (
        <div className="hud-hint">
          <kbd>E</kbd> {!held && <>/ <kbd>Click</kbd> </>}
          {focus.label}
        </div>
      )}
      {started && !overlay && !travel && <HeldHint />}
      {started && !overlay && !locked && !travel && <div className="hud-resume">Click to look around</div>}
      {started && !(settings.setupDone && settings.tutorialStep >= 0) && (
        <div className="hud-help">
          <kbd>WASD</kbd> move · <kbd>Shift</kbd> run · <kbd>E</kbd> / <kbd>Click</kbd> interact · <kbd>K</kbd> lighting · <kbd>P</kbd> phone · <kbd>Tab</kbd> workers · <kbd>H</kbd> help · <kbd>Esc</kbd> free mouse
        </div>
      )}

      <div className={`fade ${travel?.phase === 'closing' ? 'fade-in' : ''}`}>
        {travel && <div className="fade-label">{travel.to === 0 ? 'Lobby' : `Floor ${travel.to}`}</div>}
      </div>

      <PhoneButton />
      {demo && <TeamsToastFeed />}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.level}`} onClick={() => dismiss(t.id)}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
