import { roundRect, SANS } from './draw';
import { useCanvasTexture } from './interact';
import { Box } from './Toon';

/**
 * 3D Dataverse Schema & Entity Relationship Diagram (ERD) Visualizer Monitor.
 * Displays tables, columns, data types, relationships (1:N, N:1), and ALM migration states.
 */
export function DataverseSchemaMonitor({
  position,
  rotationY = 0,
  width = 3.2,
  height = 1.8,
}: {
  position: [number, number, number];
  rotationY?: number;
  width?: number;
  height?: number;
}) {
  const texW = 1280;
  const texH = 720;

  const tex = useCanvasTexture(
    texW,
    texH,
    (ctx) => {
      // 1. Dark Acrylic background
      ctx.fillStyle = '#0b132b';
      ctx.fillRect(0, 0, texW, texH);

      // Top title bar
      const topBar = ctx.createLinearGradient(0, 0, texW, 0);
      topBar.addColorStop(0, '#742774'); // Dataverse violet
      topBar.addColorStop(1, '#9B2C9B');
      ctx.fillStyle = topBar;
      ctx.fillRect(0, 0, texW, 64);

      ctx.fillStyle = '#ffffff';
      ctx.font = `800 28px ${SANS}`;
      ctx.textBaseline = 'middle';
      ctx.fillText('🗄️ MICROSOFT DATAVERSE SCHEMA & ERD EXPLORER', 28, 32);

      ctx.textAlign = 'right';
      ctx.font = `700 18px ${SANS}`;
      ctx.fillStyle = '#fde047';
      ctx.fillText('SOLUTION: contoso_core_v1.4.2 · [SIMULATED SCHEMA]', texW - 28, 32);
      ctx.textAlign = 'left';

      // 2. Entity Tables
      interface TableDef {
        x: number;
        y: number;
        w: number;
        name: string;
        schema: string;
        fields: { name: string; type: string; key?: boolean; rel?: string }[];
        status: string;
      }

      const tables: TableDef[] = [
        {
          x: 40,
          y: 90,
          w: 360,
          name: 'Support Ticket',
          schema: 'cr_ticket',
          status: 'ACTIVE TABLE',
          fields: [
            { name: 'cr_ticketid', type: 'UniqueIdentifier', key: true },
            { name: 'cr_ticketnumber', type: 'SingleLine.Text' },
            { name: 'cr_title', type: 'SingleLine.Text' },
            { name: 'cr_customerid', type: 'Lookup (account)', rel: 'N:1' },
            { name: 'cr_assignedto', type: 'Lookup (systemuser)', rel: 'N:1' },
            { name: 'cr_statuscode', type: 'OptionSetValue' },
            { name: 'cr_sladuedate', type: 'DateTime' },
          ],
        },
        {
          x: 460,
          y: 90,
          w: 360,
          name: 'Copilot Session Log',
          schema: 'cr_copilotsession',
          status: 'MIGRATED',
          fields: [
            { name: 'cr_sessionid', type: 'UniqueIdentifier', key: true },
            { name: 'cr_ticketid', type: 'Lookup (cr_ticket)', rel: 'N:1' },
            { name: 'cr_matchedtopic', type: 'SingleLine.Text' },
            { name: 'cr_confidence', type: 'Decimal' },
            { name: 'cr_durationms', type: 'Integer' },
            { name: 'cr_sentiment', type: 'OptionSetValue' },
            { name: 'cr_resolution', type: 'Boolean' },
          ],
        },
        {
          x: 880,
          y: 90,
          w: 360,
          name: 'Approval Request',
          schema: 'cr_approvalrequest',
          status: 'CLOUD FLOW LINKED',
          fields: [
            { name: 'cr_approvalid', type: 'UniqueIdentifier', key: true },
            { name: 'cr_ticketid', type: 'Lookup (cr_ticket)', rel: 'N:1' },
            { name: 'cr_approveremail', type: 'SingleLine.Email' },
            { name: 'cr_stage', type: 'OptionSetValue' },
            { name: 'cr_teamsmessageid', type: 'SingleLine.Text' },
            { name: 'cr_approvedon', type: 'DateTime' },
          ],
        },
      ];

      // Draw ERD Tables
      tables.forEach((t) => {
        const h = 54 + t.fields.length * 36 + 24;
        roundRect(ctx, t.x, t.y, t.w, h, 14);
        ctx.fillStyle = '#1c2541';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#3a506b';
        ctx.stroke();

        // Table Header
        roundRect(ctx, t.x, t.y, t.w, 52, 14);
        ctx.fillStyle = '#243258';
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = `700 20px ${SANS}`;
        ctx.fillText(t.name, t.x + 16, t.y + 24);

        ctx.fillStyle = '#94a3b8';
        ctx.font = `500 14px ${SANS}`;
        ctx.fillText(t.schema, t.x + 16, t.y + 42);

        // Fields
        t.fields.forEach((f, idx) => {
          const fy = t.y + 70 + idx * 36;
          ctx.fillStyle = f.key ? '#fde047' : '#e2e8f0';
          ctx.font = `${f.key ? '700' : '500'} 15px ${SANS}`;
          ctx.fillText(`${f.key ? '🔑 ' : '• '}${f.name}`, t.x + 16, fy);

          ctx.fillStyle = f.rel ? '#38bdf8' : '#64748b';
          ctx.textAlign = 'right';
          ctx.font = `600 13px ${SANS}`;
          ctx.fillText(f.type, t.x + t.w - 16, fy);
          ctx.textAlign = 'left';
        });
      });

      // Connecting ERD relationship lines
      const drawRel = (x1: number, y1: number, x2: number, y2: number) => {
        ctx.save();
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.bezierCurveTo(x1 + 40, y1, x2 - 40, y2, x2, y2);
        ctx.stroke();
        ctx.restore();
      };

      drawRel(400, 205, 460, 170); // Ticket -> Copilot Session
      drawRel(820, 170, 880, 205); // Copilot Session -> Approval Request

      // Schema Sync Terminal line at bottom
      roundRect(ctx, 40, 520, texW - 80, 160, 14);
      ctx.fillStyle = '#0f172a';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#742774';
      ctx.stroke();

      ctx.fillStyle = '#f5d0fe';
      ctx.font = `700 16px ${SANS}`;
      ctx.fillText('⚡ PAC CLI SOLUTION SYNCHRONIZER & AUDIT TELEMETRY', 60, 548);

      const logs = [
        '✓ [pac solution pack] Successfully packed 3 custom entities and 8 cloud flow bindings into contoso_core.zip',
        '✓ [pac model-builder] Generated TypeScript strongly-typed entities: CrTicket, CrCopilotSession',
        '✓ [Dataverse Solution Checker] Passed: 0 High, 0 Medium, 0 Low rule violations detected',
        '✓ [GitHub Action ALM] Deployed to QA environment https://contoso-qa.crm.dynamics.com',
      ];

      ctx.font = `500 14px ${SANS}`;
      ctx.fillStyle = '#34d399';
      logs.forEach((l, i) => {
        ctx.fillText(l, 60, 580 + i * 24);
      });
    },
    [],
  );

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* Bezel frame */}
      <Box size={[width + 0.12, height + 0.12, 0.06]} position={[0, height / 2, 0]} color="#1e293b" outline />
      {/* Screen display */}
      <mesh position={[0, height / 2, 0.035]}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </group>
  );
}
