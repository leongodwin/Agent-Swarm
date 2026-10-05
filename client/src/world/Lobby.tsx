import { useMemo } from 'react';
import * as THREE from 'three';
import { Billboard } from '@react-three/drei';
import { pendingRequests, useStore, type Agent } from '../store';
import { CEO_ID, type HireRequestView } from '../../../shared/types';
import { Character } from './Character';
import { Desk } from './Desk';
import { drawCandidateTag, drawSign, roundRect, SANS } from './draw';
import { Elevator } from './Elevator';
import { useCanvasTexture, useInteractable } from './interact';
import { CEO_DESK, CEO_ROOM, HALF_D, HALF_W, MANAGER_DESK, MANAGER_ROOM, RECEPTION, WAITING, WAITING_ROTATION } from './layout';
import { acousticFabric, brushedMetal, cyberGlow, glow, pbrWood, shade } from './materials';
import { WallSign } from './OfficeFloor';
import { Couch, CoffeeTable, GlassWall, LivingMossWall, Plant, Rug, WallClock } from './Props';
import { Shell } from './Shell';
import { Ball, Box, Cyl } from './Toon';
import { Toys } from './toys';
import { FluentIconMesh, MicrosoftWallBanner } from './FluentIcons';
import { CopilotKiosk } from './CopilotKiosk';
import { DlpSecurityKiosk } from './DlpSecurityKiosk';
import { CoffeeSteam, HolographicSpire } from './ParticleFx';

// Microsoft Fluent UI Inspired Palette: Fluent Electric Blue & Copilot Purple
const ACCENT = '#0078D4'; // Fluent Accent Blue
const CEO_ACCENT = '#774AE0'; // Copilot Studio Violet

function useOfficeStats() {
  const repos = useStore((s) => s.repos);
  const agents = useStore((s) => s.agents);
  const settings = useStore((s) => s.settings);
  const qa = useStore((s) => s.qa);
  const requests = useStore((s) => s.requests);
  return useMemo(() => {
    const list = Object.values(agents);
    const working = list.filter((a) => a.status === 'working' || a.status === 'preparing').length;
    const openPrs = repos.reduce((n, r) => n + r.pulls.filter((p) => p.state === 'OPEN').length, 0);
    const merged = repos.reduce((n, r) => n + r.pulls.filter((p) => p.state === 'MERGED').length, 0);
    const issues = repos.reduce((n, r) => n + r.issues.length, 0);
    const floors = repos.map((r) => ({
      floor: r.floor,
      name: r.fullName,
      color: r.color,
      team: list.filter((a) => a.repoId === r.id).length,
      working: list.filter((a) => a.repoId === r.id && (a.status === 'working' || a.status === 'preparing')).length,
      prs: r.pulls.filter((p) => p.state === 'OPEN').length,
    }));
    const qaList = Object.values(qa);
    const inQa = qaList.filter((q) => q.status !== 'passed').length;
    const readyToMerge = qaList.filter((q) => q.status === 'passed').length;
    const pending = pendingRequests(requests).length;
    return { repos: repos.length, agents: list.length, working, openPrs, inQa, readyToMerge, merged, issues, floors, max: settings.sessionLimit, pending };
  }, [repos, agents, settings, qa, requests]);
}

