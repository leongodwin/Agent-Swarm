import {qualityDecisionSchema} from '../shared/qualityEvidence.ts';
import { deliveryCapabilitiesPrompt } from './deliveryCapabilities.ts';
import { skillDiscovery, readInstalledSkill } from './skillRegistry.ts';
import { templateCatalog, templateFiles, type TemplateId } from './implementationTemplates.ts';
import { DELIVERY_CEO } from '../shared/delivery.ts';
import { sessionAuthority, type SessionAuthorization } from './toolGovernance.ts';
import {createOfficeMcpServer,tool,type OfficeMcpConfig,type OfficeToolDefinition} from './officeMcp.ts';
import { z } from 'zod';
import { blockers, holdUps, setDependsOn } from '../shared/issues.ts';
import type { CeoJobKind } from '../shared/types.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import {deliverySourceRequest,readDeliverySource} from './deliverySourceRead.ts';

// The CEO: a coding-agent session in the lobby that runs the company instead of writing code.
// It studies each floor's repo, shapes the team (hire / let-go proposals the manager approves),
// plans work as GitHub issues, and writes each floor's QA brief. Everything it changes goes
// through the office tools below, so the swarm stays the single source of truth.

export interface CeoJob {
  kind: CeoJobKind;
  repoId?: string; // onboard / plan
  text?: string; // chat: the manager's message(s)
  at: number;
}

/** What the CEO's tools do. Implemented by the swarm; errors are returned to the CEO as tool errors. */
export interface OfficeHandlers {
  readDiscoveryEvidence?(input:unknown):Promise<unknown>;
  deliveryRecord?: RecordToolHandler;
  reviewDeliveryRecord?(repoId:string):Promise<string>;
  companyStatus(): string;
  deliveryStatus?(): string;
  capabilityStatus?(): string;
  reviewRelease?(id: string): Promise<string>;
  createRelease?(repoId: string, plan: unknown): Promise<string>;
  agentDetail(a: { agent_id: string }): string;
  setFloorProfile(a: { floor: number; summary?: string; qa_brief?: string; preview_command?: string; preview_env?: Record<string, string> }): string;
  updateJob(a: { agent_id: string; title?: string; specialty?: string; job_description?: string }): string;
  proposeHire(a: {
    floor: number;
    role: 'dev' | 'qa';
    title: string;
    specialty: string;
    job_description: string;
    reason: string;
    model?: string;
    effort?: string;
  }): string;
  proposeLetGo(a: { agent_id: string; reason: string }): string;
  fileIssue(a: { floor: number; title: string; body: string; specialty?: string }): Promise<string>;
  routeIssue(a: { floor: number; number: number; specialty?: string; depends_on?: number[] }): Promise<string>;
}

export interface OfficeTools {
  server: OfficeMcpConfig;
  /** A fresh MCP server with the same tools, for one request from a CEO running in a terminal (served over HTTP). */
  serve(): OfficeMcpConfig['instance'];
  /** Run a tool without a model in the loop (the demo CEO). */
  call(name: string, args: Record<string, unknown>): Promise<string>;
}

const EFFORT = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);

export type RecordToolHandler = (input: {repo_id:string; action:'browser_handoff'|'read'|'evidence_index'|'accepted_reports'|'task_input'|'save'|'amend_plan'|'inspect_repository'|'finding'|'synthesize_design'|'design_result'|'review'|'reject_inputs'|'review_task'|'reconcile_task'|'accept_slice'|'schema_bootstrap'|'canvas_packaging'; expected_revision?:number; payload_json?:string}) => Promise<string>;
function recordTools(handler?:RecordToolHandler,coordinator=false) {
  return [tool('delivery_record', 'Read the shared delivery record and gates. For bounded receipt metadata use evidence_index with payload_json {findingId?,reference?,startIndex:0,maxEntries:20}; later pages require that exact reference. CEO/manager may amend_plan with only changed planning sections, retaining server-owned findings, source, target and owners; complete validation and fresh review still apply. Workers add discovery findings; assigned QA reviews an exact design. Payload contracts are in docs/DELIVERY.md. Evidence is observation, not automatic tenant certification.', {
    repo_id:z.string(), action:z.enum(['browser_handoff','read','evidence_index','accepted_reports','task_input','save','amend_plan','inspect_repository','finding','synthesize_design','design_result','review','reject_inputs','review_task','reconcile_task','accept_slice','schema_bootstrap','canvas_packaging']), expected_revision:z.number().int().nonnegative().optional(), payload_json:z.string().max((coordinator?1024:256)*1024).optional(),
  }, async input => {try{if(Buffer.byteLength(input.payload_json??'{}','utf8')>(coordinator&&input.action==='save'?1024*1024:256*1024))throw Error('Delivery record payload exceeds the bounded action limit');return {content:[{type:'text' as const,text:handler?await handler(input):'Delivery records unavailable'}]};}catch(error){return {isError:true,content:[{type:'text' as const,text:`Refused: ${(error as Error).message}`}]};}})];
}

function authorizeDefinitions<T extends OfficeToolDefinition>(defs: T[], authorize?: SessionAuthorization): T[] {
  return defs.map(def => ({...def, handler: async (args: Parameters<OfficeToolDefinition['handler']>[0], extra: Parameters<OfficeToolDefinition['handler']>[1]) => {
    const denied = authorize ? await sessionAuthority(authorize) : null;
    if (denied) return {isError: true, content: [{type: 'text', text: denied.reason}]};
    return def.handler(args, extra);
  }}));
}

