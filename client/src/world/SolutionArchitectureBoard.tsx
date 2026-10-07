import * as THREE from 'three';
import { roundRect, SANS } from './draw';
import { Box } from './Toon';
import { FLUENT_ICONS } from './FluentIcons';
import { useCanvasTexture, useInteractable } from './interact';

export interface ArchitectureNode {
  id: string;
  label: string;
  category: 'channel' | 'copilot' | 'flow' | 'data';
  status: 'active' | 'syncing' | 'idle';
  detail: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

/**
 * 3D Live Power Platform Solution Architecture Board.
 * Displays the complete end-to-end architecture flow:
 * [Channels / Users] -> [Copilot Studio Orchestrator] -> [Power Automate Cloud Flows] -> [Dataverse & Graph APIs]
 * Includes visual connectivity pipelines, live glowing telemetry pulses, and status indicators.
 */
export function SolutionArchitectureBoard({
  position,
  rotationY = -Math.PI / 2,
  width = 6.4,
  height = 3.2,
  repoId,
}: {
  position: [number, number, number];
  rotationY?: number;
  width?: number;
  height?: number;
  repoId?: string;
}) {
  const ref = useInteractable<THREE.Group>(
    { id: `solution-arch-${repoId ?? 'default'}`, label: 'Inspect Solution Architecture (E)', action: { kind: 'solution-architecture', repoId } },
    6.5,
  );
  const texW = 2048;
  const texH = 1024;

  const tex = useCanvasTexture(
    texW,
    texH,
    (ctx) => {
      // 1. Fluent Acrylic dark glass backdrop
      ctx.fillStyle = '#0f172a';
      roundRect(ctx, 0, 0, texW, texH, 32);
      ctx.fill();

      // Fluent inner highlight border
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Top title bar with Fluent gradient
      const topGrad = ctx.createLinearGradient(0, 0, texW, 0);
      topGrad.addColorStop(0, '#0078D4');
      topGrad.addColorStop(0.5, '#774AE0');
      topGrad.addColorStop(1, '#9B2C9B');
      ctx.fillStyle = topGrad;
      roundRect(ctx, 16, 16, texW - 32, 70, 16);
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.font = `800 36px ${SANS}`;
      ctx.textBaseline = 'middle';
      ctx.fillText('🏛️ POWER PLATFORM & COPILOT STUDIO SOLUTION ARCHITECTURE', 40, 52);

      ctx.textAlign = 'right';
      ctx.font = `600 22px ${SANS}`;
      ctx.fillStyle = '#E0F2FE';
      ctx.fillText('LIVE ALM PIPELINE · ENTERPRISE ORCHESTRATION', texW - 40, 52);
      ctx.textAlign = 'left';

      // 2. Define Architecture Tiers
      const tiers = [
        { label: '1. ENGAGEMENT CHANNELS', x: 60, w: 420 },
        { label: '2. COPILOT STUDIO AGENT CORE', x: 530, w: 470 },
        { label: '3. POWER AUTOMATE & LOGIC', x: 1050, w: 450 },
        { label: '4. DATAVERSE & ENTERPRISE DATA', x: 1550, w: 440 },
      ];

      tiers.forEach((t) => {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        roundRect(ctx, t.x, 110, t.w, texH - 140, 20);
        ctx.fill();

        ctx.fillStyle = '#94A3B8';
        ctx.font = `700 20px ${SANS}`;
        ctx.fillText(t.label, t.x + 20, 142);
      });

      // 3. Connective Data Pipes / Connectors
      const drawPipe = (x1: number, y1: number, x2: number, y2: number, color: string) => {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        ctx.setLineDash([12, 8]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.bezierCurveTo((x1 + x2) / 2, y1, (x1 + x2) / 2, y2, x2, y2);
        ctx.stroke();
        ctx.restore();
      };

      // Pipes connecting tiers
      drawPipe(460, 250, 550, 260, '#38BDF8');
      drawPipe(460, 420, 550, 360, '#818CF8');
      drawPipe(980, 260, 1070, 280, '#C084FC');
      drawPipe(980, 480, 1070, 480, '#E879F9');
      drawPipe(1480, 280, 1570, 300, '#4ADE80');
      drawPipe(1480, 520, 1570, 520, '#FACC15');

      // 4. Render Architecture Component Cards
      interface CardSpec {
        x: number;
        y: number;
        w: number;
        h: number;
        title: string;
        sub: string;
        badge: string;
        badgeBg: string;
        iconName?: keyof typeof FLUENT_ICONS;
        border: string;
      }

      const cards: CardSpec[] = [
        // Channels
        { x: 80, y: 180, w: 380, h: 140, title: 'Microsoft Teams & Outlook', sub: 'Adaptive Cards v1.5 · Mobile & Desktop', badge: 'ACTIVE CHANNEL', badgeBg: '#464EB8', iconName: 'teams', border: '#6366F1' },
        { x: 80, y: 350, w: 380, h: 140, title: 'Power Pages & Web Canvas', sub: 'Embedded Copilot Webchat · SSO / Entra ID', badge: 'AUTHENTICATED', badgeBg: '#0284C7', iconName: 'word', border: '#38BDF8' },
        { x: 80, y: 520, w: 380, h: 140, title: 'Custom PCF Control Host', sub: 'Model-Driven & Canvas App Form Integration', badge: 'FLUENT REACT', badgeBg: '#742774', iconName: 'powerapps', border: '#C084FC' },
        { x: 80, y: 690, w: 380, h: 140, title: 'Voice & Omnichannel', sub: 'Azure Communication Services Telephony', badge: 'REAL-TIME STREAM', badgeBg: '#059669', iconName: 'azure', border: '#34D399' },

        // Copilot Studio Core
        { x: 550, y: 180, w: 430, h: 190, title: 'Copilot Studio Topics Engine', sub: 'Intent Classifier · 28 Custom Topics\nEntity Extraction · Dynamic System Prompts', badge: 'GENERATIVE AI', badgeBg: '#774AE0', iconName: 'copilot', border: '#A855F7' },
        { x: 550, y: 400, w: 430, h: 180, title: 'Azure OpenAI Fallback Node', sub: 'GPT-4o Reasoning · Vector Search RAG\nEnterprise SharePoint Document Indexing', badge: 'GROUNDED RAG', badgeBg: '#0078D4', iconName: 'azure', border: '#60A5FA' },
        { x: 550, y: 610, w: 430, h: 220, title: 'Guardrails & Safety Evaluator', sub: 'Responsible AI Filter · Prompt Shield\nPII Masking · Topic Boundary Checks', badge: 'ZERO JAILBREAKS', badgeBg: '#059669', iconName: 'microsoft', border: '#4ADE80' },

        // Power Automate & Logic
        { x: 1070, y: 190, w: 410, h: 190, title: 'Instant Cloud Flows', sub: 'HTTP Triggered from Copilot Action\nJSON Schema Validation & Exception Guard', badge: 'FLOW ORCHESTRATOR', badgeBg: '#0066FF', iconName: 'powerautomate', border: '#60A5FA' },
        { x: 1070, y: 410, w: 410, h: 190, title: 'Adaptive Card Approval Flow', sub: 'Manager Multi-stage Signoff in Teams\nAsynchronous Webhook Callback', badge: 'APPROVAL ENGINE', badgeBg: '#D97706', iconName: 'teams', border: '#FBBF24' },
        { x: 1070, y: 630, w: 410, h: 200, title: 'Custom Connector Broker', sub: 'OAuth2 Authentication · Graph API Client\nRate Limiting & Token Cache', badge: 'PRO-CODE GATEWAY', badgeBg: '#7C3AED', iconName: 'powerplatform', border: '#C084FC' },

        // Dataverse & Data
        { x: 1570, y: 190, w: 400, h: 230, title: 'Microsoft Dataverse Schema', sub: 'cr_ServiceTicket · cr_KnowledgeTopic\nRole-Based Column Security · Auditing', badge: 'SYSTEM OF RECORD', badgeBg: '#742774', iconName: 'powerplatform', border: '#E879F9' },
        { x: 1570, y: 450, w: 400, h: 180, title: 'Microsoft Graph API v1.0', sub: 'User Profile (/me) · Org Chart\nSharePoint Online Document Retrieval', badge: 'M365 CONNECTED', badgeBg: '#0284C7', iconName: 'microsoft', border: '#38BDF8' },
        { x: 1570, y: 660, w: 400, h: 170, title: 'Power BI Live Telemetry Hub', sub: 'Topic Completion Rates · Latency Metrics\nExecutive Cost & ROI Telemetry', badge: 'STREAMING BI', badgeBg: '#D97706', iconName: 'powerbi', border: '#FBBF24' },
      ];

      cards.forEach((c) => {
        // Card Body
        roundRect(ctx, c.x, c.y, c.w, c.h, 16);
        ctx.fillStyle = '#1e293b';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = c.border;
        ctx.stroke();

        // Icon
        const hasIcon = c.iconName && FLUENT_ICONS[c.iconName];
        if (hasIcon) {
          ctx.save();
          ctx.translate(c.x + 14, c.y + 14);
          FLUENT_ICONS[c.iconName!].draw(ctx, 38);
          ctx.restore();
        }

        // Measure Badge First
        ctx.font = `700 11px ${SANS}`;
        const badgePaddingX = 14;
        const bw = ctx.measureText(c.badge).width + badgePaddingX * 2;
        const badgeX = c.x + c.w - bw - 12;
        const badgeY = c.y + 14;
        roundRect(ctx, badgeX, badgeY, bw, 22, 11);
        ctx.fillStyle = c.badgeBg;
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(c.badge, badgeX + bw / 2, badgeY + 11);
        ctx.textAlign = 'left';

        // Title (give enough clearance so it never touches badge)
        const titleX = hasIcon ? c.x + 58 : c.x + 16;
        const maxTitleW = badgeX - titleX - 10;
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `700 17px ${SANS}`;
        ctx.textBaseline = 'middle';
        
        // Truncate title if it exceeds available space
        let displayTitle = c.title;
        if (ctx.measureText(displayTitle).width > maxTitleW) {
          while (displayTitle.length > 0 && ctx.measureText(displayTitle + '…').width > maxTitleW) {
            displayTitle = displayTitle.slice(0, -1);
          }
          displayTitle += '…';
        }
        ctx.fillText(displayTitle, titleX, c.y + 25);

        // Subtitle / Details
        ctx.fillStyle = '#94A3B8';
        ctx.font = `500 14px ${SANS}`;
        ctx.textBaseline = 'alphabetic';
        const lines = c.sub.split('\n');
        lines.forEach((l, idx) => {
          ctx.fillText(l, c.x + 16, c.y + 70 + idx * 22);
        });
      });

      // Bottom Status Footer
      ctx.fillStyle = '#38BDF8';
      ctx.font = `600 18px ${SANS}`;
      ctx.fillText('⚡ Autonomous Agent Actions: Active Topic Testing · Continuous Solution Checkers · Zero Security Violations', 60, texH - 18);
    },
    [],
  );

  return (
    <group ref={ref} position={position} rotation={[0, rotationY, 0]}>
      {/* Board Frame */}
      <Box size={[width + 0.16, height + 0.16, 0.08]} position={[0, height / 2, 0]} color="#334155" outline />
      {/* Visual Canvas Face */}
      <mesh position={[0, height / 2, 0.045]}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
      {/* Acrylic glowing accent base */}
      <mesh position={[0, 0.04, 0.06]}>
        <boxGeometry args={[width, 0.06, 0.1]} />
        <meshBasicMaterial color="#0078D4" />
      </mesh>
    </group>
  );
}
