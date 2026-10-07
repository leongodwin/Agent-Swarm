import * as THREE from 'three';
import { useInteractable } from './interact';
import { roundRect, SANS } from './draw';
import { useCanvasTexture } from './interact';
import { Box, Cyl } from './Toon';
import { glow, brushedMetal, cyberGlow } from './materials';

/**
 * 3D Executive Proposal Generator & Pre-Sales Consulting Station.
 * Located in the Lobby, allowing users to interactively generate commercial SOWs,
 * licensing BOMs, and ROI analyses.
 */
export function ProposalDesk({
  position,
  rotationY = 0,
}: {
  position: [number, number, number];
  rotationY?: number;
}) {
  const ref = useInteractable<THREE.Group>(
    {
      id: 'proposal-generator-station',
      label: 'Open Pre-Sales Commercial Proposal & SOW Generator',
      action: { kind: 'proposal' },
    },
    3.2,
  );

  const texW = 1024;
  const texH = 640;

  const tex = useCanvasTexture(
    texW,
    texH,
    (ctx) => {
      // Dark Slate Executive Background
      ctx.fillStyle = '#061122';
      roundRect(ctx, 0, 0, texW, texH, 24);
      ctx.fill();

      ctx.lineWidth = 3;
      ctx.strokeStyle = '#0284c7';
      ctx.stroke();

      // Top Title Bar
      const g = ctx.createLinearGradient(0, 0, texW, 0);
      g.addColorStop(0, '#0369a1');
      g.addColorStop(1, '#0284c7');
      ctx.fillStyle = g;
      roundRect(ctx, 16, 16, texW - 32, 64, 12);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = `800 26px ${SANS}`;
      ctx.textBaseline = 'middle';
      ctx.fillText('💼 PRE-SALES PROPOSAL & COMMERCIAL SOW GENERATOR', 36, 48);

      ctx.textAlign = 'right';
      ctx.font = `700 16px ${SANS}`;
      ctx.fillStyle = '#bae6fd';
      ctx.fillText('COPILOT STUDIO · POWER PLATFORM · ENTRA ID', texW - 36, 48);
      ctx.textAlign = 'left';

      // Left Column: Commercial Snapshot
      roundRect(ctx, 28, 100, 460, 490, 16);
      ctx.fillStyle = '#0b162c';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#1e293b';
      ctx.stroke();

      ctx.fillStyle = '#38bdf8';
      ctx.font = `700 20px ${SANS}`;
      ctx.fillText('📊 Commercial Scope & Licensing BOM', 48, 136);

      const items = [
        { label: 'Copilot Studio Packs', val: '25,000 msgs / mo ($200)', color: '#38bdf8' },
        { label: 'Power Apps Capacity', val: 'Per-User & Per-App Hybrid', color: '#a78bfa' },
        { label: 'Dataverse Storage', val: 'High-Volume Elastic Audit', color: '#f472b6' },
        { label: 'Entra ID P1/P2', val: 'Conditional Access & DLP', color: '#34d399' },
        { label: 'Delivery Timeline', val: '8–12 Weeks (6 Sprints)', color: '#fbbf24' },
      ];

      items.forEach((item, idx) => {
        const y = 186 + idx * 72;
        roundRect(ctx, 44, y, 428, 56, 10);
        ctx.fillStyle = '#0f203d';
        ctx.fill();

        ctx.fillStyle = '#94a3b8';
        ctx.font = `600 14px ${SANS}`;
        ctx.fillText(item.label, 60, y + 20);

        ctx.fillStyle = item.color;
        ctx.font = `700 16px ${SANS}`;
        ctx.fillText(item.val, 60, y + 42);
      });

      // Right Column: Value Engineering & ROI
      roundRect(ctx, 516, 100, 480, 490, 16);
      ctx.fillStyle = '#0b162c';
      ctx.fill();
      ctx.strokeStyle = '#1e293b';
      ctx.stroke();

      ctx.fillStyle = '#4ade80';
      ctx.font = `700 20px ${SANS}`;
      ctx.fillText('📈 Projected Return on Investment (ROI)', 536, 136);

      // ROI Banner
      roundRect(ctx, 536, 168, 440, 120, 14);
      ctx.fillStyle = '#052e16';
      ctx.fill();
      ctx.strokeStyle = '#166534';
      ctx.stroke();

      ctx.fillStyle = '#86efac';
      ctx.font = `700 14px ${SANS}`;
      ctx.fillText('NET 3-YEAR PROJECTED EFFICIENCY RETURN', 556, 196);

      ctx.fillStyle = '#4ade80';
      ctx.font = `800 48px ${SANS}`;
      ctx.fillText('284% ROI', 556, 252);

      // Call to action button visual
      roundRect(ctx, 536, 320, 440, 80, 12);
      ctx.fillStyle = '#0284c7';
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = `800 20px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.fillText('PRESS [E] TO LAUNCH PROPOSAL STUDIO', 536 + 220, 360);
      ctx.textAlign = 'left';

      // Feature bullet points
      ctx.fillStyle = '#94a3b8';
      ctx.font = `500 14px ${SANS}`;
      ctx.fillText('• Export turnkey Markdown Statements of Work (SOW)', 546, 436);
      ctx.fillText('• Live itemized Microsoft SKU pricing breakdown', 546, 468);
      ctx.fillText('• One-click handoff to High-Level Design (HLD) Agent', 546, 500);
      ctx.fillText('• Tailored for ISO 27001, HIPAA & SOC2 environments', 546, 532);
    },
    [],
  );

  return (
    <group ref={ref} position={position} rotation={[0, rotationY, 0]}>
      {/* Executive Desk Base */}
      <Box size={[2.8, 0.76, 1.4]} position={[0, 0.38, 0]} color="#1e293b" outline />
      <Box size={[2.9, 0.08, 1.5]} position={[0, 0.8, 0]} color="#0f172a" outline />

      {/* Brushed aluminum legs / frame accent */}
      <mesh position={[-1.35, 0.38, 0]} material={brushedMetal('#64748b')}>
        <boxGeometry args={[0.08, 0.76, 1.3]} />
      </mesh>
      <mesh position={[1.35, 0.38, 0]} material={brushedMetal('#64748b')}>
        <boxGeometry args={[0.08, 0.76, 1.3]} />
      </mesh>

      {/* Curved Executive Privacy Partition */}
      <mesh position={[0, 1.15, -0.68]}>
        <boxGeometry args={[2.7, 0.65, 0.04]} />
        <meshStandardMaterial color="#0284c7" transparent opacity={0.35} roughness={0.1} metalness={0.8} />
      </mesh>

      {/* Holographic Dual Terminal Display */}
      <group position={[0, 1.35, 0.05]} rotation={[-0.12, 0, 0]}>
        {/* Terminal Screen Frame */}
        <Box size={[2.24, 1.38, 0.06]} position={[0, 0, 0]} color="#0a0f1d" outline />
        {/* Screen Canvas Mesh */}
        <mesh position={[0, 0, 0.035]}>
          <planeGeometry args={[2.16, 1.3]} />
          <meshBasicMaterial map={tex} toneMapped={false} />
        </mesh>
        {/* Glowing border pipe */}
        <mesh position={[0, 0, -0.01]} material={cyberGlow('#0284c7', 1.8)}>
          <boxGeometry args={[2.28, 1.42, 0.02]} />
        </mesh>
      </group>

      {/* Terminal Stand */}
      <Cyl r={0.06} h={0.5} position={[0, 0.95, -0.1]} color="#475569" />

      {/* Interactive Beacon Glow */}
      <mesh position={[0, 0.85, 0.55]} material={glow('#38bdf8')}>
        <sphereGeometry args={[0.045, 12, 10]} />
      </mesh>
    </group>
  );
}