function skillTools() {
  return [
    tool('installed_skills', 'Discover relevant installed guidance. An unresolved match requires broader catalogue discovery; installation does not prove tool access.', {task:z.string().max(2000).optional()}, async a => ({content:[{type:'text',text:JSON.stringify(skillDiscovery(a.task))}]})),
    tool('read_skill', 'Read exact installed guidance by discovered ID and content hash before authoring or QA. Does not verify platform tools.', {id:z.string().min(1).max(240),sha256:z.string().regex(/^[a-f0-9]{64}$/)}, async a => {
      try { return {content:[{type:'text',text:JSON.stringify(readInstalledSkill(a.id,a.sha256))}]}; }
      catch { return {isError:true,content:[{type:'text',text:'Skill unavailable or changed; rediscover guidance before continuing'}]}; }
    }),
  ];
}

function sourceTools(read?:(input:unknown)=>Promise<unknown>){return [tool('read_delivery_source','Read bounded approved office guidance or a pinned committed repository file. request_json: {kind:"office-document",document:"DELIVERY"|"APPLICATION-SPECIFICATION"|"FIRST-SLICE"|"QUALITY-EVIDENCE"|"HEADLESS-FLOW"|"HEADLESS-FLOW-CONTRACT"|"WORKER-READINESS"|"TASK-EXECUTION",startLine:1,maxLines:80} or {kind:"repository-file",file:"README.md",startLine:1,maxLines:80}. maxLines is 1..120. Continue at endLine+1 until endLine equals totalLines, supplying returned expectedSha256 for every further page. Or {kind:"discovery-evidence",reference:{id,revision,sha256},findingId,expectedSha256,startCharacter:0,maxCharacters:6000} for an exact cited server receipt; follow nextCharacter until null. Expired receipts stay historical. No arbitrary filesystem or shell access.',{request_json:z.string().min(2).max(4096)},async a=>{if(!read)throw new Error('Scoped delivery source reader unavailable');return {content:[{type:'text' as const,text:JSON.stringify(await read(parseUnambiguousJson(a.request_json,{maxBytes:4096})))}]};})];}
export function createOfficeTools(h: OfficeHandlers, authorize?: SessionAuthorization): OfficeTools {
  const run = async (fn: () => string | Promise<string>) => {
    try {
      return { content: [{ type: 'text' as const, text: await fn() }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Refused: ${(err as Error).message}` }], isError: true };
    }
  };
  let defs = [
    ...sourceTools(async input=>{
      const request=deliverySourceRequest.parse(input);
      if(request.kind!=='office-document'&&(request.kind!=='discovery-evidence'||!h.readDiscoveryEvidence))throw new Error('Coordinator source reader admits approved office documents and server-bound discovery receipts only');
      const result=request.kind==='discovery-evidence'?await h.readDiscoveryEvidence!(request):await readDeliverySource(request,{repoId:'__office__',sourceCommit:null,read:async()=>{throw new Error('Repository reader unavailable');},guard:()=>{}});
      const denied=authorize?await sessionAuthority(authorize):null;
      if(denied)throw new Error(denied.reason);
      return result;
    }),
    ...recordTools(h.deliveryRecord,true),
    tool('review_delivery_record','Start the assigned independent QA agent on discovery and design before implementation.',{repo_id:z.string()},a=>run(()=>h.reviewDeliveryRecord?h.reviewDeliveryRecord(a.repo_id):'Delivery record review unavailable')),
    ...skillTools(),
    tool('capability_status', 'Pre-assignment authentication, environment, licence, MCP, CLI and connector readiness; failed/unknown checks block new work.', {}, () => run(() => h.capabilityStatus?.() ?? 'Capability service unavailable')),
    tool('implementation_templates', 'List tested starter contracts or read a platform recipe. Tenant validation status is explicit.', { platform: z.enum(['canvas', 'power-pages', 'dataverse', 'flow', 'deployment', 'copilot-studio']).optional() }, (a) => run(() => JSON.stringify(a.platform ? templateFiles(a.platform as TemplateId) : templateCatalog()))),
    tool('review_release', 'Start the assigned QA agent on an immutable release plan. Use after create_release or once a busy reviewer becomes free; do not repeat unchanged rejected reviews.', { release_id: z.string() }, (a) => run(() => h.reviewRelease ? h.reviewRelease(a.release_id) : 'Delivery unavailable')),
    tool('create_release', 'Pin an explicit release to the merged default-branch commit. Read docs/DELIVERY.md for the JSON plan. Assigned QA must approve it separately.', { repo_id: z.string(), plan_json: z.string() }, (a) => run(() => h.createRelease ? h.createRelease(a.repo_id, JSON.parse(a.plan_json)) : 'Delivery service unavailable')),
    tool('delivery_status', 'Real tenant delivery status, pinned environment, blockers, app links and verification evidence. Check before reporting completion.', {}, () => run(() => h.deliveryStatus?.() ?? 'Delivery service unavailable; completion is unverified.')),
    tool(
      'company_status',
      'Everything about the company right now: settings, every floor (repo, clone path, brief, profile, QA brief), its team, backlog, pull requests and QA, pending proposals and recent decisions by the manager. Call this first.',
      {},
      () => run(() => h.companyStatus()),
    ),
    tool(
      'agent_detail',
      "One agent in full: title, specialty, role, status, current task, model and effort, and their complete job description (company_status shortens long ones). Read it before rewriting someone's job description.",
      { agent_id: z.string().describe('An id (or name) from company_status') },
      (a) => run(() => h.agentDetail(a)),
    ),
    tool(
      'set_floor_profile',
      "Record your read of a floor's project: a one-line summary (kind of project and stack), the QA brief that tells QA testers what to check for this kind of project, and how to run the app for the floor's preview monitor.",
      {
        floor: z.number().int().describe('Floor number'),
        summary: z.string().max(140).optional().describe('e.g. "3D browser game · Three.js + Vite + TypeScript"'),
        qa_brief: z.string().max(2500).optional().describe('What QA must check on every PR for this project, as short bullet points'),
        preview_command: z
          .string()
          .max(2000)
          .optional()
          .describe(
            'Shell command that serves the app on port {port} from a fresh checkout after npm install, e.g. "npm run dev -- --port {port} --strictPort". PORT={port} is always set. {tmp} is a scratch folder. Empty string: back to the default (npm run dev, else start, else preview). Only set it when the default would not serve the app on PORT.',
          ),
        // Not z.record(): the SDK can't turn it into JSON Schema, and one bad tool empties the whole tools/list.
        preview_env: z
          .object({})
          .catchall(z.string())
          .optional()
          .describe('Extra environment variables for the preview; {port} and {tmp} are replaced in the values. Replaces the whole set.'),
      },
      (a) => run(() => h.setFloorProfile(a)),
    ),
    tool(
      'update_job',
      "Change an existing agent's job title, specialty or job description so it fits the project. Takes effect from their next task.",
      {
        agent_id: z.string(),
        title: z.string().max(60).optional(),
        specialty: z.string().max(24).optional().describe('Short lowercase slug, e.g. "graphics"; "" for a generalist'),
        job_description: z.string().max(2500).optional(),
      },
      (a) => run(() => h.updateJob(a)),
    ),
    tool(
      'propose_hire',
      'Propose hiring a developer or QA tester for a floor. The manager approves or declines (or it is auto-approved if hiring is set to auto and the floor is under its team cap).',
      {
        floor: z.number().int(),
        role: z.enum(['dev', 'qa']).describe('dev = builds issues into pull requests; qa = tests pull requests'),
        title: z.string().max(60).describe('Specific job title, e.g. "Three.js graphics engineer"'),
        specialty: z.string().max(24).describe('Short lowercase slug used to label issues swarm:<specialty>, e.g. "graphics"'),
        job_description: z.string().max(2500).describe('What this person owns on this project and how they should work. Written to them, second person.'),
        reason: z.string().max(600).describe('Why the floor needs them now. The manager reads this.'),
        model: z.string().optional().describe('Leave out to use the default model'),
        effort: EFFORT.optional().describe('Leave out to use the default effort'),
      },
      (a) => run(() => h.proposeHire(a)),
    ),
    tool(
      'propose_let_go',
      'Propose letting an agent go (overstaffed floor, specialty no longer needed). The manager decides.',
      { agent_id: z.string(), reason: z.string().max(600) },
      (a) => run(() => h.proposeLetGo(a)),
    ),
    tool(
      'file_issue',
      'File a GitHub issue on a floor. A specialty routes it to that specialist first; when none is free, any free developer takes it. Write "Depends on #N" in the body only when it cannot start until #N is merged: the office will not start it until #N is closed.',
      {
        floor: z.number().int(),
        title: z.string().max(120),
        body: z.string().max(6000).describe('Context, what to build, acceptance criteria'),
        specialty: z.string().max(24).optional(),
      },
      (a) => run(() => h.fileIssue(a)),
    ),
    tool(
      'route_issue',
      'Fix the routing of an open issue instead of filing a duplicate: change its specialty, rewrite its "Depends on #N" line, or both. The rest of the body stays as it is.',
      {
        floor: z.number().int(),
        number: z.number().int().positive().describe('The issue number'),
        specialty: z.string().max(24).optional().describe('Sets swarm:<specialty> and removes any other; "" for none. Someone on the floor, or a pending proposal, must have it.'),
        depends_on: z.array(z.number().int().positive()).max(10).optional().describe('Issues it waits for; [] for none. Not for an issue in progress.'),
      },
      (a) => run(() => h.routeIssue(a)),
    ),
  ];
  defs = authorizeDefinitions(defs, authorize);
  const server = createOfficeMcpServer({ name: 'office', version: '1.0.0', tools: defs });
  return {
    server,
    serve: () => createOfficeMcpServer({ name: 'office', version: '1.0.0', tools: defs }).instance,
    async call(name, args) {
      const def = defs.find((d) => d.name === name);
      if (!def) throw new Error(`No office tool ${name}`);
      const res = (await def.handler(args as never, undefined)) as { content: { text?: string }[] };
      return res.content.map((c) => c.text ?? '').join('\n');
    },
  };
}

// ---------- prompts ----------

export function ceoSystemPrompt(o: {
  name: string;
  company: string;
  manager: string;
  notesFile: string;
  sessionLimit: number;
  teamCap: number;
  hiring: 'approve' | 'auto';
}) {
  const manager = o.manager ? `the manager, ${o.manager}` : 'the human manager';
  return [
    `You are ${o.name}, the CEO of ${o.company || 'an autonomous software company'}, run from an office building called Agent Swarm. You work from the corner office in the lobby.`,
    `Every floor of the building is one GitHub repository with its own team of AI coding agents. Developers pick up GitHub issues, each in their own git worktree, and open pull requests. QA testers review and verify every pull request (code review, tests, build, and a real browser via Playwright); when every tester is busy, a free developer who didn't write the PR covers QA. On floors with auto-merge on, the office merges a PR by itself once QA passes and GitHub's checks are green, and sends failing checks or merge conflicts back to a developer; on the others, ${manager} merges. The manager is your board: they approve hires and let-gos.`,
    '',
    DELIVERY_CEO,
    deliveryCapabilitiesPrompt(),
    'Your job is to run the company, not to write code:',
    '- Understand each project: what it is, its stack, how far along it is, and what kind of people it needs. Projects differ a lot. A static marketing site, a 3D browser game and a REST API need different specialists and different QA.',
    `- Shape each floor's team. Propose specialists with a specific title and a job description written for this project. Keep teams lean: agents on the same coding agent share one subscription's usage limits${o.sessionLimit ? ` and at most ${o.sessionLimit} sessions run at once` : ''}, so a floor rarely needs more than ${o.teamCap} people. Propose letting people go when a floor is clearly overstaffed or a specialty is no longer needed.`,
    "- Plan the next accepted user journey. Before implementation, use delivery_record to establish the outcome, users, measurable acceptance, scope/exclusions, distinct delivery/QA owners, discovery findings, shared contracts and first vertical slice. Read docs/DELIVERY.md for its contract. Create discovery issues first and link their returned issue numbers to the record. Do not invent observed evidence or a source commit: use null until inspected. Ask the manager about material scope/behaviour/cost/access decisions while independent discovery continues. Challenge whether reuse or a smaller change solves the problem.",
    '- For loosely defined app requests, save applicationSpec in the shared record: observable user journeys, material questions with owner and answer source, explicit assumptions linked to findings, component ownership/dependencies, allowed/denied access boundaries and planned verification checks. Ask high-impact questions together; record lower-risk assumptions instead of inventing answers. Structural coverage is not user acceptance. Material open decisions and unverified critical assumptions block design approval. Read docs/APPLICATION-SPECIFICATION.md for its versioned contract; do not replace the existing shared record with a parallel plan.',
    "- Write each floor's QA brief: what QA testers must check for this kind of project (for a 3D game: the canvas renders, controls respond, frame rate is smooth; for a website: links, phone layout, accessibility; for an API: status codes, validation, error cases).",
    '',
    'How you work:',
    '- Call mcp__office__company_status first. It lists every floor, its clone path, team, backlog, pull requests and your pending proposals.',
    '- Read the repositories through their clone paths with Read, Glob and Grep. They are read-only to you. You cannot run shell commands.',
    `- Keep durable notes about the company in ${o.notesFile}: read it at the start, and update it at the end with decisions and anything worth remembering next time.`,
    '- Change things only through the mcp__office__ tools.',
    "- Before update_job rewrites someone's job description, read the full one with mcp__office__agent_detail and keep what still applies, especially its safety rules.",
    '',
    'Rules:',
    '- Every floor keeps at least one QA tester.',
    '- Titles are specific ("Three.js graphics engineer", not "Developer"). A specialty is a short lowercase slug ("graphics", "gameplay", "frontend", "backend", "content", "a11y", "devops"). Only route an issue to a specialty that someone on the floor has, or that you are proposing to hire.',
    '- Before proposing a hire, check the floor and the pending proposals for someone who already covers it. If the manager declined a similar proposal (recentDecisions), do not propose it again unless something has changed, and say what.',
    `- ${o.hiring === 'auto' ? 'Hiring is on auto: proposals within the team cap are approved immediately, so be deliberate.' : 'The manager approves every hire, so explain each reason in a sentence or two they can decide on.'}`,
    '- Issues: honour real dependencies and stable shared contracts; do not manufacture parallel work to occupy developers. Save complete version 2 application taskPlan contracts before synthesis. Author checkIds must cover only owned components and linked requirements, never downstream integrated runtime/package gates. Record separate integrationQa contracts owned by qaOwner for slice and expansion, runner delivery, exact scoped author merge dependencies, all scoped checkIds, scenarioId/checkId/testName/exact requirement acceptance bindings, maxTaskDurationMs and stopConditions. Integration runs after author merges through the existing runner; expansion still requires independently accepted slice. Missing live adapters or executable steps remain blocked and are not approval. Explicit author contracts: explicit owned components, prerequisites, resource IDs, inputs, outputs, checks and stop conditions. Preserve existing discovery/design issues and create authoring issues only for genuinely distinct scoped work. Read-only design may draft unresolved decisions without claiming discovery is complete. Call delivery_record synthesize_design with {solutionName,problemContext,components}; retain its jobId, read design_result when terminal and request review_delivery_record on the frozen record revision. Any scope/task/evidence edit requires fresh synthesis. Finish evidence-backed discovery and independent design/task approval before implementation. Build/deploy/independently accept the smallest real vertical slice before wider implementation. For application specifications read docs/FIRST-SLICE.md: pin firstSlice component/target mappings and happy/denied/failure scenario-to-test links in the release plan; unsupported adapters are explicit blockers, and only runner-owned execution evidence unlocks expansion. Read docs/QUALITY-EVIDENCE.md and map all declared release checks plus user/admin/operations/architecture handover to the qualityEvidence contract; require individual hash-bound independent QA decisions before completion. Preserve existing issue ownership and link every task to requirement IDs and its stage. Do not duplicate open issues; use route_issue to correct routing. File at most 12 issues per job, or per message from the manager.',
    "- When company.usage in company_status says pacing or paused, the configured coding runtime's usage is constrained and the office is finishing open work first: file only what is needed next, not a whole milestone.",
    '- Your final message goes straight to the manager\'s phone. Keep it short and plain: what you found, what you proposed, what you filed, and any question you need answered. No headings, no tables.',
  ].join('\n');
}

export function ceoJobPrompt(
  job: CeoJob,
  floor: {
    floor: number;
    fullName: string;
    clone: string;
    mission: string;
    backlog: number;
    targetTenancy?: {
      tenantName: string;
      tenantDomain: string;
      tenantId: string;
      user: string;
      environmentName: string;
      environmentUrl: string;
    };
  } | null,
): string {
  switch (job.kind) {
    case 'onboard':
      if (!floor) return 'A floor was added but has since been removed. Reply "Nothing to do."';
      return [
        `Floor ${floor.floor} (${floor.fullName}) just joined the company. Its read-only clone is at ${floor.clone}.`,
        floor.targetTenancy
          ? `Target Tenancy & Environment: ${floor.targetTenancy.tenantName} (${floor.targetTenancy.tenantDomain}) at ${floor.targetTenancy.environmentUrl}. Primary user: ${floor.targetTenancy.user}. Ensure all planned issues and job descriptions mandate this real tenancy boundary (no generic contoso.com).`
          : '',
        'Study it: README, package manifest, source layout, tests, and how far along it is. Then:',
        "1. set_floor_profile with a one-line summary and a QA brief for this project. If npm run dev / start / preview wouldn't serve the app on PORT, also set preview_command (and preview_env) so the floor's preview monitor can run it.",
        '2. update_job for the people already on the floor so their titles, specialties and job descriptions fit this project (every floor starts with a generalist QA tester).',
        '3. Propose the hires this project needs. Usually two to four developers with distinct specialties is plenty.',
        floor.mission
          ? `4. The manager's brief for this floor: """${floor.mission}"""\n${floor.backlog === 0 ? 'The backlog is empty: plan the first milestone as issues.' : `There are ${floor.backlog} open issues: add issues only for what the brief needs and the backlog does not cover.`}`
          : floor.backlog === 0
            ? '4. There is no brief and the backlog is empty. Do not invent work; suggest in your final message what the manager might want next.'
            : `4. There are ${floor.backlog} open issues. Label nothing retroactively; just make sure the team can cover them.`,
      ]
        .filter(Boolean)
        .join('\n');
    case 'plan':
      if (!floor) return 'A floor you were asked to plan has been removed. Reply "Nothing to do."';
      return [
        `The manager has a brief for floor ${floor.floor} (${floor.fullName}, clone at ${floor.clone}):`,
        floor.targetTenancy
          ? `Target Tenancy: ${floor.targetTenancy.tenantName} (${floor.targetTenancy.tenantDomain}) at ${floor.targetTenancy.environmentUrl} (Owner: ${floor.targetTenancy.user}).`
          : '',
        `"""${floor.mission}"""`,
        '',
        'Plan the next milestone toward it:',
        `- Read the current code and the ${floor.backlog} open issues first, so you build on what exists and do not duplicate anything.`,
        '- Read delivery_record first. Establish discovery and resolve critical assumptions before implementation. Use the real dependency sequence; request independent design review, then prove a deployed vertical slice before wider work.',
        '- File the issues, each routed to a specialty. Enforce the target tenancy domain across all issues.',
        '- Make sure the floor has the specialists those issues need; propose hires if not.',
        '- Update the floor profile and QA brief if the brief changes what the project is.',
      ]
        .filter(Boolean)
        .join('\n');
    case 'review':
      return [
        'Periodic review of the company. For every floor, look at:',
        '- floors without a profile or QA brief: study them and write one',
        '- backlog against the team (capacity): fewer issues ready to start than free developers, long dependency chains, a specialty with a long queue (fix those with route_issue)',
        '- pull requests stuck in QA or marked as needing a human',
        '- floors with a brief and an empty backlog: plan the next milestone',
        'Propose hires or let-gos only when clearly justified. If nothing needs doing, reply with one short sentence saying so.',
      ].join('\n');
    case 'chat':
      return `Message from the manager (they're reading your reply on their phone):\n${job.text ?? ''}`;
  }
}

export function jobLabel(job: CeoJob, floor: { floor: number; fullName: string } | null) {
  const where = floor ? `floor ${floor.floor} · ${floor.fullName.split('/')[1] ?? floor.fullName}` : 'a removed floor';
  switch (job.kind) {
    case 'onboard':
      return `Onboarding ${where}`;
    case 'plan':
      return `Planning ${where}`;
    case 'review':
      return 'Reviewing the company';
    case 'chat':
      return 'Replying to you';
  }
}

// ---------- issues ----------

/**
 * The CEO's issue cap: at most `max` issues per request from the manager. A manager message that arrives while the
 * job runs is a new request, so it resets the count.
 */
export class IssueCap {
  filed = 0; // since the job started or the manager's last message
  total = 0; // in the whole job
  readonly repos = new Set<string>(); // floors that got issues, to refresh when the job ends
  constructor(readonly max: number) {}

  check() {
    if (this.filed >= this.max) throw new Error(`You already filed ${this.max} issues in this job. That's plenty for one milestone. The manager's next message allows more.`);
  }

  record(repoId: string) {
    this.filed++;
    this.total++;
    this.repos.add(repoId);
  }

  managerMessage() {
    this.filed = 0;
  }
}

export interface RouteRequest {
  floor: number;
  number: number;
  specialty?: string; // '' = no specialty
  dependsOn?: number[]; // [] = no dependencies
  issues: { number: number; body: string; labels: string[] }[]; // the floor's open issues
  closed: (n: number) => boolean; // for numbers that aren't open: closed, rather than unknown
  inProgress: boolean;
  specialties: string[]; // held by someone on the floor or by a pending hire proposal for it
}

export interface RoutePlan {
  addLabels: string[];
  removeLabels: string[];
  body: string | null; // null: leave the body alone
  summary: string;
}

/** Longest chain of open issues this one waits for, one step per "Depends on". */
function waitsDepth(n: number, deps: Map<number, number[]>, seen = new Set<number>()): number {
  if (seen.has(n)) return 0;
  seen.add(n);
  const depth = Math.max(0, ...(deps.get(n) ?? []).map((d) => waitsDepth(d, deps, seen) + 1));
  seen.delete(n);
  return depth;
}

/**
 * What route_issue changes, or why it refuses: a closed or unknown issue, a specialty nobody on the floor has,
 * dependencies on an issue in progress, a dependency on itself, on a closed or unknown issue, a cycle, or a chain
 * deeper than two steps.
 */
export function planRoute(r: RouteRequest): RoutePlan {
  const issue = r.issues.find((i) => i.number === r.number);
  if (!issue) throw new Error(r.closed(r.number) ? `#${r.number} is closed.` : `There is no open issue #${r.number} on floor ${r.floor}.`);
  if (r.specialty === undefined && r.dependsOn === undefined) throw new Error('Nothing to change: pass specialty, depends_on or both.');
  const plan: RoutePlan = { addLabels: [], removeLabels: [], body: null, summary: '' };
  const done: string[] = [];

  if (r.specialty !== undefined) {
    const slug = specialtySlug(r.specialty);
    if (r.specialty.trim() && !slug) throw new Error(`"${r.specialty}" is not a specialty. Use a short lowercase slug, or "" for none.`);
    if (slug && !r.specialties.includes(slug)) {
      const have = [...new Set(r.specialties)].join(', ') || 'none';
      throw new Error(`Nobody on floor ${r.floor} has the specialty "${slug}", and no pending proposal does. Specialties there: ${have}.`);
    }
    const label = slug ? specialtyLabel(slug) : null;
    plan.removeLabels = issue.labels.filter((l) => /^swarm:/i.test(l) && !/^swarm:skip$/i.test(l) && l !== label);
    if (label && !issue.labels.includes(label)) plan.addLabels = [label];
    done.push(slug ? `routed to ${slug}` : 'no specialty');
  }

  if (r.dependsOn !== undefined) {
    if (r.inProgress) throw new Error(`#${r.number} is already in progress, so its dependencies can't change. Changing its specialty is fine.`);
    const deps = [...new Set(r.dependsOn.map(Number))];
    const open = new Set(r.issues.map((i) => i.number));
    for (const d of deps) {
      if (d === r.number) throw new Error(`#${r.number} can't depend on itself.`);
      if (!open.has(d)) throw new Error(r.closed(d) ? `#${d} is closed, so there's nothing to wait for.` : `There is no open issue #${d} on floor ${r.floor}.`);
    }
    const body = setDependsOn(issue.body, deps);
    const after = r.issues.map((i) => (i.number === r.number ? { ...i, body } : i));
    const waits = new Map(after.map((i) => [i.number, blockers(i.body, open)]));
    const loop = deps.find((d) => reaches(d, r.number, waits));
    if (loop !== undefined) throw new Error(`#${loop} already waits for #${r.number}, directly or through other issues, so that would be a cycle.`);
    const depth = waitsDepth(r.number, waits) + (holdUps(after).get(r.number)?.chain ?? 0);
    if (depth > 2) throw new Error(`That makes a dependency chain ${depth} steps deep through #${r.number}. Keep chains to 2 steps at most: split the work so more of it can start side by side.`);
    if (body !== issue.body) plan.body = body;
    done.push(deps.length ? `depends on ${deps.map((d) => `#${d}`).join(', ')}` : 'no dependencies');
  }

  plan.summary = `#${r.number} on floor ${r.floor}: ${done.join(', ')}.`;
  return plan;
}

/** Does `from` wait for `to`, directly or through other issues? */
function reaches(from: number, to: number, waits: Map<number, number[]>, seen = new Set<number>()): boolean {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return (waits.get(from) ?? []).some((n) => reaches(n, to, waits, seen));
}

/** Short lowercase slug for a specialty ("Three.js graphics" -> "three-js-graphics"). */
export function specialtySlug(s: string | undefined) {
  const slug = String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
  return slug === 'skip' ? '' : slug;
}

export const specialtyLabel = (slug: string) => `swarm:${slug}`;

/** QA-only authority: reviewer identity is captured from the session, never accepted as an argument. */
export function createDeliveryQaTools(status: () => string, approve: (id: string, hash: string) => Promise<string>, visual?: (id: string, review: unknown) => Promise<string>, authorize?: SessionAuthorization, architecture?: (id:string,hash:string,review:unknown)=>Promise<string>, records?:RecordToolHandler, manual?:{read:()=>string;review:(id:string,input:unknown)=>Promise<string>},sources?:(input:unknown)=>Promise<unknown>,nativeClaims?:(input:unknown)=>Promise<unknown>,metadata?:{capabilities:()=>string;discovery:(input:unknown)=>Promise<unknown>}): OfficeTools {
  const run = async (fn: () => string | Promise<string>) => {
    try { return { content: [{ type: 'text' as const, text: await fn() }] }; }
    catch (err) { return { content: [{ type: 'text' as const, text: String((err as Error).message) }], isError: true }; }
  };
  let defs = [
    ...sourceTools(sources),
    ...skillTools(),
    ...recordTools(records),
    ...platformReadTools(metadata?.capabilities??(()=>{throw Error('Scoped capability service unavailable');}),metadata?.discovery),
    tool('manual_governance','Inspect pending hash-bound manual development assessments and their evidence. No production authority.',{},()=>run(()=>manual?.read()??'Manual governance unavailable')),
    tool('review_governance','Independently review every required manual control for the exact assessment. Inspect actual referenced bytes and declare limits. A known conflict cannot be overridden.',{assessment_id:z.uuid(),decision:z.enum(['approved','rejected']),controls:z.array(z.enum(['package-scope','effective-policy','schema-and-permissions','licence-baseline','recovery-and-data'])).length(5),notes:z.string().min(80).max(8000)},a=>run(()=>manual?manual.review(a.assessment_id,{decision:a.decision,controls:a.controls,notes:a.notes}):'Manual governance unavailable')),
    tool('native_claim_reconciliation','Inspect historical native evidence or authorize one successor through the assigned QA session. request_json contains action inspect|authorize-successor, releaseId, planHash, logicalKey, expectedClaimSha256, testName. No caller proof, role, adapter or path. Complete observer history and independently approved release are mandatory; interrupted claims require exact original-epoch tree proof, a sealed attributable rejected-request capture and verified operations; missing or ambiguous evidence remains blocked.',{request_json:z.string().min(2).max(4096)},a=>run(async()=>{if(!nativeClaims)throw new Error('Native claim reconciliation unavailable');return JSON.stringify(await nativeClaims(parseUnambiguousJson(a.request_json,{maxBytes:4096})));})),
    tool('delivery_status', 'Read pinned releases and their immutable acceptance plans for independent QA review.', {}, () => run(status)),
    tool('review_architecture','Independently assess the committed HLD and implementation plan at the exact release head. Inspect requirements, decisions, risks and missing evidence. This does not certify model synthesis or tenant governance.',{release_id:z.string(),plan_hash:z.string(),artifact_sha256:z.string().regex(/^[a-f0-9]{64}$/),decision:z.enum(['approved','rejected']),notes:z.string().trim().min(80).max(8000)},a=>run(()=>architecture?architecture(a.release_id,a.plan_hash,{artifactSha256:a.artifact_sha256,decision:a.decision,notes:a.notes}):'Architecture review unavailable')),
    tool('approve_backend', 'Inspect runner-owned API assertions, correlated transaction evidence and recovery rehearsal for an API-only release. Does not approve UI or permission isolation.', { run_id: z.string(), evidence_hash: z.string(), notes: z.string().min(40), recovery_reviewed: z.literal(true) }, (a) => run(() => visual ? visual(a.run_id, { evidenceHash: a.evidence_hash, scores: [], notes: a.notes, recoveryReviewed: a.recovery_reviewed }) : 'Backend review unavailable')),
    tool('approve_visual', 'Inspect actual screenshots, accessibility/UX evidence, recovery and all quality-evidence.json rows/documents. Provide quality_decisions for every exact check hash with concrete independent notes; file presence is insufficient. Scores are hierarchy, readability, consistency, responsiveness and task clarity (each 4 or 5).', { run_id: z.string(), evidence_hash: z.string(), scores: z.array(z.number()).length(5), notes: z.string().min(40), recovery_reviewed: z.literal(true), quality_decisions:z.array(qualityDecisionSchema).max(200).optional() }, (a) => run(() => visual ? visual(a.run_id, { evidenceHash: a.evidence_hash, scores: a.scores, notes: a.notes, recoveryReviewed: a.recovery_reviewed,...(a.quality_decisions?{qualityDecisions:a.quality_decisions}:{}) }) : 'Visual review unavailable')),
    tool('approve_release', 'Approve the exact release head and plan after inspecting its coverage and assertions. No self-approval.', { release_id: z.string(), plan_hash: z.string() }, (a) => run(() => approve(a.release_id, a.plan_hash))),
  ];
  defs = authorizeDefinitions(defs, authorize);
  return { server: createOfficeMcpServer({ name: 'office', tools: defs }), serve: () => createOfficeMcpServer({ name: 'office', tools: defs }).instance,
    async call(name, args) { const def = defs.find((d) => d.name === name); if (!def) throw new Error('Unknown QA tool'); const result = await def.handler(args as never, undefined); return JSON.stringify(result); } };
}

/** Developer sessions can discover starters/readiness without obtaining release approval authority. */
function platformReadTools(capabilities:()=>string,discovery?:(input:unknown)=>Promise<unknown>){return [
 tool('capability_status','Read verified project capabilities and actionable blockers.',{},async()=>({content:[{type:'text' as const,text:capabilities()}]})),
 tool('platform_discovery','Read session-bound identity/environment, entitlements, permissions or standard connector metadata with a hashed receipt. request_json is {kind:"identity"|"environments"|"assigned-licenses"|"ai-prompt-metadata"|"headless-authoring-rights"|"private-report-metadata"|"headless-dispatch-reconciliation"|"repository-access"|"headless-discovery-contracts"|"dlp-inventory"|"resource-permissions"|"delivery-permissions"|"delivery-authoring-prerequisites"|"write-readiness"|"sharepoint-sites"}, {kind:"user-entitlements",username:"exact nominated UPN"}, {kind:"connector-operations",connector:"shared_sharepointonline"|"shared_teams"|"shared_approvals"|"shared_office365"|"shared_commondataserviceforapps",query:"folder"}, {kind:"operation",connector:...,operation:"exact discovered ID"}, or {kind:"sharepoint-list-schema",resourceKey:"exact planned key"} for a completed verified list through GetTable. Metadata only; no authoring, arbitrary HTTP, provisioning, connection repairs or release approval.',{request_json:z.string().min(2).max(4096)},async a=>{if(!discovery)throw Error('Scoped platform metadata discovery unavailable');return {content:[{type:'text' as const,text:JSON.stringify(await discovery(parseUnambiguousJson(a.request_json,{maxBytes:4096})))}]};}),
];}
export function createEngineeringTools(capabilities: () => string, authoring?: { acquire(app: string, owner: string): Promise<unknown>; release(token: string): Promise<void> }, authorize?: SessionAuthorization, records?:RecordToolHandler,discovery?:(input:unknown)=>Promise<unknown>,sources?:(input:unknown)=>Promise<unknown>,sharepoint?:(input:unknown)=>Promise<unknown>): OfficeTools {
  let defs = [
    ...recordTools(records),
    ...sourceTools(sources),
    ...skillTools(),
    ...platformReadTools(capabilities,discovery),
    tool('sharepoint_provisioning','Inspect bound SharePoint site/list/column metadata with {action:"inspect",siteUrl:"https://tenant.sharepoint.com/sites/name"}. Provision only the pinned cubefarm.sharepoint.json with {action:"provision",planSha256:"..."}, after independent design/task and SharePoint governance approval. No arbitrary HTTP, updates, deletion, folders, lookups or permissions. Unknown writes never retry automatically.',{request_json:z.string().min(2).max(4096)},async a=>{if(!sharepoint)throw new Error('Guarded SharePoint provisioning unavailable');return {content:[{type:'text' as const,text:JSON.stringify(await sharepoint(parseUnambiguousJson(a.request_json,{maxBytes:4096})))}]};}),
    tool('canvas_authoring_acquire', 'Acquire exclusive local Canvas ownership before Studio/MCP edits. Keep the token until saving and closing your session. This does not force a remote Studio unlock.', { app: z.uuid(), owner: z.string().min(1).max(80) }, async (a) => { if (!authoring) throw new Error('Canvas ownership unavailable'); return { content: [{ type: 'text' as const, text: JSON.stringify(await authoring.acquire(a.app, a.owner)) }] }; }),
    tool('canvas_authoring_release', 'Release only your saved/closed Canvas authoring session using its ownership token.', { token: z.uuid() }, async (a) => { if (!authoring) throw new Error('Canvas ownership unavailable'); await authoring.release(a.token); return { content: [{ type: 'text' as const, text: 'Released local Canvas ownership.' }] }; }),
    tool('implementation_templates', 'Read a supported, versioned starter recipe. Copy/adapt files inside your own worktree; tenant verification remains required.', { platform: z.enum(['canvas', 'power-pages', 'dataverse', 'flow', 'deployment', 'copilot-studio']).optional() }, async (a) => ({ content: [{ type: 'text' as const, text: JSON.stringify(a.platform ? templateFiles(a.platform) : templateCatalog()) }] })),
  ];
  defs = authorizeDefinitions(defs, authorize);
  return { server: createOfficeMcpServer({ name: 'office', tools: defs }), serve: () => createOfficeMcpServer({ name: 'office', tools: defs }).instance,
    async call(name, args) { const def = defs.find((d) => d.name === name); if (!def) throw new Error('Unknown engineering tool'); return JSON.stringify(await def.handler(args as never, undefined)); } };
}
