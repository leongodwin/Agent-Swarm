/**

 * Power Platform Unpacked Solution Parser

 * Scans a repository checkout for unpacked solution artifacts:

 * - BotComponents / Topics (*.yaml) -> Copilot Studio conversational nodes

 * - Workflows / Flows (*.json) -> Power Automate cloud flow nodes

 * - Entities / Tables (*.xml) -> Dataverse entity schema nodes

 * - PCF Controls (ControlManifest.Input.xml) -> Custom UI components

 */



import fs from 'node:fs';

import path from 'node:path';

import type { SolutionComponentNode, ParsedSolution } from './solutionTypes.ts';



export type { SolutionComponentNode, ParsedSolution };



export const FALLBACK_SOLUTION_NODES: Record<string, SolutionComponentNode> = {

  teams: {

    id: 'teams',

    category: '1. Engagement Channel',

    name: 'Microsoft Teams & Outlook Channels',

    badge: 'ACTIVE CHANNEL',

    badgeBg: '#464EB8',

    summary: 'Interactive conversational frontend leveraging Adaptive Cards v1.5 for desktop and mobile.',

    techStack: ['Bot Framework SDK', 'Adaptive Cards v1.5', 'Teams Activity Handler', 'SSO / Entra ID'],

    telemetry: { invocations: '1,420 msgs/hr', avgLatency: '82 ms', successRate: '99.9%' },

    details: 'Handles user prompt ingestion, rich action buttons for approvals, and streaming responses directly into Teams chats.',

  },

  pages: {

    id: 'pages',

    category: '1. Engagement Channel',

    name: 'Power Pages & Web Canvas Webchat',

    badge: 'AUTHENTICATED',

    badgeBg: '#0284C7',

    summary: 'Customer self-service portal embedding Microsoft Copilot Studio webchat with Entra ID B2C.',

    techStack: ['Power Pages Liquid Templates', 'Copilot Webchat v4', 'Entra ID External Identities'],

    telemetry: { invocations: '890 sessions/day', avgLatency: '94 ms', successRate: '99.8%' },

    details: 'Enables unauthenticated anonymous knowledge lookup with gated escalation to authenticated support tickets upon login.',

  },

  pcf: {

    id: 'pcf',

    category: '1. Engagement Channel',

    name: 'Custom PCF Control Form Host',

    badge: 'FLUENT REACT',

    badgeBg: '#742774',

    summary: 'Custom React Fluent UI v9 controls integrated into Model-Driven & Canvas App forms.',

    techStack: ['Power Apps Component Framework (PCF)', 'Fluent UI React v9', 'Dataverse Web API'],

    telemetry: { invocations: '4,210 renders', avgLatency: '16 ms', successRate: '100%' },

    details: 'Empowers back-office claim adjusters with rich multi-photo inspection grids and direct trigger hooks into Copilot topics.',

  },

  voice: {

    id: 'voice',

    category: '1. Engagement Channel',

    name: 'Voice & Omnichannel Telephony Gateway',

    badge: 'REAL-TIME STREAM',

    badgeBg: '#059669',

    summary: 'Azure Communication Services integration for telephony with real-time speech transcription.',

    techStack: ['Azure Communication Services', 'Cognitive Speech Services', 'Direct Line Speech'],

    telemetry: { invocations: '340 calls/day', avgLatency: '180 ms', successRate: '98.9%' },

    details: 'Converts inbound call audio into streaming text utterances, executes topic routing, and responds with synthetic neural voice.',

  },

  copilot_engine: {

    id: 'copilot_engine',

    category: '2. Copilot Studio',

    name: 'Copilot Studio Autonomous Bot Core',

    badge: 'ORCHESTRATOR',

    badgeBg: '#774AE0',

    summary: 'Central generative agent managing multi-turn topic graphs and system instructions.',

    techStack: ['Copilot Studio Runtime', 'Topic YAML', 'Entity Extraction Engine', 'Power Fx Variables'],

    telemetry: { invocations: '2,650 turns/hr', avgLatency: '320 ms', successRate: '99.7%' },

    details: 'Executes conversational orchestration, evaluates user intents against topic triggers, and manages stateful conversation variables.',

  },

  azure_openai: {

    id: 'azure_openai',

    category: '2. Copilot Studio',

    name: 'Azure OpenAI & Generative Answers',

    badge: 'GPT-4o RAG',

    badgeBg: '#0078D4',

    summary: 'Enterprise RAG grounding prompts across Dataverse records and company knowledge bases.',

    techStack: ['Azure OpenAI Service', 'Azure AI Search', 'Semantic Indexing', 'Blob Storage'],

    telemetry: { invocations: '1,890 answers/day', avgLatency: '680 ms', successRate: '99.4%' },

    details: 'Synthesizes domain answers from indexed company manuals with citations, grounding checks, and prompt moderation.',

  },

  guardrails: {

    id: 'guardrails',

    category: '2. Copilot Studio',

    name: 'DLP & Prompt Safety Guardrails Lab',

    badge: 'COMPLIANCE SHIELD',

    badgeBg: '#DC2626',

    summary: 'In-line prompt injection defense, PII data masking, and content safety filters.',

    techStack: ['Azure AI Content Safety', 'Custom Regex DLP Scanners', 'Entra ID Policy Gate'],

    telemetry: { invocations: '100% inspected', avgLatency: '18 ms', successRate: '100%' },

    details: 'Audits every incoming prompt and outbound response for safety, sanitizing credit card numbers and passwords.',

  },

  cloud_flow_1: {

    id: 'cloud_flow_1',

    category: '3. Automation & Logic',

    name: 'Instant Cloud Flow: Dispatch & Approvals',

    badge: 'CRITICAL SLA',

    badgeBg: '#0066FF',

    summary: 'Triggers when a safety issue is flagged; generates Adaptive Cards in Teams for supervisor sign-off.',

    techStack: ['Power Automate Cloud Flow', 'Teams Connector', 'Dataverse Webhook', 'OData JSON'],

    telemetry: { invocations: '312 runs/day', avgLatency: '840 ms', successRate: '99.1%' },

    details: 'Formats damage photos into rich Adaptive Cards, pushes notifications to field supervisors, and records approval signatures.',

  },

  connector_sap: {

    id: 'connector_sap',

    category: '3. Automation & Logic',

    name: 'Custom ERP & SAP REST Connector',

    badge: 'CERTIFIED API',

    badgeBg: '#0284C7',

    summary: 'OpenAPI v3 custom connector syncing work orders and inventory parts with on-premise ERP.',

    techStack: ['Power Platform Custom Connector', 'On-Premises Data Gateway', 'SAP REST API'],

    telemetry: { invocations: '740 syncs/day', avgLatency: '410 ms', successRate: '99.6%' },

    details: 'Validates inventory stock levels and posts finalized work orders directly into SAP accounting modules.',

  },

  dataverse_tables: {

    id: 'dataverse_tables',

    category: '4. Dataverse & Storage',

    name: 'Microsoft Dataverse Core Relational Store',

    badge: 'COMMON DATA MODEL',

    badgeBg: '#9B2C9B',

    summary: 'Enterprise relational schema hosting Incidents, WorkOrders, and DefectItems.',

    techStack: ['Microsoft Dataverse v9.2', 'OData REST Endpoint', 'Column-Level Security', 'Azure SQL Hyperscale'],

    telemetry: { invocations: '14,800 queries/hr', avgLatency: '34 ms', successRate: '99.99%' },

    details: 'Stores normalized entities with role-based security, optimistic concurrency checks, and automated audit history.',

  },

};



