import path from 'node:path';
import fs from 'node:fs';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { handleHook, handleMcp } from './cliRunner.ts';
import { HttpError, type Swarm } from './swarm.ts';
import type { Backend } from './backend.ts';
import type { FeatureStore } from './features.ts';
import type { CapabilityService } from './capabilityChecks.ts';
import { capabilityConfigSchema } from './capabilityChecks.ts';
import type { DeliveryService } from './delivery.ts';
import { containedFile } from './delivery.ts';
import type { ToolGovernanceService } from './toolGovernance.ts';
import type { TenantDlpService } from './tenantDlp.ts';
import type { CanvasOwnership } from './canvasOwnership.ts';
import { generateProposal } from './proposalAgent.ts';
import { registerArchitectureRoutes } from './architectureRoutes.ts';
import type {HldSynthesisService} from './hldSynthesis.ts';
import { parseSolutionFolder } from '../shared/solutionParser.ts';
import { scanDirectoryDlp } from './dlpScanner.ts';
import { templateCatalog, templateFiles, installTemplate, type TemplateId } from './implementationTemplates.ts';
import { discoverSkills, selectSkills } from './skillRegistry.ts';
import { createBrowserAuth } from './browserAuth.ts';
import { parseBody, proposalSchema, loginSchema, selectSchema, notifySchema, approveSchema } from './requestSchemas.ts';

export interface OfficeHttpServices {
  synthesis?:HldSynthesisService;
  synthesisUnavailableReason?:string;
  backend: Backend; swarm: Swarm; features: FeatureStore; capabilities: CapabilityService;
  delivery: DeliveryService; toolGovernance: ToolGovernanceService; tenantDlp: TenantDlpService;
  canvasOwnership: CanvasOwnership; homeDir: string; runtimeStartedAt: string;
  policyReaderMode: 'launcher' | 'direct';
  requestHandoff?:()=>void;
  changeDrain?:(value:boolean,apply:()=>void)=>Promise<void>;
}

/** Construct the production HTTP app without listeners, timers or process hooks.
 * The launcher owns startup/shutdown; callers must initialize and close services. */