function ManagerComputer() {
  const stats = useOfficeStats();
  const ref = useInteractable<THREE.Group>({ id: 'manager-console', label: "Open the manager's console", action: { kind: 'manager' } }, 3.2);
  const tex = useCanvasTexture(
    1024,
    640,
    (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 1024, 640);
      g.addColorStop(0, '#101a2e');
      g.addColorStop(0.5, '#192038');
      g.addColorStop(1, '#2d1845');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 1024, 640);
      ctx.fillStyle = '#60a5fa';
      ctx.font = `700 50px ${SANS}`;
      ctx.textBaseline = 'middle';
      ctx.fillText('⚡ Microsoft AI Manager Console', 50, 70);
      const rows: [string, string][] = [
        ['Floors (repos)', `${stats.repos}`],
        ['Agents on staff', `${stats.agents}`],
        ['Sessions running', stats.max ? `${stats.working} / ${stats.max}` : `${stats.working}`],
        ['Open issues', `${stats.issues}`],
        ['PRs in QA / ready to merge', `${stats.inQa} / ${stats.readyToMerge}`],
        ['📄 Hiring decisions waiting', `${stats.pending}`],
      ];
      rows.forEach(([k, v], i) => {
        const y = 150 + i * 68;
        roundRect(ctx, 50, y - 30, 924, 60, 16);
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.fill();
        ctx.fillStyle = '#c9c9ee';
        ctx.font = `500 34px ${SANS}`;
        ctx.fillText(k, 76, y);
        ctx.fillStyle = '#ffffff';
        ctx.font = `700 38px ${SANS}`;
        ctx.textAlign = 'right';
        ctx.fillText(v, 948, y);
        ctx.textAlign = 'left';
      });
      ctx.fillStyle = '#7CFFB2';
      ctx.font = `600 32px ${SANS}`;
      ctx.fillText('Press E or click to manage floors, team & issues', 50, 592);
    },
    [stats],
  );
  return (
    <group ref={ref} position={[MANAGER_DESK.x, 0, MANAGER_DESK.z]}>
      <Box size={[MANAGER_DESK.w, 0.08, MANAGER_DESK.d]} position={[0, 0.76, 0]} color="#8d5a3b" outline />
      <Box size={[MANAGER_DESK.w - 0.1, 0.72, 0.06]} position={[0, 0.37, -MANAGER_DESK.d / 2 + 0.05]} color="#6f4530" />
      <Box size={[0.08, 0.72, MANAGER_DESK.d - 0.1]} position={[-MANAGER_DESK.w / 2 + 0.08, 0.37, 0]} color="#6f4530" />
      <Box size={[0.08, 0.72, MANAGER_DESK.d - 0.1]} position={[MANAGER_DESK.w / 2 - 0.08, 0.37, 0]} color="#6f4530" />
      {/* big monitor facing the door */}
      <Box size={[0.1, 0.34, 0.1]} position={[0, 0.97, -0.15]} color="#adb5bd" />
      <Box size={[0.4, 0.03, 0.26]} position={[0, 0.815, -0.15]} color="#adb5bd" outline />
      <Box size={[1.42, 0.92, 0.06]} position={[0, 1.55, -0.18]} color="#343a40" outline />
      <mesh position={[0, 1.55, -0.145]}>
        <planeGeometry args={[1.34, 0.84]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
      <Box size={[0.5, 0.025, 0.16]} position={[0, 0.815, 0.25]} color="#f4f4f8" outline />
      <Cyl r={0.05} h={0.11} position={[0.9, 0.855, 0.1]} color="#ffd166" outline />
      <CoffeeSteam position={[0.9, 0.93, 0.1]} />
      <Box size={[0.3, 0.2, 0.03]} position={[-0.95, 0.9, -0.1]} rotation={[-0.3, 0.3, 0]} color="#e9c46a" outline />
      {/* manager chair (yours) */}
      <group position={[0, 0, -1.1]}>
        <Box size={[0.64, 0.12, 0.6]} position={[0, 0.48, 0]} color="#2b2d42" outline />
        <Box size={[0.62, 0.8, 0.12]} position={[0, 0.95, -0.3]} color="#2b2d42" outline />
        <Cyl r={0.04} h={0.4} position={[0, 0.22, 0]} color="#6c757d" />
        <Cyl r={0.3} h={0.04} position={[0, 0.03, 0]} color="#6c757d" />
      </group>
    </group>
  );
}