/**

 * Inspects a repository folder on disk for unpacked Power Platform solution components.

 */

export function parseSolutionFolder(checkoutDir: string | null, demo = false): ParsedSolution {

  if (demo) return { solutionName: 'Demo Power Platform Accelerator', isUnpacked: false, simulated: true,

    totalComponents: Object.keys(FALLBACK_SOLUTION_NODES).length, components: structuredClone(FALLBACK_SOLUTION_NODES), warnings: [] };

  const components: Record<string, SolutionComponentNode> = {};

  const warnings: string[] = [];

  if (!checkoutDir || !fs.existsSync(checkoutDir)) return { solutionName: 'Repository unavailable', isUnpacked: false,

    simulated: false, totalComponents: 0, components, warnings: ['Checkout unavailable'] };

  const add = (kind: string, file: string, category: string, name: string, stack: string[]) => {

    const relative = path.relative(checkoutDir, file).replaceAll('\\', '/');

    const id = `${kind}_${encodeURIComponent(relative)}`;

    components[id] = { id, category, name, badge: 'REPO ARTIFACT', badgeBg: '#774AE0',

      summary: `Discovered ${relative}`, techStack: stack, telemetry: { invocations: 'Not measured', avgLatency: '—', successRate: '—' },

      details: `Source artifact: ${relative}. Runtime telemetry and deployment status are not available from this scan.`, sourceFile: relative };

  };

  const walk = (dir: string, depth = 0) => {

    if (depth > 12) { warnings.push(`Depth limit reached: ${path.relative(checkoutDir, dir)}`); return; }

    let entries: fs.Dirent[];

    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }

    catch { warnings.push(`Cannot read ${path.relative(checkoutDir, dir)}`); return; }

    for (const entry of entries) {

      if (entry.name.startsWith('.') || ['node_modules', 'dist'].includes(entry.name)) continue;

      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) { walk(full, depth + 1); continue; }

      if (!entry.isFile()) continue;

      const relative = path.relative(checkoutDir, full).replaceAll('\\', '/');

      const lower = entry.name.toLowerCase();

      const topic = /(?:^|\/)(topics|botcomponents)(?:\/|$)/i.test(relative) && /\.ya?ml$/.test(lower);

      const flow = /(?:^|\/)(workflows|flows)(?:\/|$)/i.test(relative) && lower.endsWith('.json');

      const entity = lower === 'entity.xml';

      const pcf = lower === 'controlmanifest.input.xml';

      if (!topic && !flow && !entity && !pcf) continue;

      try {

        if (fs.statSync(full).size > 5_000_000) { warnings.push(`Artifact too large: ${relative}`); continue; }

        const content = fs.readFileSync(full, 'utf8');

        const label = path.basename(entry.name, path.extname(entry.name));

        if (topic && /^\s*kind:\s*(AdaptiveDialog|BotComponent)\b/m.test(content)) add('topic', full, '2. Copilot Studio', `Topic: ${label}`, ['Copilot Studio', 'Topic YAML']);

        if (flow) {

          const json = JSON.parse(content);

          const definition = json?.properties?.definition ?? json?.definition ?? json;

          if (definition?.actions && typeof definition.actions === 'object' && definition?.triggers) add('flow', full, '3. Automation & Logic', `Cloud Flow: ${label}`, ['Power Automate', 'JSON Definition']);

        }

        if (entity && /<entity\b/i.test(content)) add('entity', full, '4. Dataverse & Storage', `Table: ${path.basename(dir)}`, ['Dataverse', 'Schema XML']);

        if (pcf && /<control\b/i.test(content)) add('pcf', full, '1. Engagement Channel', `PCF: ${path.basename(dir)}`, ['Power Apps Component Framework']);

      } catch { warnings.push(`Cannot parse ${relative}`); }

    }

  };

  walk(checkoutDir);

  return { solutionName: path.basename(checkoutDir), isUnpacked: Object.keys(components).length > 0,

    simulated: false, totalComponents: Object.keys(components).length, components, warnings };

}
