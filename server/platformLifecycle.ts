import { z } from 'zod';
import type { DeliveryRun } from '../shared/delivery.ts';
import type { MappedComponent, Request, TargetAction } from './targetOperations.ts';
import type { FlowAdapter } from './flowAdapter.ts';
import { verifyCloudFlowContext, flowDefinitionForPreflight } from './flowAdapter.ts';
import type { Command, PlatformIdentity } from './platformAuth.ts';
import { reconcile } from './operationReconciliation.ts';
export { reconcile } from './operationReconciliation.ts';

export async function reconcileCloudFlow(action: Extract<TargetAction, { type: 'cloud-flow-state' }>, component: MappedComponent, adapter: FlowAdapter, identity: PlatformIdentity,
  solutionName: string, run: DeliveryRun, save: () => Promise<void>, owned: () => Promise<void>) {
  if (component.kind !== 'cloud-flow') throw new Error('Cloud-flow adapter requires a mapped cloud-flow component');
  const args = { env: identity.environmentId, flow: component.id };
  const desired = action.state === 'active' ? 'Started' : 'Stopped';
  await reconcile(`typed:${action.id}`, { action, component, identity, solutionName }, run, save, owned,
    async () => {
      await verifyCloudFlowContext(adapter, identity, component.id, component.id, solutionName);
      await owned();
      return z.enum(['Started', 'Stopped']).parse(await adapter.call('get_flow', { ...args, path: 'properties.state' })) === desired;
    },
    async () => {
      await verifyCloudFlowContext(adapter, identity, component.id, component.id, solutionName);
      if (action.state === 'active') {
        const properties = z.object({ definition: z.record(z.string(), z.unknown()), connectionReferences: z.record(z.string(), z.unknown()).optional() }).parse(await adapter.call('get_flow', { ...args, path: 'properties' }));
        const preflight = z.object({ overall: z.string() }).parse(await adapter.call('preflight_flow', { env: identity.environmentId, definition: flowDefinitionForPreflight(properties.definition), connectionReferences: properties.connectionReferences ?? {} }));
        if (preflight.overall !== 'ready') throw new Error('Cloud-flow preflight requires attention; verify connector bindings and solution publication before activation');
      }
      await owned();
      return adapter.call(action.state === 'active' ? 'publish_flow' : 'disable_flow', { ...args, forceManaged: action.forceManaged });
    });
}

export async function reconcileCopilot(action: Extract<TargetAction, { type: 'copilot-publish' }>, component: MappedComponent, request: Request, command: Command,
  run: DeliveryRun, save: () => Promise<void>, owned: () => Promise<void>) {
  if (component.kind !== 'copilot') throw new Error('Copilot adapter requires a mapped Copilot Studio agent');
  await reconcile(`typed:${action.id}`, { action, component, environmentUrl: run.environmentUrl }, run, save, owned,
    async () => {
      const bot = z.object({ statecode: z.number(), statuscode: z.number(), publishedon: z.string().nullable() }).parse(await request('GET', `bots(${component.id})?$select=statecode,statuscode,publishedon`));
      if ([4, 5].includes(bot.statuscode)) throw new Error('Copilot provisioning failed or its licence is missing');
      const published = Date.parse(bot.publishedon ?? '');
      return bot.statecode === 0 && bot.statuscode === 1 && published >= Date.parse(run.startedAt) && published <= Date.now() + 60000;
    },
    () => command('pac', ['copilot', 'publish', '--environment', run.environmentUrl, '--bot', component.id]));
}