/** 3D Interactive Visual CV Showcase on the Manager's Office Wall */
function ManagerVisualCv({ position, rotationY = Math.PI / 2 }: { position: [number, number, number]; rotationY?: number }) {
  const ref = useInteractable<THREE.Group>({ id: 'manager-visual-cv', label: "Inspect Leon's Visual CV (E)", action: { kind: 'visual-cv' } }, 5);
  const tex = useMemo(() => {
    const loader = new THREE.TextureLoader();
    const t = loader.load('/Leon-visual-cv.jpg?v=2');
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  const w = 4.2;
  const h = 2.6;

  return (
    <group ref={ref} position={position} rotation={[0, rotationY, 0]}>
      {/* Premium Backing Board with Fluent Shadow Frame */}
      <Box size={[w + 0.16, h + 0.16, 0.06]} position={[0, 1.55, 0]} color="#1e293b" outline />
      {/* Visual CV Image Plane */}
      <mesh position={[0, 1.55, 0.035]}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
      {/* Acrylic Bottom Accent Shelf */}
      <mesh position={[0, 0.22, 0.06]}>
        <boxGeometry args={[w, 0.05, 0.12]} />
        <meshBasicMaterial color="#0078D4" />
      </mesh>
    </group>
  );
}

/** Interactive Boardroom Swarm Ideation Table with Stadium Curvature & Holographic Studio */
function WarRoomTable() {
  const ref = useInteractable<THREE.Group>(
    {
      id: 'war-room-ideator',
      label: 'Enter Swarm Ideation Studio (E)',
      action: { kind: 'war-room-ideator' },
    },
    4.5,
  );

  return (
    <group ref={ref}>
      {/* Organic Stadium Curved Executive Boardroom Table */}
      {/* Central rectangular core */}
      <mesh position={[0, 0.74, 0]} material={pbrWood('#1e293b', 0.28)}>
        <boxGeometry args={[2.4, 0.08, 1.4]} />
      </mesh>
      {/* Rounded half-cylinder endcaps giving a luxurious stadium/racetrack table silhouette */}
      {[-1.2, 1.2].map((x, i) => (
        <mesh key={i} position={[x, 0.74, 0]} rotation={[0, 0, 0]} material={pbrWood('#1e293b', 0.28)}>
          <cylinderGeometry args={[0.7, 0.7, 0.08, 24, 1, false, i === 0 ? Math.PI / 2 : -Math.PI / 2, Math.PI]} />
        </mesh>
      ))}

      {/* Perimeter Brushed Champagne Brass Accent Edge */}
      <mesh position={[0, 0.71, 0]} material={brushedMetal('#d4af37', 0.2)}>
        <boxGeometry args={[2.42, 0.02, 1.42]} />
      </mesh>

      {/* Sculptural Twin Fluted Pedestal Bases */}
      {[-1.0, 1.0].map((x, i) => (
        <group key={i} position={[x, 0, 0]}>
          <mesh position={[0, 0.35, 0]} material={brushedMetal('#334155', 0.3)}>
            <cylinderGeometry args={[0.28, 0.36, 0.7, 24]} />
          </mesh>
          <mesh position={[0, 0.02, 0]} material={brushedMetal('#d4af37', 0.2)}>
            <cylinderGeometry args={[0.38, 0.38, 0.04, 24]} />
          </mesh>
        </group>
      ))}

      {/* Central Holographic Multi-Agent Projector Base */}
      <mesh position={[0, 0.79, 0]} material={brushedMetal('#0f172a')}>
        <cylinderGeometry args={[0.36, 0.4, 0.04, 28]} />
      </mesh>
      <mesh position={[0, 0.81, 0]} material={cyberGlow('#0078d4', 3.0)}>
        <ringGeometry args={[0.3, 0.35, 32]} />
      </mesh>

      {/* Dynamic Holographic Spire with orbiting data rings & floating particle dust */}
      <HolographicSpire position={[0, 0, 0]} />
    </group>
  );
}

function Directory() {
  const stats = useOfficeStats();
  const ref = useInteractable<THREE.Group>({ id: 'directory', label: 'Floor directory — take the elevator', action: { kind: 'elevator' } }, 4);
  const tex = useCanvasTexture(
    768,
    560,
    (ctx) => {
      roundRect(ctx, 0, 0, 768, 560, 30);
      ctx.fillStyle = '#23263a';
      ctx.fill();
      ctx.fillStyle = '#ffd6a5';
      ctx.font = `700 46px ${SANS}`;
      ctx.textBaseline = 'middle';
      ctx.fillText('Directory', 36, 52);
      const floors = [...stats.floors].sort((a, b) => b.floor - a.floor).slice(0, 7);
      floors.forEach((f, i) => {
        const y = 118 + i * 58;
        ctx.fillStyle = f.color;
        roundRect(ctx, 36, y - 22, 54, 44, 12);
        ctx.fill();
        ctx.fillStyle = '#1f2233';
        ctx.font = `700 30px ${SANS}`;
        ctx.textAlign = 'center';
        ctx.fillText(String(f.floor), 63, y + 1);
        ctx.textAlign = 'left';
        ctx.fillStyle = '#ffffff';
        ctx.font = `600 28px ${SANS}`;
        const name = f.name.length > 24 ? `${f.name.slice(0, 23)}…` : f.name;
        ctx.fillText(name, 108, y);
        ctx.fillStyle = '#a9adc6';
        ctx.font = `500 24px ${SANS}`;
        ctx.textAlign = 'right';
        ctx.fillText(`${f.working}/${f.team} busy · ${f.prs} PR`, 740, y);
        ctx.textAlign = 'left';
      });
      const gy = 118 + floors.length * 58;
      ctx.fillStyle = ACCENT;
      roundRect(ctx, 36, gy - 22, 54, 44, 12);
      ctx.fill();
      ctx.fillStyle = '#1f2233';
      ctx.font = `700 30px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.fillText('G', 63, gy + 1);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffffff';
      ctx.font = `600 28px ${SANS}`;
      ctx.fillText("Lobby & manager's office", 108, gy);
      if (stats.floors.length === 0) {
        ctx.fillStyle = '#a9adc6';
        ctx.font = `500 26px ${SANS}`;
        ctx.fillText('No floors yet: connect a repo in the', 36, gy + 80);
        ctx.fillText("manager's office (back left corner).", 36, gy + 116);
      }
    },
    [stats],
  );
  return (
    <group ref={ref} position={[4.4, 1.75, HALF_D - 0.03]} rotation={[0, Math.PI, 0]}>
      <mesh>
        <planeGeometry args={[2.6, 1.9]} />
        <meshBasicMaterial map={tex} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}

function TrophyCabinet() {
  const stats = useOfficeStats();
  const tex = useCanvasTexture(
    512,
    160,
    (ctx) => drawSign(ctx, 512, 160, [{ text: `🏆 ${stats.merged} PRs merged`, size: 50, color: '#2d3142' }], '#ffe8a3'),
    [stats.merged],
  );
  const cups = Math.min(8, stats.merged);
  return (
    <group position={[12, 0, -HALF_D + 0.55]}>
      <Box size={[4.4, 2.1, 1]} position={[0, 1.05, 0]} color="#b08968" outline />
      <Box size={[4.1, 1.2, 0.8]} position={[0, 1.2, 0.12]} color="#fdf6e3" shadow={false} />
      <Box size={[4.1, 0.04, 0.8]} position={[0, 1.2, 0.12]} color="#b08968" shadow={false} />
      {Array.from({ length: cups }, (_, i) => (
        <group key={i} position={[-1.7 + (i % 4) * 1.1, i < 4 ? 0.62 : 1.22, 0.2]}>
          <Cyl r={0.08} rTop={0.16} h={0.22} position={[0, 0.2, 0]} color="#ffd43b" outline />
          <Cyl r={0.03} h={0.1} position={[0, 0.05, 0]} color="#ffd43b" />
          <Box size={[0.2, 0.04, 0.2]} position={[0, 0.01, 0]} color="#495057" />
        </group>
      ))}
      <mesh position={[0, 2.45, 0.02]}>
        <planeGeometry args={[2.4, 0.75]} />
        <meshBasicMaterial map={tex} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}

/** The CEO's wall screen: what they're doing, what's next, and who's waiting to be hired. */
function CeoBoard() {
  const ceo = useStore((s) => s.agents[CEO_ID]);
  const info = useStore((s) => s.ceo);
  const requests = useStore((s) => s.requests);
  const pending = pendingRequests(requests).length;
  const now = ceo?.status === 'working' ? (info.job?.label ?? 'Working') : 'Free for a chat (press P)';
  const next = info.queue.length ? `${info.queue[0].label}${info.queue.length > 1 ? ` (+${info.queue.length - 1})` : ''}` : 'nothing queued';
  return (
    <WallSign
      position={[HALF_W - 0.03, 2.05, CEO_DESK.z]}
      rotationY={-Math.PI / 2}
      size={[3.4, 1.9]}
      px={[816, 456]}
      draw={(ctx) =>
        drawSign(
          ctx,
          816,
          456,
          [
            { text: `🧠 ${ceo?.name ?? 'CEO'}'s board`, size: 54 },
            { text: `Now: ${now}`, size: 36, weight: 600 },
            { text: `Next: ${next}`, size: 32, weight: 500, color: 'rgba(255,255,255,0.8)' },
            { text: pending ? `📄 ${pending} candidate${pending === 1 ? '' : 's'} waiting for you` : '📄 no candidates waiting', size: 34, weight: 600, color: pending ? '#ffe066' : '#ffffff' },
          ],
          '#3c2a63',
        )
      }
      deps={[ceo?.name, now, next, pending]}
    />
  );
}

