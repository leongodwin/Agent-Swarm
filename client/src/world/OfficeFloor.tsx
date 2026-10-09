import { useMemo } from 'react';
import type { RepoView } from '../../../shared/types';
import { agentsOnRepo, useStore } from '../store';
import { AppMonitor } from './AppMonitor';
import { Desk } from './Desk';
import { drawSign } from './draw';
import { Elevator } from './Elevator';
import { useCanvasTexture } from './interact';
import { KanbanBoard } from './KanbanBoard';
import { DESK_ROWS, HALF_D, HALF_W, MAX_DESKS, QA_LAB, QA_ROTATION, deskPosition, qaDeskPosition } from './layout';
import { shade } from './materials';
import { CoffeeTable, Couch, Kitchenette, Plant, Rug, WallClock, WaterCooler } from './Props';
import { Shell } from './Shell';
import { Toys } from './toys';
import { FluentIconMesh } from './FluentIcons';
import { SolutionArchitectureBoard } from './SolutionArchitectureBoard';
import { FlowRunHistoryBoard } from './FlowRunHistoryBoard';
import { DataverseSchemaMonitor } from './DataverseSchemaMonitor';
import { CopilotKiosk } from './CopilotKiosk';
import { HldStation } from './HldStation';
import { ReleaseApprovalStation } from './ReleaseApprovalStation';
import { DataFlowPulseField } from './ParticleFx';

export function WallSign({
  position,
  size,
  px,
  draw,
  deps,
  rotationY = Math.PI,
}: {
  position: [number, number, number];
  size: [number, number];
  px: [number, number];
  draw: (ctx: CanvasRenderingContext2D) => void;
  deps: unknown[];
  rotationY?: number;
}) {
  const tex = useCanvasTexture(px[0], px[1], draw, deps);
  return (
    <mesh position={position} rotation={[0, rotationY, 0]}>
      <planeGeometry args={size} />
      <meshBasicMaterial map={tex} transparent toneMapped={false} />
    </mesh>
  );
}

