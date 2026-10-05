import * as THREE from 'three';
import { roundRect, SANS } from './draw';
import { useCanvasTexture, useInteractable } from './interact';
import { Box } from './Toon';
import { FLUENT_ICONS } from './FluentIcons';

/**
 * 3D Power Automate Flow Run History & Step Telemetry Board.
 * Displays live execution stages, latency per step, trigger payloads, and Dataverse connector calls.
 */
export function FlowRunHistoryBoard({
  position,
  rotationY = -Math.PI / 2,
  width = 5.2,
  height = 2.6,
  repoId,
}: {
  position: [number, number, number];
  rotationY?: number;
  width?: number;
  height?: number;
  repoId?: string;
}) {
  const ref = useInteractable<THREE.Group>(
    { id: `flow-runs-${repoId ?? 'default'}`, label: 'Inspect Power Automate Flow Runs (E)', action: { kind: 'flow-runs', repoId } },
    6.5,
  );
  const texW = 1600;
  const texH = 800;

  const tex = useCanvasTexture(
    texW,
    texH,
    (ctx) => {
      // 1. Dark Acrylic Background
      ctx.fillStyle = '#081226';
      roundRect(ctx, 0, 0, texW, texH, 24);
      ctx.fill();

      // Highlight border
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0, 102, 255, 0.4)';
      ctx.stroke();

      // Top title bar
      const topGrad = ctx.createLinearGradient(0, 0, texW, 0);
      topGrad.addColorStop(0, '#004CBF');
      topGrad.addColorStop(0.5, '#0078D4');
      topGrad.addColorStop(1, '#00BCFF');
      ctx.fillStyle = topGrad;
      roundRect(ctx, 16, 16, texW - 32, 64, 14);
      ctx.fill();

      // Flow icon
      ctx.save();
      ctx.translate(28, 22);
      FLUENT_ICONS.powerautomate.draw(ctx, 52);
      ctx.restore();

      ctx.fillStyle = '#ffffff';
      ctx.font = `800 28px ${SANS}`;
      ctx.textBaseline = 'middle';
      ctx.fillText('POWER AUTOMATE · CLOUD FLOW EXECUTION ENGINE', 92, 48);

      ctx.textAlign = 'right';
      ctx.font = `600 18px ${SANS}`;
      ctx.fillStyle = '#dbeafe';
      ctx.fillText('FLOW ID: flw_dispatch_ticket_v2 · STATUS: ACTIVE ⚡', texW - 32, 48);
      ctx.textAlign = 'left';

      // 2. Left Column: Run History List
      roundRect(ctx, 32, 100, 480, texH - 132, 16);
      ctx.fillStyle = '#0f172a';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#1e293b';
      ctx.stroke();

      ctx.fillStyle = '#94a3b8';
      ctx.font = `700 16px ${SANS}`;
      ctx.fillText('RECENT RUN HISTORY', 52, 128);

      const runs = [
        { id: '20261003-0948-21', trigger: 'Copilot Studio Action', dur: '312 ms', status: 'Succeeded', time: 'Just now' },
        { id: '20261003-0944-10', trigger: 'Dataverse Row Modified', dur: '428 ms', status: 'Succeeded', time: '4m ago' },
        { id: '20261003-0938-55', trigger: 'Teams Adaptive Response', dur: '184 ms', status: 'Succeeded', time: '9m ago' },
        { id: '20261003-0925-02', trigger: 'HTTP Webhook Trigger', dur: '290 ms', status: 'Succeeded', time: '23m ago' },
        { id: '20261003-0912-44', trigger: 'Copilot Studio Action', dur: '360 ms', status: 'Succeeded', time: '35m ago' },
      ];

      runs.forEach((r, idx) => {
        const ry = 154 + idx * 96;
        roundRect(ctx, 48, ry, 448, 82, 10);
        ctx.fillStyle = idx === 0 ? 'rgba(0, 102, 255, 0.15)' : '#1e293b';
        ctx.fill();
        ctx.lineWidth = idx === 0 ? 2 : 1;
        ctx.strokeStyle = idx === 0 ? '#38bdf8' : '#334155';
        ctx.stroke();

        ctx.fillStyle = idx === 0 ? '#38bdf8' : '#e2e8f0';
        ctx.font = `700 16px ${SANS}`;
        ctx.fillText(r.trigger, 64, ry + 28);

        ctx.fillStyle = '#94a3b8';
        ctx.font = `500 13px ${SANS}`;
        ctx.fillText(`Run ${r.id} · ${r.dur}`, 64, ry + 56);

        ctx.textAlign = 'right';
        ctx.fillStyle = '#4ade80';
        ctx.font = `700 14px ${SANS}`;
        ctx.fillText(`✓ ${r.status}`, 480, ry + 28);
        ctx.fillStyle = '#64748b';
        ctx.font = `500 12px ${SANS}`;
        ctx.fillText(r.time, 480, ry + 56);
        ctx.textAlign = 'left';
      });

      // 3. Right Column: Step-by-Step Execution Pipeline Breakdown
      roundRect(ctx, 532, 100, texW - 564, texH - 132, 16);
      ctx.fillStyle = '#0f172a';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#1e293b';
      ctx.stroke();

      ctx.fillStyle = '#94a3b8';
      ctx.font = `700 16px ${SANS}`;
      ctx.fillText('LIVE STEP EXECUTION PIPELINE (LATEST RUN)', 556, 128);

      const steps = [
        {
          num: 1,
          name: 'When a HTTP request is received (Copilot Studio Action)',
          type: 'Trigger · Request',
          dur: '14 ms',
          status: '200 OK',
          detail: 'Parsed payload: { ticketId: "CAS-10492-X9", urgency: "High" }',
          color: '#38bdf8',
        },
        {
          num: 2,
          name: 'Microsoft Dataverse: Get row by ID (cr_ticket)',
          type: 'Action · Dataverse Connector',
          dur: '124 ms',
          status: '200 OK',
          detail: 'Matched cr_ticket: SLA due in 2h · Owner: Fabrikam Support',
          color: '#c084fc',
        },
        {
          num: 3,
          name: 'Condition: Evaluate SLA Urgency & Routing Policy',
          type: 'Control · Condition Branch',
          dur: '2 ms',
          status: 'TRUE',
          detail: 'Expression: less(body("Dataverse")?["cr_slahours"], 4) -> Branch: Escalation',
          color: '#facc15',
        },
        {
          num: 4,
          name: 'Microsoft Teams: Post Adaptive Card to Tier 2 Escalations',
          type: 'Action · Teams Connector v3',
          dur: '168 ms',
          status: '201 Created',
          detail: 'Card ID: msg_9941 · Action Buttons: [Approve Escalation, Assign]',
          color: '#60a5fa',
        },
        {
          num: 5,
          name: 'Respond to Copilot Studio with Adaptive Card Payload',
          type: 'Action · HTTP Response',
          dur: '4 ms',
          status: '200 OK',
          detail: 'Return JSON payload to conversational agent node',
          color: '#4ade80',
        },
      ];

      steps.forEach((s, idx) => {
        const sy = 154 + idx * 114;
        roundRect(ctx, 552, sy, texW - 604, 98, 12);
        ctx.fillStyle = '#1e293b';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#334155';
        ctx.stroke();

        // Step number badge
        roundRect(ctx, 566, sy + 16, 32, 32, 16);
        ctx.fillStyle = s.color;
        ctx.fill();
        ctx.fillStyle = '#0f172a';
        ctx.font = `800 16px ${SANS}`;
        ctx.textAlign = 'center';
        ctx.fillText(String(s.num), 582, sy + 33);
        ctx.textAlign = 'left';

        // Step Title
        ctx.fillStyle = '#ffffff';
        ctx.font = `700 18px ${SANS}`;
        ctx.fillText(s.name, 612, sy + 28);

        // Step Type
        ctx.fillStyle = s.color;
        ctx.font = `600 13px ${SANS}`;
        ctx.fillText(s.type, 612, sy + 48);

        // Detail
        ctx.fillStyle = '#94a3b8';
        ctx.font = `500 14px ${SANS}`;
        ctx.fillText(s.detail, 566, sy + 80);

        // Timing & Status right badge
        ctx.textAlign = 'right';
        ctx.fillStyle = '#4ade80';
        ctx.font = `700 15px ${SANS}`;
        ctx.fillText(`✓ ${s.status}`, texW - 72, sy + 28);

        ctx.fillStyle = '#64748b';
        ctx.font = `600 13px ${SANS}`;
        ctx.fillText(`⏱️ ${s.dur}`, texW - 72, sy + 50);
        ctx.textAlign = 'left';
      });
    },
    [],
  );

  return (
    <group ref={ref} position={position} rotation={[0, rotationY, 0]}>
      {/* Board Frame */}
      <Box size={[width + 0.14, height + 0.14, 0.06]} position={[0, height / 2, 0]} color="#1e293b" outline />
      {/* Display Plane */}
      <mesh position={[0, height / 2, 0.035]}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </group>
  );
}