function CeoOffice() {
  const c = CEO_ROOM;
  const ceo = useStore((s) => s.agents[CEO_ID]);
  return (
    <group>
      <Rug position={[(c.minX + c.maxX) / 2, 0.005, (c.minZ + c.maxZ) / 2]} size={[c.maxX - c.minX, c.maxZ - c.minZ]} color="#e6dcff" />
      <GlassWall from={[c.minX, c.minZ]} to={[c.minX, c.maxZ]} />
      <GlassWall from={[c.minX, c.maxZ]} to={[c.doorMinX, c.maxZ]} />
      <GlassWall from={[c.doorMaxX, c.maxZ]} to={[c.maxX, c.maxZ]} />
      <Box size={[c.doorMaxX - c.doorMinX, 0.5, 0.1]} position={[(c.doorMinX + c.doorMaxX) / 2, 2.55, c.maxZ]} color="#8d99ae" />
      <WallSign
        position={[(c.doorMinX + c.doorMaxX) / 2, 3.1, c.maxZ + 0.06]}
        rotationY={0}
        size={[3.4, 0.5]}
        px={[816, 120]}
        draw={(ctx) => drawSign(ctx, 816, 120, [{ text: `CEO${ceo ? ` · ${ceo.name}` : ''}`, size: 52 }], CEO_ACCENT)}
        deps={[ceo?.name]}
      />
      {ceo && <Desk agent={ceo} accent={CEO_ACCENT} repoId="" position={[CEO_DESK.x, 0, CEO_DESK.z]} />}
      <CeoBoard />
      <FluentIconMesh name="copilot" size={0.4} position={[c.maxX - 0.05, 2.2, CEO_DESK.z - 1.5]} rotation={[0, -Math.PI / 2, 0]} showLabel />
      <Plant position={[c.maxX - 0.7, 0, c.maxZ - 0.7]} scale={1.1} pot={CEO_ACCENT} />
      <Plant position={[c.minX + 0.6, 0, c.maxZ - 0.6]} scale={0.9} />
    </group>
  );
}

