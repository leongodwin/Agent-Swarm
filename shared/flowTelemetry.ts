export interface FlowRunStep {
  num: number;
  name: string;
  type: string;
  duration: string;
  status: string;
  color: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

export interface FlowRun {
  id: string;
  triggerName: string;
  triggerType: string;
  status: 'Succeeded' | 'Failed' | 'Running';
  startedAt: string;
  duration: string;
  flowId: string;
  steps: FlowRunStep[];
}

export const INITIAL_FLOW_RUNS: FlowRun[] = [
  {
    id: '20261006-1420-01',
    triggerName: 'When a HTTP request is received (Copilot Studio Action)',
    triggerType: 'Request Trigger',
    status: 'Succeeded',
    startedAt: 'Just now',
    duration: '312 ms',
    flowId: 'flw_dispatch_ticket_v2',
    steps: [
      {
        num: 1,
        name: 'When a HTTP request is received (Copilot Studio Action)',
        type: 'Trigger · Request',
        duration: '14 ms',
        status: '200 OK',
        color: '#38bdf8',
        input: { method: 'POST', schema: 'ServiceRequestTicketSchema' },
        output: { ticketId: 'CAS-10492-X9', urgency: 'High', customerEmail: 'alex.w@contoso.com' },
      },
      {
        num: 2,
        name: 'Microsoft Dataverse: Get row by ID (cr_ticket)',
        type: 'Action · Dataverse Connector',
        duration: '124 ms',
        status: '200 OK',
        color: '#c084fc',
        input: { table: 'cr_tickets', rowId: '7f91a2bc-33d1-4e89-a1b2' },
        output: { cr_ticketnumber: 'CAS-10492-X9', cr_slahours: 2, cr_owner: 'Fabrikam Support' },
      },
      {
        num: 3,
        name: 'Condition: Evaluate SLA Urgency & Routing Policy',
        type: 'Control · Condition Branch',
        duration: '2 ms',
        status: 'TRUE',
        color: '#facc15',
        input: { expression: 'less(body("Dataverse")?["cr_slahours"], 4)' },
        output: { branchTaken: 'EscalationTier2' },
      },
      {
        num: 4,
        name: 'Microsoft Teams: Post Adaptive Card to Tier 2 Escalations',
        type: 'Action · Teams Connector v3',
        duration: '168 ms',
        status: '201 Created',
        color: '#60a5fa',
        input: { channelId: '19:support-escalations@thread.tacv2', cardVersion: '1.5' },
        output: { messageId: 'msg_9941', status: 'Delivered', recipientCount: 8 },
      },
      {
        num: 5,
        name: 'Respond to Copilot Studio with Adaptive Card Payload',
        type: 'Action · HTTP Response',
        duration: '4 ms',
        status: '200 OK',
        color: '#4ade80',
        input: { statusCode: 200, contentType: 'application/json' },
        output: { escalationDispatched: true, ticketNumber: 'CAS-10492-X9', queueStatus: 'Assigned to Tier 2' },
      },
    ],
  },
  {
    id: '20261006-1412-44',
    triggerName: 'When a row is added or modified (Dataverse Webhook)',
    triggerType: 'Dataverse Trigger',
    status: 'Succeeded',
    startedAt: '8m ago',
    duration: '428 ms',
    flowId: 'flw_dataverse_sync_audit',
    steps: [
      {
        num: 1,
        name: 'When a row is added or modified (Dataverse)',
        type: 'Trigger · Dataverse',
        duration: '18 ms',
        status: 'Triggered',
        color: '#c084fc',
        input: { entityName: 'cr_EquipmentInspection', scope: 'Organization' },
        output: { inspectionId: 'INSP-901', defectLevel: 'Minor', technicianId: 'tech_48' },
      },
      {
        num: 2,
        name: 'Transform JSON to Common Data Model Record',
        type: 'Data Operation · Parse JSON',
        duration: '6 ms',
        status: '200 OK',
        color: '#38bdf8',
        input: { content: '@triggerOutputs()?[\'body\']' },
        output: { parsedAttributes: 14, schemaVersion: '2.1' },
      },
      {
        num: 3,
        name: 'SAP REST Gateway: Update Maintenance WorkOrder',
        type: 'Action · Custom Connector',
        duration: '392 ms',
        status: '200 OK',
        color: '#0284c7',
        input: { endpoint: '/api/v1/workorders/sync', method: 'PUT' },
        output: { sapConfirmationCode: 'SAP-WO-881920', synced: true },
      },
    ],
  },
  {
    id: '20261006-1358-12',
    triggerName: 'Recurrence: Hourly Knowledge Base Vector Embeddings',
    triggerType: 'Scheduled Recurrence',
    status: 'Failed',
    startedAt: '22m ago',
    duration: '1.4 s',
    flowId: 'flw_rag_vector_indexing',
    steps: [
      {
        num: 1,
        name: 'Recurrence Schedule Trigger',
        type: 'Trigger · Recurrence',
        duration: '1 ms',
        status: 'Fired',
        color: '#facc15',
        input: { interval: 1, frequency: 'Hour' },
        output: { scheduledTime: '2026-10-06T13:00:00Z' },
      },
      {
        num: 2,
        name: 'SharePoint Online: List updated documents in Policy Library',
        type: 'Action · SharePoint Connector',
        duration: '320 ms',
        status: '200 OK',
        color: '#60a5fa',
        input: { siteUrl: 'https://contoso.sharepoint.com/sites/support', library: 'Policies' },
        output: { fileCount: 4, files: ['SOP-FieldSafety.pdf', 'WarrantyTerms.docx'] },
      },
      {
        num: 3,
        name: 'Azure AI Search: Generate Chunk Embeddings (Ada-002)',
        type: 'Action · Azure AI Search',
        duration: '1079 ms',
        status: '429 RateLimit',
        color: '#ef4444',
        input: { deployment: 'text-embedding-ada-002', tokensTotal: 18400 },
        output: { error: 'Rate limit reached for model text-embedding-ada-002 in EastUS. Retrying in 12s.' },
      },
    ],
  },
];
