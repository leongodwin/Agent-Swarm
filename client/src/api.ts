import { useStore } from './store';
import type { AgentCli, GhRepoSummary, OfficeUpdateView, PreviewView, ProjectFolderView, RepoView, SwarmSettings } from '../../shared/types';
import type { ParsedSolution } from '../../shared/solutionTypes';
import type { FlowRun } from '../../shared/flowTelemetry';
import type { TeamsAdaptiveCard } from '../../shared/teams';
import type { AlmPipeline } from '../../shared/alm';
import type { DlpPolicyViolation } from '../../shared/dlp';
import type { TenancyInfo, TenancyLogin, TenancyLoginInput } from '../../shared/tenancy';
import { ensureSession } from './session';

export interface DlpScanReport {
  repoFullName: string;
  checkoutPath: string | null;
  scannedFiles: number;
  scannedPaths: string[];
  violations: DlpPolicyViolation[];
  timestamp: string;
  isRealScan: boolean;
}

async function call<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  await ensureSession();
  const options = {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };
  let res = await fetch(url, options);
  if (res.status === 401) { await ensureSession(); res = await fetch(url, options); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data as { error?: string }).error ?? `${res.status} ${res.statusText}`;
    useStore.getState().pushToast('error', message);
    throw new Error(message);
  }
  return data as T;
}

const r = (repoId: string) => `/api/repos/${encodeURIComponent(repoId)}`;
const scope = (repoId?: string) => repoId ? `?repo=${encodeURIComponent(repoId)}` : '';

/** Choices made when a project moves in: a brief for the CEO, and whether work starts on its own. */
export interface FloorOptions {
  mission?: string;
  autoAssign?: boolean;
}