/** A pending hire as a person: the look they'll have once hired, sitting in the waiting room. */
function candidateAgent(r: HireRequestView): Agent {
  return {
    id: r.id,
    name: r.name,
    repoId: r.repoId,
    role: r.role,
    title: r.title,
    specialty: r.specialty,
    brief: r.brief,
    hiredBy: 'ceo',
    look: r.look,
    task: null,
    desk: 0,
    color: r.color,
    hair: r.hair,
    skin: r.skin,
    model: r.model,
    effort: r.effort,
    cli: '',
    terminal: false,
    status: 'idle',
    issueNumber: null,
    issueTitle: null,
    branch: null,
    prNumber: null,
    prUrl: null,
    currentTool: null,
    startedAt: null,
    endedAt: null,
    costUsd: 0,
    turns: 0,
    browserUrl: null,
    hasScreenshot: false,
    screenshotAt: null,
    lastError: null,
  };
}

function CandidateTag({ req }: { req: HireRequestView }) {
  const floor = useStore((s) => s.repos.find((r) => r.id === req.repoId)?.floor ?? null);
  const tex = useCanvasTexture(512, 128, (ctx) => drawCandidateTag(ctx, 512, 128, req.name, req.title, floor, req.color), [req.name, req.title, floor, req.color]);
  return (
    <Billboard position={[0, 1.95, -0.1]}>
      <mesh>
        <planeGeometry args={[1.15, 0.29]} />
        <meshBasicMaterial map={tex} transparent toneMapped={false} depthWrite={false} />
      </mesh>
    </Billboard>
  );
}

function WaitingChair({ z, req }: { z: number; req: HireRequestView | null }) {
  const ref = useInteractable<THREE.Group>(
    req ? { id: `candidate-${req.id}`, label: `Read ${req.name}'s resume (${req.title})`, action: { kind: 'phone', tab: 'hires', requestId: req.id } } : null,
    3.2,
  );
  const agent = useMemo(() => (req ? candidateAgent(req) : null), [req]);
  const seat = '#06d6a0';
  return (
    <group ref={ref} position={[WAITING.x, 0, z]} rotation={[0, WAITING_ROTATION, 0]}>
      <Box size={[0.52, 0.08, 0.5]} position={[0, 0.44, 0]} color={seat} outline />
      <Box size={[0.48, 0.42, 0.07]} position={[0, 0.72, 0.28]} color={seat} outline />
      {[
        [-0.22, -0.2],
        [0.22, -0.2],
        [-0.22, 0.2],
        [0.22, 0.2],
      ].map(([x, zz]) => (
        <Box key={`${x}${zz}`} size={[0.05, 0.42, 0.05]} position={[x, 0.2, zz]} color="#444a5c" />
      ))}
      {agent && <Character agent={agent} />}
      {req && <CandidateTag req={req} />}
    </group>
  );
}