export function createOfficeHttpApp(services: OfficeHttpServices) {
  const {backend,swarm,features,capabilities,delivery,toolGovernance,tenantDlp,canvasOwnership,homeDir,runtimeStartedAt,policyReaderMode}=services;
  const app = express();
  let closed = false;
  const requireOpen = () => { if (closed) throw new HttpError(503, 'Office is shutting down; retry after restart'); };
  app.use('/api', (_req, _res, next) => { try { requireOpen(); next(); } catch (error) { next(error); } });
  // Agent CLIs calling back: hooks (a tool result can be a large screenshot, hence the limit) and the CEO's office tools.
  // The token in the path is the session's; unknown tokens get an empty answer.
  app.post('/api/hooks/:token', express.json({ limit: '64mb' }), (req, res, next) => void handleHook(String(req.params.token), req.body).then((answer) => { requireOpen(); res.json(answer); }).catch(next));
  app.post('/api/mcp/:token', express.json({ limit: '4mb' }), (req, res, next) => void handleMcp(String(req.params.token), req, res).catch(next));
  app.all('/api/mcp/:token', (_req, res) => void res.status(405).set('Allow', 'POST').end());
  const browserAuth = createBrowserAuth();
  browserAuth.install(app);
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', (req, _res, next) => {
    try { requireOpen(); } catch (error) { return next(error); }
    req.body ??= {};
    if (typeof req.body !== 'object' || Array.isArray(req.body)) return next(new HttpError(400, 'Request body must be an object'));
    next();
  });

  type Handler = (req: Request, res: Response) => Promise<unknown> | unknown;
  const route = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      requireOpen();
      const out = await fn(req, res);
      if (!res.headersSent) { requireOpen(); res.json(out ?? { ok: true }); }
    } catch (err) {
      next(err);
    }
  };
  const num = (v: unknown) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Invalid number: ${v}`);
    return n;
  };
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  // Repo ids contain a slash ("owner/name"), so they travel URL-encoded as a single segment.
  const repoId = (req: Request) => String(req.params.repo);
  const connectedRepo = (id: string) => {
    const repo = swarm.snapshot().repos.find((repo) => repo.id === id);
    if (!repo) throw new HttpError(404, 'Repository is not connected');
    return repo;
  };
  const featureScope = async (req: Request, repo?: string) => {
    const id = repo ?? str(req.query.repo);
    if (id) connectedRepo(id);
    const active = (await backend.tenancy.info()).environments.find((env) => env.active);
    return JSON.stringify([id || 'office', active?.url || 'disconnected']);
  };

  app.get('/api/state', route(() => swarm.snapshot()));
  app.get('/api/capabilities', route(() => capabilities.view()));
  app.get('/api/installed-skills', route((req) => { const catalogue = discoverSkills(); const task = str(req.query.task).slice(0, 2000); return task ? { ...catalogue, skills: selectSkills(catalogue, task) } : catalogue; }));
  app.get('/api/runtime', route(() => ({ pid: process.pid, startedAt: runtimeStartedAt, demo: backend.demo, policyReaderMode, draining:swarm.isDraining||delivery.isDraining, sessionUsage:swarm.sessionUsage(), features: ['api-verification', 'connection-repair', 'record-sharing', 'schema-contracts', 'canvas-ownership'] })));
  app.post('/api/office/drain',route(async req=>{
    const {expectedPid,draining}=parseBody(z.object({expectedPid:z.number().int().positive(),draining:z.boolean()}).strict(),req.body);
    if(expectedPid!==process.pid)throw new HttpError(409,'Office process changed; inspect the current runtime before drain');
    if(backend.demo)throw new HttpError(409,'Demo cannot drain a working office');
    const apply=()=>{requireOpen();delivery.setDraining(draining);swarm.setDraining(draining);};
    if(services.changeDrain)await services.changeDrain(draining,apply);else apply();
    return {pid:process.pid,draining};
  }));
  app.post('/api/office/prepare-handoff',route((req,res)=>{
    const {expectedPid}=parseBody(z.object({expectedPid:z.number().int().positive()}).strict(),req.body);
    if(expectedPid!==process.pid)throw new HttpError(409,'Office process changed; inspect the current runtime before handoff');
    if(backend.demo||!services.requestHandoff)throw new HttpError(409,'This office does not support launcher handoff');
    if(delivery.view().running||swarm.sessionUsage().used>0||swarm.sessionUsage().blockedReason)throw new HttpError(409,'Wait for active agent, architecture and delivery work before handoff');
    res.status(202).json({accepted:true,pid:process.pid,preserveTerminals:true});
    services.requestHandoff();
  }));
  app.get('/api/governance/tools', route(() => toolGovernance.view()));
  app.get('/api/governance/tenant', route(() => tenantDlp.view()));
  app.post('/api/governance/tenant/refresh', route(async (req) => {
    if (backend.demo) throw new HttpError(409, 'Demo cannot authenticate or read tenant policy');
    const input = parseBody(z.object({ tenantId: z.uuid() }).strict(), req.body);
    const tenancy = await backend.tenancy.info();
    if (tenancy.status !== 'connected' || !tenancy.user) throw new HttpError(409, 'Connect the intended account before policy discovery');
    return tenantDlp.refresh({ tenantId: input.tenantId, caller: tenancy.user });
  }));
  app.post('/api/authoring/canvas/:app/lease', route(async (req) => {
    if (backend.demo) throw new HttpError(409, 'Demo cannot acquire tenant authoring ownership');
    const { app: appId } = parseBody(z.object({ app: z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i) }), req.params);
    const { owner } = parseBody(z.object({ owner: z.string().trim().min(1).max(80) }).strict(), req.body);
    const tenancy = await backend.tenancy.info(); const target = tenancy.environments.find((environment) => environment.active);
    if (!target || tenancy.status !== 'connected') throw new HttpError(409, 'Connect the authoring environment first');
    return canvasOwnership.acquire(target.url, appId, owner);
  }));
  app.post('/api/authoring/canvas/lease/release', route(async (req) => {
    const { token } = parseBody(z.object({ token: z.uuid() }).strict(), req.body);
    await canvasOwnership.release(token); return { released: true };
  }));
  app.post('/api/repos/:repo/capabilities/configure', route(async (req) => { connectedRepo(repoId(req)); await capabilities.configure(repoId(req), parseBody(capabilityConfigSchema, req.body)); return capabilities.view(); }));
  app.post('/api/repos/:repo/capabilities/check', route((req) => { parseBody(z.object({}).strict(), req.body); const repo = connectedRepo(repoId(req)); return capabilities.check(repo.id, repo.checkoutPath, repo.targetTenancy?.environmentUrl ?? delivery.view().policy?.environmentUrl, 'git', true); }));
  app.get('/api/implementation-templates', route(() => templateCatalog()));
  app.get('/api/implementation-templates/:template', route((req) => templateFiles(String(req.params.template) as TemplateId)));
  app.post('/api/repos/:repo/implementation-templates/:template', route((req) => { if (backend.demo) throw new HttpError(409, 'Demo cannot install into a real project'); return installTemplate(connectedRepo(repoId(req)).checkoutPath, String(req.params.template) as TemplateId); }));
  app.post('/api/repos/:repo/delivery/monitor/:run', route(async (req) => { await delivery.monitor(connectedRepo(repoId(req)), String(req.params.run)); return delivery.view(repoId(req)); }));
  app.get('/api/delivery', route((req) => delivery.view(typeof req.query.repo === 'string' ? req.query.repo : undefined)));
  app.post('/api/delivery/platforms', route((req) => {
    const { copilotPaused } = parseBody(z.object({ copilotPaused: z.boolean() }).strict(), req.body);
    return delivery.pauseCopilot(copilotPaused);
  }));
  app.post('/api/delivery/configure', route(async (req) => {
    const {enabled} = parseBody(z.object({enabled:z.boolean()}).strict(),req.body);
    if (!enabled && delivery.view().policy) return delivery.configure(delivery.view().policy!.environmentUrl, false);
    const tenancy = await backend.tenancy.info();
    const target = tenancy.environments.find((env) => env.active);
    if (!target || tenancy.status !== 'connected') throw new HttpError(409, 'Connect a current PAC development environment first');
    return delivery.configure(target.url, enabled);
  }));
  app.post('/api/delivery/releases/:release/review', route((req) => swarm.requestDeliveryReview(String(req.params.release))));
  app.post('/api/repos/:repo/delivery/releases', route(async (req) => JSON.parse(await swarm.createDeliveryRelease(repoId(req), req.body))));
  app.post('/api/repos/:repo/delivery/run', route((req) => {
    const {releaseId}=parseBody(z.object({releaseId:z.uuid().optional()}).strict(),req.body);
    return delivery.start(connectedRepo(repoId(req)),true,releaseId);
  }));
  app.get('/api/delivery/runs/:run/evidence', route(async (req, res) => {
    const run = delivery.view().runs.find((run) => run.id === String(req.params.run));
    const file = typeof req.query.file === 'string' ? req.query.file : '';
    if (!run || !run.evidence.includes(file)) throw new HttpError(404, 'Delivery evidence not found');
    const location = await containedFile(path.join(homeDir, 'delivery-runs', run.id, 'evidence'), file);
    requireOpen();
    await new Promise<void>((resolve,reject) => res.download(location,error => error ? reject(error) : resolve()));
  }));



  app.get('/api/github/repos', route((req) => swarm.listGithubRepos(str(req.query.owner) || undefined)));

  // What happens once a project moves in: the CEO's brief, and whether work starts on its own.
  const floorOptions = (req: Request) => ({ mission: str(req.body.mission), autoAssign: req.body.autoAssign === true });

  app.post('/api/repos', route((req) => swarm.connectRepo(str(req.body.fullName).trim(), floorOptions(req))));

  // Your projects folder
  app.get('/api/folders', route((req) => swarm.listProjectFolders(str(req.query.dir) || undefined)));
  app.post('/api/folders/connect', route((req) => swarm.connectFolder(str(req.body.path), floorOptions(req))));
  app.post(
    '/api/folders/publish',
    route((req) =>
      swarm.publishFolder(str(req.body.path), {
        ...floorOptions(req),
        name: str(req.body.name) || undefined,
        visibility: req.body.visibility === 'public' ? 'public' : 'private',
        description: str(req.body.description),
      }),
    ),
  );
  app.post(
    '/api/setup',
    route((req) =>
      swarm.setup({
        managerName: str(req.body.managerName),
        companyName: str(req.body.companyName),
        hiring: str(req.body.hiring),
        ceoName: str(req.body.ceoName),
        ceoLook: str(req.body.ceoLook),
        ceoColor: str(req.body.ceoColor),
      }),
    ),
  );
  app.post(
    '/api/repos/new',
    route((req) =>
      swarm.createRepo(str(req.body.name).trim(), {
        ...floorOptions(req),
        description: str(req.body.description),
        visibility: req.body.visibility === 'public' ? 'public' : 'private',
        owner: str(req.body.owner).trim() || undefined,
      }),
    ),
  );
  app.patch('/api/repos/:repo', route((req) => swarm.updateRepo(repoId(req), req.body ?? {})));
  app.delete('/api/repos/:repo', route((req) => swarm.disconnectRepo(repoId(req))));
  app.post('/api/repos/:repo/sync', route((req) => swarm.syncRepo(repoId(req))));
  app.post('/api/repos/:repo/sync-folder', route((req) => swarm.syncFolderNow(repoId(req))));
  app.post(
    '/api/repos/:repo/issues',
    route(async (req) => ({
      number: await swarm.createIssue(repoId(req), str(req.body.title), str(req.body.body), str(req.body.assignTo) || undefined, str(req.body.specialty) || undefined),
    })),
  );
  app.post('/api/repos/:repo/plan', route((req) => swarm.planFloor(repoId(req), typeof req.body?.mission === 'string' ? req.body.mission : undefined)));
  app.post('/api/repos/:repo/onboard', route((req) => swarm.onboardFloor(repoId(req))));

  // Validated document generation; filesystem targets come from the connected repo.
  app.post('/api/proposals/generate', route((req) => generateProposal(parseBody(proposalSchema, req.body))));
  registerArchitectureRoutes(app,{demo:backend.demo,connectedRepo,assertOpen:requireOpen,synthesis:services.synthesis,synthesisUnavailableReason:services.synthesisUnavailableReason});
  app.get('/api/repos/:repo/solution-architecture', route((req) => {
    const repo = connectedRepo(repoId(req));
    return parseSolutionFolder(repo.checkoutPath ?? null, backend.demo);
  }));
  app.get('/api/repos/:repo/dlp-scan', route((req) => {
    const repo = connectedRepo(repoId(req));
    return scanDirectoryDlp(backend.demo ? null : repo.checkoutPath ?? null, repo.fullName);
  }));
  app.get('/api/repos/:repo/flow-runs', route(async (req) => {
    connectedRepo(repoId(req));
    const key = await featureScope(req, repoId(req));
    return features.runs(key);
  }));
  app.post('/api/repos/:repo/flow-runs/:runId/resubmit', route(async (req) => {
    connectedRepo(repoId(req));
    const key = await featureScope(req, repoId(req));
    return features.resubmit(key, String(req.params.runId));
  }));
  app.get('/api/teams/feed', route(async (req) => features.feed(await featureScope(req))));
  app.post('/api/teams/notify', route(async (req) => features.notify(await featureScope(req), parseBody(notifySchema, req.body))));
  app.get('/api/alm/pipeline', route(async (req) => features.pipeline(await featureScope(req))));
  app.post('/api/alm/approve', route(async (req) => {
    const input = parseBody(approveSchema, req.body ?? {});
    return features.release(await featureScope(req), 'approve', input.approver);
  }));
  app.post('/api/alm/rollback', route(async (req) => features.release(await featureScope(req), 'rollback')));
  app.get('/api/tenancy', route(() => backend.tenancy.info()));
  app.post('/api/tenancy/select', route((req) => backend.tenancy.select(parseBody(selectSchema, req.body).index)));
  app.post('/api/tenancy/login', route((req) => backend.tenancy.login(parseBody(loginSchema, req.body))));
  app.get('/api/tenancy/login/:id', route((req) => backend.tenancy.loginStatus(String(req.params.id))));
  app.delete('/api/tenancy/login/:id', route((req) => backend.tenancy.cancelLogin(String(req.params.id))));

  // The floor's app, for the preview monitor
  app.post(
    '/api/repos/:repo/preview',
    route((req) => {
      const pr = req.body?.pr;
      if (pr !== undefined && pr !== null && (typeof pr !== 'number' || !Number.isInteger(pr) || pr <= 0)) throw new HttpError(400, 'pr must be a positive integer');
      return swarm.startPreview(repoId(req), pr ?? null);
    }),
  );
  app.delete('/api/repos/:repo/preview', route((req) => swarm.stopPreview(repoId(req))));
  app.post('/api/repos/:repo/pulls/:n/merge', route((req) => swarm.mergePull(repoId(req), num(req.params.n), req.body?.method ?? 'squash')));
  app.post('/api/repos/:repo/pulls/:n/close', route((req) => swarm.closePull(repoId(req), num(req.params.n))));
  app.post('/api/repos/:repo/pulls/:n/qa', route((req) => swarm.sendToQa(repoId(req), num(req.params.n))));
  app.post(
    '/api/repos/:repo/agents',
    route((req) =>
      swarm.hireAgent(repoId(req), {
        name: str(req.body.name),
        model: str(req.body.model),
        effort: str(req.body.effort),
        role: str(req.body.role),
        look: str(req.body.look),
        title: str(req.body.title),
        specialty: str(req.body.specialty),
        brief: str(req.body.brief),
      }),
    ),
  );

  app.patch('/api/agents/:id', route((req) => swarm.updateAgent(String(req.params.id), req.body ?? {})));
  app.delete('/api/agents/:id', route((req) => swarm.fireAgent(String(req.params.id))));
  app.post('/api/agents/:id/assign', route((req) => swarm.assign(String(req.params.id), num(req.body.issueNumber), str(req.body.note) || undefined)));
  app.post('/api/agents/:id/stop', route((req) => swarm.stopAgent(String(req.params.id))));
  app.post('/api/agents/:id/reset', route((req) => swarm.resetAgent(String(req.params.id))));
  app.post('/api/agents/:id/message', route((req) => swarm.message(String(req.params.id), str(req.body.text))));
  app.get('/api/agents/:id/screen', (req, res) => {
    const shot = swarm.screenshot(String(req.params.id));
    if (!shot) return void res.status(404).end();
    res.setHeader('Content-Type', shot.mime);
    res.setHeader('Cache-Control', 'no-store');
    res.end(shot.data);
  });

  app.patch('/api/settings', route((req) => swarm.updateSettings(req.body ?? {})));
  // The office's own update: Update now / Later
  app.post('/api/office/update', route((req) => swarm.updateOffice(req.body?.action)));

  // The CEO and the manager's phone
  app.post('/api/ceo/message', route((req) => swarm.messageCeo(str(req.body.text))));
  app.post('/api/ceo/review', route(() => swarm.requestReview()));
  app.post('/api/phone/read', route((req) => swarm.markPhoneRead(Number(req.body?.at) || Date.now())));
  app.post(
    '/api/requests/:id/approve',
    route((req) => swarm.approveRequest(String(req.params.id), { name: str(req.body?.name) || undefined, model: typeof req.body?.model === 'string' ? req.body.model : undefined, effort: typeof req.body?.effort === 'string' ? req.body.effort : undefined })),
  );
  app.post('/api/requests/:id/reject', route((req) => swarm.rejectRequest(String(req.params.id), str(req.body?.note))));

  // Serve the built client: the published package, or `npm start` after `npm run build`.
  const dist = path.resolve(import.meta.dirname, '../dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    // express.json() flags malformed bodies with a 4xx status of its own.
    const parserStatus = (err as { status?: unknown })?.status;
    const status = err instanceof HttpError ? err.status : typeof parserStatus === 'number' && parserStatus >= 400 && parserStatus < 500 ? parserStatus : 500;
    const message = err instanceof HttpError && status < 500 ? err.message : status === 413 ? 'Request body is too large' : status === 400 ? 'Invalid request body' : status === 404 ? 'Resource not found' : 'Office request failed; inspect the server diagnostics';
    if (status >= 500) console.error(err);
    if (status === 503 && closed) res.setHeader('Retry-After','1');
    res.status(status).json({ error: message });
  });

  return {app,browserAuth,closeAdmission(){closed=true;}};
}
