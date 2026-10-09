import * as THREE from 'three';
import { useInteractable } from './interact';
import { roundRect, SANS } from './draw';
import { useCanvasTexture } from './interact';
import { Box, Cyl } from './Toon';
import { glow } from './materials';

/**
 * 3D Microsoft Entra ID & Data Loss Prevention (DLP) Security Kiosk.
 * Displays tenant compliance, identity boundaries, allowed connectors, and blocked exfiltration endpoints.
 */
export function DlpSecurityKiosk({
  position,
  rotationY = 0,
}: {
  position: [number, number, number];
  rotationY?: number;
}) {
  const ref = useInteractable<THREE.Group>(
    {
      id: 'dlp-security-kiosk',
      label: 'Inspect Microsoft Entra ID & DLP Tenant Boundary',
      action: { kind: 'dlp-kiosk' },
    },
    3.2,
  );

  const texW = 1024;
  const texH = 640;

  const tex = useCanvasTexture(
    texW,
    texH,
    (ctx) => {
      // Dark security background
      ctx.fillStyle = '#061325';
      roundRect(ctx, 0, 0, texW, texH, 24);
      ctx.fill();

      ctx.lineWidth = 3;
      ctx.strokeStyle = '#0284c7';
      ctx.stroke();

      // Top Header
      const g = ctx.createLinearGradient(0, 0, texW, 0);
      g.addColorStop(0, '#0369a1');
      g.addColorStop(1, '#0284c7');
      ctx.fillStyle = g;
      roundRect(ctx, 16, 16, texW - 32, 60, 12);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = `800 24px ${SANS}`;
      ctx.textBaseline = 'middle';
      ctx.fillText('🛡️ MICROSOFT ENTRA ID & POWER PLATFORM DLP POLICY', 36, 46);

      ctx.textAlign = 'right';
      ctx.font = `700 16px ${SANS}`;
      ctx.fillStyle = '#38bdf8';
      ctx.fillText('LOCAL HEURISTIC SCANNER · INSPECT PROFILES', texW - 36, 46);
      ctx.textAlign = 'left';

      // Allowed Business Connectors Card
      roundRect(ctx, 32, 96, 460, 380, 14);
      ctx.fillStyle = '#0f172a';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#22c55e';
      ctx.stroke();

      ctx.fillStyle = '#22c55e';
      ctx.font = `700 18px ${SANS}`;
      ctx.fillText('ALLOWED BUSINESS CONNECTORS', 50, 130);

      const allowed = [
        '✓ Microsoft Dataverse (Encrypted at Rest)',
        '✓ Azure OpenAI Service (Private VNet)',
        '✓ Office 365 Users & Outlook Graph API',
        '✓ Microsoft Teams Webhook Services',
        '✓ SharePoint Online Document Repositories',
      ];
      ctx.font = `500 15px ${SANS}`;
      ctx.fillStyle = '#e2e8f0';
      allowed.forEach((a, i) => {
        ctx.fillText(a, 50, 175 + i * 45);
      });

      // Blocked / Non-Business Card
      roundRect(ctx, 532, 96, 460, 380, 14);
      ctx.fillStyle = '#0f172a';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ef4444';
      ctx.stroke();

      ctx.fillStyle = '#ef4444';
      ctx.font = `700 18px ${SANS}`;
      ctx.fillText('RESTRICTED / BLOCKED BY DLP', 552, 130);

      const blocked = [
        '✕ Public Cloud Storage (Dropbox, Box)',
        '✕ Unverified REST / HTTP Anonymous APIs',
        '✕ Consumer Social Media & Webhooks',
        '✕ Third-Party LLM Endpoints (No Tenant Log)',
        '✕ Untrusted Custom Connector Gateways',
      ];
      ctx.font = `500 15px ${SANS}`;
      ctx.fillStyle = '#94a3b8';
      blocked.forEach((b, i) => {
        ctx.fillText(b, 552, 175 + i * 45);
      });

      // Bottom Status Banner
      roundRect(ctx, 32, 500, texW - 64, 110, 12);
      ctx.fillStyle = '#1e293b';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#38bdf8';
      ctx.stroke();

      ctx.fillStyle = '#38bdf8';
      ctx.font = `700 16px ${SANS}`;
      ctx.fillText('ENTERPRISE DATA BOUNDARY · CONTINUOUS AGENT COMPLIANCE', 50, 535);

      ctx.fillStyle = '#94a3b8';
      ctx.font = `500 14px ${SANS}`;
      ctx.fillText('All autonomous agent tool calls are routed strictly through PAC CLI, Azure Managed Identities,', 50, 565);
      ctx.fillText('and tenant-isolated service principals. Zero cross-tenant data exfiltration risk.', 50, 588);
    },
    [],
  );

  return (
    <group ref={ref} position={position} rotation={[0, rotationY, 0]}>
      {/* Heavy Security Pedestal */}
      <Cyl r={0.38} rTop={0.32} h={0.16} position={[0, 0.08, 0]} color="#1e293b" outline />
      <Cyl r={0.12} h={0.8} position={[0, 0.52, 0]} color="#334155" />

      {/* Console Display Housing */}
      <group position={[0, 1.0, 0.04]} rotation={[-Math.PI / 8, 0, 0]}>
        <Box size={[0.84, 0.58, 0.06]} position={[0, 0, 0]} color="#0f172a" outline />
        <mesh position={[0, 0, 0.035]}>
          <planeGeometry args={[0.8, 0.54]} />
          <meshBasicMaterial map={tex} toneMapped={false} />
        </mesh>
      </group>

      {/* Floating Holographic Security Shield Icon */}
      <mesh position={[0, 1.45, 0.04]} material={glow('#0284c7')}>
        <octahedronGeometry args={[0.09]} />
      </mesh>
    </group>
  );
}