export const api = {
  githubRepos: (owner?: string) => call<GhRepoSummary[]>('GET', `/api/github/repos${owner ? `?owner=${encodeURIComponent(owner)}` : ''}`),
  connectRepo: (fullName: string, floor: FloorOptions = {}) => call<RepoView>('POST', '/api/repos', { fullName, ...floor }),
  createRepo: (body: FloorOptions & { name: string; description: string; visibility: 'private' | 'public'; owner?: string }) =>
    call<RepoView>('POST', '/api/repos/new', body),
  folders: (dir?: string) => call<{ root: string; folders: ProjectFolderView[] }>('GET', `/api/folders${dir ? `?dir=${encodeURIComponent(dir)}` : ''}`),
  connectFolder: (path: string, floor: FloorOptions = {}) => call<RepoView>('POST', '/api/folders/connect', { path, ...floor }),
  publishFolder: (body: FloorOptions & { path: string; name?: string; visibility: 'private' | 'public'; description?: string }) =>
    call<RepoView>('POST', '/api/folders/publish', body),
  setup: (body: { managerName: string; companyName: string; hiring: 'approve' | 'auto'; ceoName: string; ceoLook: 'feminine' | 'masculine'; ceoColor: string }) =>
    call<SwarmSettings>('POST', '/api/setup', body),
  updateRepo: (
    repoId: string,
    patch: {
      autoAssign?: boolean;
      autoMerge?: boolean;
      browserTesting?: boolean;
      color?: string;
      links?: string[];
      mission?: string;
      summary?: string;
      qaBrief?: string;
      previewCommand?: string | null;
      previewEnv?: Record<string, string>;
    },
  ) => call('PATCH', r(repoId), patch),
  startPreview: (repoId: string, pr?: number) => call<PreviewView>('POST', `${r(repoId)}/preview`, pr ? { pr } : {}),
  stopPreview: (repoId: string) => call<PreviewView>('DELETE', `${r(repoId)}/preview`),
  disconnectRepo: (repoId: string) => call('DELETE', r(repoId)),
  syncRepo: (repoId: string) => call('POST', `${r(repoId)}/sync`),
  syncFolder: (repoId: string) => call<{ folderSync: string | null }>('POST', `${r(repoId)}/sync-folder`),
  createIssue: (repoId: string, title: string, body: string, assignTo?: string, specialty?: string) =>
    call<{ number: number }>('POST', `${r(repoId)}/issues`, { title, body, assignTo, specialty }),
  planFloor: (repoId: string, mission?: string) => call('POST', `${r(repoId)}/plan`, { mission }),
  onboardFloor: (repoId: string) => call('POST', `${r(repoId)}/onboard`),
  mergePull: (repoId: string, n: number, method: 'squash' | 'merge' | 'rebase' = 'squash') => call('POST', `${r(repoId)}/pulls/${n}/merge`, { method }),
  closePull: (repoId: string, n: number) => call('POST', `${r(repoId)}/pulls/${n}/close`),
  sendToQa: (repoId: string, n: number) => call('POST', `${r(repoId)}/pulls/${n}/qa`),
  hireAgent: (repoId: string, opts: { name?: string; model?: string; effort?: string; role?: 'dev' | 'qa'; title?: string; specialty?: string } = {}) =>
    call('POST', `${r(repoId)}/agents`, opts),
  updateAgent: (id: string, patch: { name?: string; model?: string; effort?: string; cli?: AgentCli | ''; look?: 'feminine' | 'masculine'; title?: string; specialty?: string; brief?: string }) =>
    call('PATCH', `/api/agents/${id}`, patch),
  fireAgent: (id: string) => call('DELETE', `/api/agents/${id}`),
  assign: (id: string, issueNumber: number, note?: string) => call('POST', `/api/agents/${id}/assign`, { issueNumber, note }),
  stop: (id: string) => call('POST', `/api/agents/${id}/stop`),
  reset: (id: string) => call('POST', `/api/agents/${id}/reset`),
  message: (id: string, text: string) => call('POST', `/api/agents/${id}/message`, { text }),
  updateSettings: (patch: Partial<SwarmSettings>) => call('PATCH', '/api/settings', patch),
  updateOffice: async (action: 'now' | 'later') => {
    const u = await call<OfficeUpdateView>('POST', '/api/office/update', { action });
    useStore.getState().setOfficeUpdate(u);
    return u;
  },
  messageCeo: (text: string) => call('POST', '/api/ceo/message', { text }),
  ceoReview: () => call('POST', '/api/ceo/review'),
  phoneRead: (at: number) => call('POST', '/api/phone/read', { at }),
  approveRequest: (id: string, overrides: { name?: string; model?: string; effort?: string } = {}) => call('POST', `/api/requests/${id}/approve`, overrides),
  rejectRequest: (id: string, note?: string) => call('POST', `/api/requests/${id}/reject`, { note }),
  generateProposal: <T = unknown>(body: unknown) => call<T>('POST', '/api/proposals/generate', body),
  generateHld: <T = unknown>(body: unknown) => call<T>('POST', '/api/hld/generate', body),
  solutionArchitecture: (repoId: string) => call<ParsedSolution>('GET', `/api/repos/${encodeURIComponent(repoId)}/solution-architecture`),
  flowRuns: (repoId: string) => call<FlowRun[]>('GET', `/api/repos/${encodeURIComponent(repoId)}/flow-runs`),
  resubmitFlowRun: (repoId: string, runId: string) => call<{ ok: boolean; resubmitted: FlowRun }>('POST', `/api/repos/${encodeURIComponent(repoId)}/flow-runs/${encodeURIComponent(runId)}/resubmit`),
  teamsFeed: (repoId?: string) => call<TeamsAdaptiveCard[]>('GET', `/api/teams/feed${scope(repoId)}`),
  almPipeline: (repoId?: string) => call<AlmPipeline>('GET', `/api/alm/pipeline${scope(repoId)}`),
  almApprove: (data: { approver?: string } = {}, repoId?: string) => call<AlmPipeline>('POST', `/api/alm/approve${scope(repoId)}`, data),
  almRollback: (repoId?: string) => call<AlmPipeline>('POST', `/api/alm/rollback${scope(repoId)}`),
  dlpScan: (repoId: string) => call<DlpScanReport>('GET', `${r(repoId)}/dlp-scan`),
  tenancy: () => call<TenancyInfo>('GET', '/api/tenancy'),
  selectTenancyEnvironment: (index: number) => call<{ ok: boolean; message: string }>('POST', '/api/tenancy/select', { index }),
  loginTenancy: (data: TenancyLoginInput) => call<TenancyLogin>('POST', '/api/tenancy/login', data),
  tenancyLoginStatus: (id: string) => call<TenancyLogin>('GET', `/api/tenancy/login/${encodeURIComponent(id)}`),
  cancelTenancyLogin: (id: string) => call('DELETE', `/api/tenancy/login/${encodeURIComponent(id)}`),
};