export function OfficeFloor({ repo }: { repo: RepoView }) {
  const allAgents = useStore((s) => s.agents);
  const agents = useMemo(() => agentsOnRepo(allAgents, repo.id), [allAgents, repo.id]);
  const devBySlot = useMemo(() => new Map(agents.filter((a) => a.role === 'dev').map((a) => [a.desk, a])), [agents]);
  const qaBySlot = useMemo(() => new Map(agents.filter((a) => a.role === 'qa').map((a) => [a.desk, a])), [agents]);
  const working = agents.filter((a) => a.status === 'working' || a.status === 'preparing').length;
  const qaRecords = useStore((s) => s.qa);
  const inQa = Object.values(qaRecords).filter((q) => q.repoId === repo.id && q.status !== 'passed').length;
  const ready = Object.values(qaRecords).filter((q) => q.repoId === repo.id && q.status === 'passed').length;
  const name = repo.fullName.split('/')[1] ?? repo.fullName;
  const rugColor = shade(repo.color, 0.24);

  return (
    <group>
      <Shell accent={repo.color} floorColor="#d9b48a" westWindows={[-8, 8]} eastWindows={[-8]} seed={repo.floor} />
      {DESK_ROWS.map((z) => (
        <Rug key={z} position={[0, 0.004, z + 0.35]} size={[24.4, 2.9]} color={rugColor} />
      ))}

      {Array.from({ length: MAX_DESKS }, (_, slot) => {
        const { x, z } = deskPosition(slot);
        return <Desk key={slot} agent={devBySlot.get(slot) ?? null} accent={repo.color} repoId={repo.id} position={[x, 0, z]} />;
      })}

      {/* QA & Guardrails Eval lab */}
      <Rug position={[QA_LAB.x - 0.4, 0.005, -2]} size={[3.4, 10.4]} color="#e0e7ff" />
      {QA_LAB.stations.map((_, slot) => {
        const { x, z } = qaDeskPosition(slot);
        return <Desk key={`qa${slot}`} role="qa" rotationY={QA_ROTATION} agent={qaBySlot.get(slot) ?? null} accent={repo.color} repoId={repo.id} position={[x, 0, z]} />;
      })}
      <WallSign
        position={[HALF_W - 0.03, 3.25, -2]}
        rotationY={-Math.PI / 2}
        size={[3.8, 0.6]}
        px={[912, 144]}
        draw={(ctx) => drawSign(ctx, 912, 144, [{ text: `🛡️ COPILOT EVAL & GUARDRAILS LAB · ${inQa} PRs`, size: 48 }], '#4338ca')}
        deps={[inQa]}
      />

      {/* Primary Interactive Kanban Board (North Wall Center) */}
      <KanbanBoard repo={repo} agents={agents} />

      {/* Live Power Platform Solution Architecture Board (East Wall, visible alongside Kanban) */}
      <SolutionArchitectureBoard position={[HALF_W - 0.05, 0.45, 3.2]} rotationY={-Math.PI / 2} width={5.6} height={2.8} repoId={repo.id} />
      {/* 3D Glowing Data Pulse Pipeline traversing under the architecture board */}
      <group position={[HALF_W - 0.12, 0.45, 3.2]} rotation={[0, -Math.PI / 2, 0]}>
        <DataFlowPulseField position={[0, -0.25, 0]} />
      </group>

      {/* High-Level Design (HLD) Drafting Station & Architecture Hub */}
      <HldStation position={[HALF_W - 2.8, 0, 7.2]} rotationY={-Math.PI / 3} repoId={repo.id} />

      {/* Multi-Environment ALM Release Gate & Approval Station */}
      <ReleaseApprovalStation position={[HALF_W - 2.8, 0, 3.8]} rotationY={-Math.PI / 3} />

      {/* Live Power Automate Flow Run History Telemetry Board (West Wall) */}
      <FlowRunHistoryBoard position={[-HALF_W + 0.05, 0.45, 0]} rotationY={Math.PI / 2} width={5.2} height={2.6} repoId={repo.id} />

      {/* Dataverse Schema & ERD Screen (North Wall, East of Kanban) */}
      <DataverseSchemaMonitor position={[9.2, 0.75, -HALF_D + 0.04]} rotationY={0} width={3.4} height={1.8} />

      {/* Interactive Copilot Studio Test Kiosk on the office floor */}
      <CopilotKiosk position={[-9.2, 0, 7.8]} rotationY={Math.PI / 3} />

      <AppMonitor repo={repo} agents={agents} />
      <Elevator floorLabel={`▲ ${repo.floor} · ${name}`} accent={repo.color} />
      <Toys floor="office" />

      <WallSign
        position={[-4.6, 1.95, HALF_D - 0.03]}
        size={[4.2, 1.3]}
        px={[1024, 317]}
        draw={(ctx) =>
          drawSign(
            ctx,
            1024,
            317,
            [
              { text: `FLOOR ${repo.floor}`, size: 58, color: 'rgba(255,255,255,0.85)', weight: 600 },
              { text: repo.fullName, size: 74 },
              { text: repo.description || 'no description', size: 36, weight: 500, color: 'rgba(255,255,255,0.85)' },
            ],
            repo.color,
          )
        }
        deps={[repo.floor, repo.fullName, repo.description, repo.color]}
      />
      <WallSign
        position={[4.6, 1.95, HALF_D - 0.03]}
        size={[4.2, 1.3]}
        px={[1024, 317]}
        draw={(ctx) =>
          drawSign(
            ctx,
            1024,
            317,
            [
              { text: `👩‍💻 ${agents.length} on the team`, size: 54, color: '#2d3142' },
              { text: `⚙️ ${working} busy · 🔍 ${inQa} in QA · ✅ ${ready} to merge`, size: 46, color: '#2d3142', weight: 600 },
              { text: `📋 ${repo.issues.length} open issue${repo.issues.length === 1 ? '' : 's'}${repo.autoAssign ? ' · ⚡ auto' : ''}`, size: 44, color: '#5c6078', weight: 500 },
            ],
            '#fffdf5',
          )
        }
        deps={[agents.length, working, inQa, ready, repo.issues.length, repo.autoAssign]}
      />

      <Plant position={[-7.1, 0, -HALF_D + 0.7]} />
      <Plant position={[7.1, 0, -HALF_D + 0.7]} />
      <Plant position={[-HALF_W + 0.7, 0, HALF_D - 0.8]} scale={1.2} />
      <Plant position={[-11, 0, -HALF_D + 0.7]} scale={1.1} />
      <Plant position={[HALF_W - 0.7, 0, HALF_D - 0.7]} scale={0.9} pot="#8338ec" />
      <Couch position={[-HALF_W + 0.9, 0, 6.5]} rotationY={-Math.PI / 2} color={shade(repo.color, -0.05)} />
      <CoffeeTable position={[-HALF_W + 2.6, 0, 6.5]} rotationY={Math.PI / 2} />
      <Kitchenette position={[HALF_W - 0.45, 0, 8.2]} />
      <WaterCooler position={[HALF_W - 0.5, 0, -9.5]} />
      <WallClock position={[-10, 2.75, -HALF_D + 0.05]} />
      {/* Fluent UI Microsoft AI & Power Platform Wall Display */}
      <group position={[12.8, 1.65, -HALF_D + 0.03]}>
        <FluentIconMesh name="copilot" size={0.45} position={[-0.45, 0.45, 0]} />
        <FluentIconMesh name="powerplatform" size={0.45} position={[0.45, 0.45, 0]} />
        <FluentIconMesh name="powerautomate" size={0.45} position={[-0.45, -0.05, 0]} />
        <FluentIconMesh name="teams" size={0.45} position={[0.45, -0.05, 0]} />
        <FluentIconMesh name="word" size={0.4} position={[-0.45, -0.55, 0]} />
        <FluentIconMesh name="excel" size={0.4} position={[0.45, -0.55, 0]} />
      </group>
    </group>
  );
}