function WaitingRoom() {
  const requests = useStore((s) => s.requests);
  const waiting = useMemo(() => pendingRequests(requests).filter((r) => r.kind === 'hire'), [requests]);
  const n = waiting.length;
  return (
    <group>
      {WAITING.seats.map((z, i) => (
        <WaitingChair key={z} z={z} req={waiting[i] ?? null} />
      ))}
      <WallSign
        position={[HALF_W - 0.03, 2.5, (WAITING.seats[0] + WAITING.seats[WAITING.seats.length - 1]) / 2]}
        rotationY={-Math.PI / 2}
        size={[3.6, 0.62]}
        px={[864, 150]}
        draw={(ctx) =>
          drawSign(ctx, 864, 150, [{ text: n ? `🪑 Waiting room · ${n} candidate${n === 1 ? '' : 's'}${n > WAITING.seats.length ? ` (${n - WAITING.seats.length} more outside)` : ''}` : '🪑 Waiting room', size: 50 }], '#06a77d')
        }
        deps={[n]}
      />
    </group>
  );
}

export function Lobby() {
  const m = MANAGER_ROOM;
  const user = useStore((s) => s.user);
  const managerName = useStore((s) => s.settings.managerName);
  const boss = managerName || user;
  return (
    <group>
      <Shell accent={ACCENT} floorColor="#e2c7a3" westWindows={[1.5, 8]} eastWindows={[-2, 6]} seed={0} />
      <Rug position={[3, 0.004, 3]} size={[14, 9]} color="#ffd6a5" />

      {/* manager's office */}
      <Rug position={[(m.minX + m.maxX) / 2, 0.005, (m.minZ + m.maxZ) / 2]} size={[m.maxX - m.minX, m.maxZ - m.minZ]} color="#cde7e1" />
      <GlassWall from={[m.maxX, m.minZ]} to={[m.maxX, m.maxZ]} />
      <GlassWall from={[m.minX, m.maxZ]} to={[m.doorMinX, m.maxZ]} />
      <GlassWall from={[m.doorMaxX, m.maxZ]} to={[m.maxX, m.maxZ]} />
      <Box size={[m.doorMaxX - m.doorMinX, 0.5, 0.1]} position={[(m.doorMinX + m.doorMaxX) / 2, 2.55, m.maxZ]} color="#8d99ae" />
      <WallSign
        position={[(m.doorMinX + m.doorMaxX) / 2, 3.1, m.maxZ + 0.06]}
        rotationY={0}
        size={[3.4, 0.5]}
        px={[816, 120]}
        draw={(ctx) => drawSign(ctx, 816, 120, [{ text: `MANAGER${boss ? ` · ${boss}` : ''}`, size: 52 }], '#2b2d42')}
        deps={[boss]}
      />
      <ManagerComputer />
      {/* Leon's Visual CV on the manager's office wall */}
      <ManagerVisualCv position={[-HALF_W + 0.05, 0, -8]} rotationY={Math.PI / 2} />
      <Plant position={[m.maxX - 0.6, 0, m.minZ + 0.6]} scale={1.1} pot="#0078d4" />
      <Plant position={[m.minX + 0.6, 0, m.maxZ - 0.6]} scale={0.9} />
      {/* Modern Acoustic Vertical Oak Slat Feature Wall behind Manager Desk */}
      <group position={[MANAGER_DESK.x, 1.8, -HALF_D + 0.02]}>
        {/* Dark acoustic felt backing */}
        <Box size={[4.2, 3.2, 0.02]} position={[0, 0, 0]} color="#1e293b" shadow={false} />
        {/* Vertical natural oak architectural slats */}
        {Array.from({ length: 26 }, (_, i) => (
          <Box key={i} size={[0.07, 3.2, 0.04]} position={[-1.9 + i * 0.15, 0, 0.02]} color="#d4a373" shadow={false} />
        ))}
      </group>

      <WallSign
        position={[MANAGER_DESK.x, 2.3, -HALF_D + 0.06]}
        rotationY={0}
        size={[2.5, 1.25]}
        px={[640, 320]}
        draw={(ctx) =>
          drawSign(
            ctx,
            640,
            320,
            [
              { text: '✨ 🤖 ✨', size: 54 },
              { text: 'Microsoft AI', size: 48, weight: 800, color: '#60A5FA' },
              { text: 'Head Nerd', size: 58, weight: 700, color: '#FFFFFF' },
            ],
            '#1b1c38',
          )
        }
        deps={[]}
      />
      {/* 3D Fluent Copilot & Power Platform desk badges on manager console */}
      <FluentIconMesh name="copilot" size={0.32} position={[MANAGER_DESK.x - 0.82, 0.96, MANAGER_DESK.z + 0.05]} rotation={[0, 0.35, 0]} />
      <FluentIconMesh name="powerplatform" size={0.28} position={[MANAGER_DESK.x + 0.82, 0.94, MANAGER_DESK.z + 0.05]} rotation={[0, -0.35, 0]} />

      {/* reception */}
      <group position={[RECEPTION.x, 0, RECEPTION.z]}>
        <Box size={[RECEPTION.w, 1.05, RECEPTION.d]} position={[0, 0.525, 0]} color="#ffffff" outline />
        <Box size={[RECEPTION.w + 0.1, 0.08, RECEPTION.d + 0.1]} position={[0, 1.09, 0]} color={ACCENT} outline />
        <Box size={[RECEPTION.w - 0.4, 0.3, 0.02]} position={[0, 0.6, RECEPTION.d / 2 + 0.01]} color={shade(ACCENT, 0.15)} shadow={false} />
        {/* Fluent UI Logo Plaque mounted right on the front of reception desk */}
        <FluentIconMesh name="microsoft" size={0.42} position={[0, 0.62, RECEPTION.d / 2 + 0.03]} />

        {/* a very cheerful receptionist bot */}
        <group position={[0, 1.13, -0.1]}>
          <Cyl r={0.2} rTop={0.16} h={0.4} position={[0, 0.2, 0]} color="#e9ecef" outline />
          <Ball r={0.22} position={[0, 0.58, 0]} color="#f8f9fa" outline />
          <mesh position={[-0.08, 0.6, 0.2]} material={glow('#4cc9f0')}>
            <sphereGeometry args={[0.035, 10, 8]} />
          </mesh>
          <mesh position={[0.08, 0.6, 0.2]} material={glow('#4cc9f0')}>
            <sphereGeometry args={[0.035, 10, 8]} />
          </mesh>
          <Cyl r={0.012} h={0.2} position={[0, 0.88, 0]} color="#adb5bd" />
          <mesh position={[0, 0.99, 0]} material={glow(ACCENT)}>
            <sphereGeometry args={[0.045, 10, 8]} />
          </mesh>
        </group>
      </group>

      {/* Main Microsoft AI & Copilot Studio Feature Wall Banner above main north wall */}
      <MicrosoftWallBanner position={[2.5, 2.25, -HALF_D + 0.03]} rotationY={0} width={6.2} height={1.6} />

      {/* Fluent UI Icon Gallery Display on the North Lobby Wall (Office apps & Power Platform icons) */}
      <group position={[8.4, 2.2, -HALF_D + 0.03]}>
        <FluentIconMesh name="powerapps" size={0.52} position={[-1.2, 0.42, 0]} showLabel />
        <FluentIconMesh name="powerautomate" size={0.52} position={[0, 0.42, 0]} showLabel />
        <FluentIconMesh name="powerbi" size={0.52} position={[1.2, 0.42, 0]} showLabel />
        <FluentIconMesh name="word" size={0.46} position={[-1.2, -0.42, 0]} />
        <FluentIconMesh name="excel" size={0.46} position={[-0.4, -0.42, 0]} />
        <FluentIconMesh name="powerpoint" size={0.46} position={[0.4, -0.42, 0]} />
        <FluentIconMesh name="teams" size={0.46} position={[1.2, -0.42, 0]} />
      </group>

      {/* Floating 3D Acrylic Copilot Studio icon monument by waiting area / lounge */}
      <group position={[11.5, 0, 7.8]}>
        <Cyl r={0.35} h={0.7} position={[0, 0.35, 0]} color="#1e2430" outline />
        <FluentIconMesh name="copilot" size={0.65} position={[0, 1.15, 0]} rotation={[0, -Math.PI / 4, 0]} showLabel />
      </group>

      {/* Interactive Copilot Studio Test Kiosk in Lobby */}
      <CopilotKiosk position={[8.8, 0, 5.5]} rotationY={-Math.PI / 4} />

      {/* Microsoft Entra ID & DLP Policy Security Kiosk */}
      <DlpSecurityKiosk position={[-6.8, 0, 8.5]} rotationY={Math.PI / 5} />

      {/* Multi-Agent Swarm Orchestration War Room (Conference Room in center-west lobby) */}
      <group position={[-1.5, 0, 2.8]}>
        {/* Glass Enclosure */}
        <GlassWall from={[-2.8, -1.8]} to={[2.8, -1.8]} height={2.4} />
        <GlassWall from={[2.8, -1.8]} to={[2.8, 1.8]} height={2.4} />
        <GlassWall from={[-2.8, 1.8]} to={[0.8, 1.8]} height={2.4} />
        <GlassWall from={[-2.8, -1.8]} to={[-2.8, 1.8]} height={2.4} />
        <Rug position={[0, 0.005, 0]} size={[5.4, 3.4]} color="#1e293b" />

        {/* Interactive Boardroom Table with Swarm Ideator */}
        <WarRoomTable />

        {/* Executive Conference Swarm Chairs */}
        {[-0.9, 0, 0.9].map((x) => (
          <group key={x}>
            {/* North side chairs */}
            <group position={[x, 0, 0.95]}>
              <mesh position={[0, 0.44, 0]} material={acousticFabric('#334155')}>
                <boxGeometry args={[0.48, 0.08, 0.46]} />
              </mesh>
              <mesh position={[0, 0.72, 0.22]} rotation={[-0.08, 0, 0]} material={acousticFabric('#1e293b')}>
                <boxGeometry args={[0.44, 0.46, 0.05]} />
              </mesh>
              <mesh position={[0, 0.22, 0]} material={brushedMetal('#475569')}>
                <cylinderGeometry args={[0.03, 0.035, 0.36, 12]} />
              </mesh>
              <mesh position={[0, 0.03, 0]} material={brushedMetal('#1e293b')}>
                <cylinderGeometry args={[0.22, 0.24, 0.04, 16]} />
              </mesh>
            </group>
            {/* South side chairs */}
            <group position={[x, 0, -0.95]} rotation={[0, Math.PI, 0]}>
              <mesh position={[0, 0.44, 0]} material={acousticFabric('#334155')}>
                <boxGeometry args={[0.48, 0.08, 0.46]} />
              </mesh>
              <mesh position={[0, 0.72, 0.22]} rotation={[-0.08, 0, 0]} material={acousticFabric('#1e293b')}>
                <boxGeometry args={[0.44, 0.46, 0.05]} />
              </mesh>
              <mesh position={[0, 0.22, 0]} material={brushedMetal('#475569')}>
                <cylinderGeometry args={[0.03, 0.035, 0.36, 12]} />
              </mesh>
              <mesh position={[0, 0.03, 0]} material={brushedMetal('#1e293b')}>
                <cylinderGeometry args={[0.22, 0.24, 0.04, 16]} />
              </mesh>
            </group>
          </group>
        ))}

        {/* Room Header Sign */}
        <WallSign
          position={[0, 2.7, 1.84]}
          rotationY={0}
          size={[3.8, 0.5]}
          px={[912, 120]}
          draw={(ctx) => drawSign(ctx, 912, 120, [{ text: '🤝 AGENT SWARM WAR ROOM', size: 40 }], '#0284c7')}
          deps={[]}
        />
      </group>

      {/* Biophilic Living Moss Feature Wall behind Reception / Waiting Wall */}
      <LivingMossWall position={[HALF_W - 0.04, 1.3, -4.5]} rotationY={-Math.PI / 2} width={5.2} height={2.8} />

      {/* Cyber-Fluent Glowing Architecture Floor Bus Pipe connecting War Room to Elevator */}
      <mesh position={[-1.5, 0.015, 6.2]} rotation={[0, 0, 0]} material={cyberGlow('#0078d4', 2.2)}>
        <boxGeometry args={[0.06, 0.015, 6.8]} />
      </mesh>
      <mesh position={[1.5, 0.015, 6.2]} rotation={[0, 0, 0]} material={cyberGlow('#38bdf8', 2.0)}>
        <boxGeometry args={[0.04, 0.015, 6.8]} />
      </mesh>

      {/* 3D Acrylic Power Platform icon monument near entrance / elevator */}
      <group position={[-2.4, 0, HALF_D - 1.2]}>
        <Cyl r={0.3} h={0.6} position={[0, 0.3, 0]} color="#1e2430" outline />
        <FluentIconMesh name="powerplatform" size={0.58} position={[0, 1.0, 0]} rotation={[0, Math.PI, 0]} showLabel />
      </group>

      <CeoOffice />
      <WaitingRoom />
      <Elevator floorLabel="▲ G · Lobby" accent={ACCENT} />
      <Toys floor="lobby" />
      <Directory />
      <TrophyCabinet />
      <WallClock position={[11.2, 2.85, -HALF_D + 0.05]} />
      <Couch position={[11.5, 0, 4]} rotationY={Math.PI} color="#5C2D91" />
      <CoffeeTable position={[11.5, 0, 6.2]} />
      <Plant position={[HALF_W - 0.7, 0, HALF_D - 0.7]} scale={1.2} />
      <Plant position={[-HALF_W + 0.7, 0, HALF_D - 0.7]} scale={1.2} pot="#0078D4" />
      <Plant position={[-3, 0, HALF_D - 0.6]} />
      <Plant position={[3, 0, -HALF_D + 0.7]} scale={0.8} />
    </group>
  );
}
