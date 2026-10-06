import * as THREE from 'three';
import { useInteractable } from './interact';
import { roundRect, SANS } from './draw';
import { useCanvasTexture } from './interact';
import { Box, Cyl } from './Toon';
import { glow, brushedMetal, cyberGlow } from './materials';

/**
 * 3D High-Level Design (HLD) Drafting Station & Architecture Hub.
 * Located on office floors beside the Solution Architecture Board, allowing
 * users to inspect, generate, and commit enterprise HLD blueprints.
 */
export function HldStation({
  position,
  rotationY = 0,
  repoId,
}: {
  position: [number, number, number];
  rotationY?: number;
  repoId?: string;
}) {
  const ref = useInteractable<THREE.Group>(
    {
      id: `hld-station-${repoId ?? 'main'}`,
      label: 'Open High-Level Design (HLD) Document & Architecture Blueprints',
      action: { kind: 'hld', repoId },
    },
    3.2,
  );

  const texW = 1024;
  const texH = 640;

  const tex = useCanvasTexture(
    texW,
    texH,
    (ctx) => {
      // Dark Blueprint Surface
      ctx.fillStyle = '#060d1a';
      roundRect(ctx, 0, 0, texW, texH, 20);
      ctx.fill();

      ctx.lineWidth = 3;
      ctx.strokeStyle = '#7c3aed';
      ctx.stroke();

      // Top Header
      const g = ctx.createLinearGradient(0, 0, texW, 0);
      g.addColorStop(0, '#5b21b6');
      g.addColorStop(1, '#7c3aed');
      ctx.fillStyle = g;
      roundRect(ctx, 16, 16, texW - 32, 60, 12);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = `800 24px ${SANS}`;
      ctx.textBaseline = 'middle';
      ctx.fillText('📐 PRINCIPAL ARCHITECT · HIGH-LEVEL DESIGN (HLD) STUDIO', 36, 46);

      ctx.textAlign = 'right';
      ctx.font = `700 16px ${SANS}`;
      ctx.fillStyle = '#f5d0fe';
      ctx.fillText('MICROSOFT WELL-ARCHITECTED FRAMEWORK', texW - 36, 46);
      ctx.textAlign = 'left';

      // Blueprint Grid Lines
      ctx.strokeStyle = 'rgba(124, 58, 237, 0.15)';
      ctx.lineWidth = 1;
      for (let x = 40; x < texW - 40; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 90);
        ctx.lineTo(x, texH - 30);
        ctx.stroke();
      }
      for (let y = 90; y < texH - 30; y += 40) {
        ctx.beginPath();
        ctx.moveTo(40, y);
        ctx.lineTo(texW - 40, y);
        ctx.stroke();
      }

      // Left Column: Architecture Pillars
      roundRect(ctx, 36, 96, 440, 480, 14);
      ctx.fillStyle = '#0a1024';
      ctx.fill();
      ctx.strokeStyle = '#2e1065';
      ctx.stroke();

      ctx.fillStyle = '#c084fc';
      ctx.font = `700 18px ${SANS}`;
      ctx.fillText('🏛️ Well-Architected Pillars & Topology', 54, 130);

      const pillars = [
        { name: '1. Reliability & Resilience', desc: 'Exponential backoff & dead-letter queue' },
        { name: '2. Zero Trust Security', desc: 'Entra ID OBO & Dataverse column security' },
        { name: '3. Cost Optimization', desc: 'Standard vs Premium connector tiers' },
        { name: '4. Operational Excellence', desc: 'pac solution unpack & automated ALM' },
        { name: '5. Performance Efficiency', desc: 'Dataverse Elastic Tables for high scale' },
      ];

      pillars.forEach((p, i) => {
        const y = 168 + i * 76;
        roundRect(ctx, 50, y, 412, 62, 8);
        ctx.fillStyle = '#131b38';
        ctx.fill();

        ctx.fillStyle = '#f3e8ff';
        ctx.font = `700 14px ${SANS}`;
        ctx.fillText(p.name, 64, y + 22);

        ctx.fillStyle = '#a855f7';
        ctx.font = `500 12px ${SANS}`;
        ctx.fillText(p.desc, 64, y + 44);
      });

      // Right Column: Diagrams & Artifacts
      roundRect(ctx, 504, 96, 480, 480, 14);
      ctx.fillStyle = '#0a1024';
      ctx.fill();
      ctx.strokeStyle = '#2e1065';
      ctx.stroke();

      ctx.fillStyle = '#38bdf8';
      ctx.font = `700 18px ${SANS}`;
      ctx.fillText('📊 Embedded Mermaid Schematics', 524, 130);

      roundRect(ctx, 524, 160, 440, 180, 10);
      ctx.fillStyle = '#070c18';
      ctx.fill();

      ctx.fillStyle = '#38bdf8';
      ctx.font = `600 13px Consolas, monospace`;
      ctx.fillText('graph TB', 544, 190);
      ctx.fillText('  Teams --> Copilot["Copilot Studio"]', 544, 215);
      ctx.fillText('  Copilot --> GenAI["Azure OpenAI"]', 544, 240);
      ctx.fillText('  Copilot --> Flows["Power Automate"]', 544, 265);
      ctx.fillText('  Flows --> Dataverse["Dataverse Schema"]', 544, 290);
      ctx.fillText('  Entra ID -.-> Security & DLP', 544, 315);

      // Call to action button
      roundRect(ctx, 524, 370, 440, 80, 12);
      ctx.fillStyle = '#7c3aed';
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = `800 20px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.fillText('PRESS [E] TO INSPECT HLD BLUEPRINT', 524 + 220, 412);
      ctx.textAlign = 'left';

      ctx.fillStyle = '#94a3b8';
      ctx.font = `500 13px ${SANS}`;
      ctx.fillText('• Auto-synced to docs/architecture/HLD.md', 534, 484);
      ctx.fillText('• Multi-diagram interactive tabs (Topology, ERD, Sequence)', 534, 514);
      ctx.fillText('• Direct bridge to Swarm Sprint Backlog', 534, 544);
    },
    [],
  );

  return (
    <group ref={ref} position={position} rotation={[0, rotationY, 0]}>
      {/* Drafting Table Stand & Angular Frame */}
      <Box size={[2.6, 0.08, 1.4]} position={[0, 0.88, 0]} rotation={[0.18, 0, 0]} color="#1e1b4b" outline />
      <mesh position={[-1.2, 0.42, 0]} material={brushedMetal('#475569')}>
        <boxGeometry args={[0.08, 0.82, 1.1]} />
      </mesh>
      <mesh position={[1.2, 0.42, 0]} material={brushedMetal('#475569')}>
        <boxGeometry args={[0.08, 0.82, 1.1]} />
      </mesh>
      <Cyl r={0.04} h={2.2} position={[0, 0.35, 0]} rotation={[0, 0, Math.PI / 2]} color="#334155" />

      {/* Tilted Architecture Display Canvas */}
      <group position={[0, 1.18, 0.12]} rotation={[-0.14, 0, 0]}>
        <Box size={[2.24, 1.38, 0.05]} position={[0, 0, 0]} color="#0a0a1a" outline />
        <mesh position={[0, 0, 0.03]}>
          <planeGeometry args={[2.16, 1.3]} />
          <meshBasicMaterial map={tex} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0, -0.01]} material={cyberGlow('#7c3aed', 1.8)}>
          <boxGeometry args={[2.28, 1.42, 0.02]} />
        </mesh>
      </group>

      {/* Holographic Glowing Compass / CAD Node */}
      <group position={[1.05, 1.05, -0.3]}>
        <Cyl r={0.12} h={0.02} position={[0, 0, 0]} color="#1e1b4b" />
        <mesh position={[0, 0.06, 0]} material={glow('#c084fc')}>
          <sphereGeometry args={[0.04, 10, 8]} />
        </mesh>
      </group>

      {/* Interactive Beacon Sphere */}
      <mesh position={[0, 0.95, 0.65]} material={glow('#a855f7')}>
        <sphereGeometry args={[0.045, 12, 10]} />
      </mesh>
    </group>
  );
}
