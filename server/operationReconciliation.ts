import crypto from 'node:crypto';
import type { DeliveryRun } from '../shared/delivery.ts';

/** A previous success is historical until a fresh, owned observation confirms it.
 * Intent is persisted before mutation; an uncertain mutation is never blindly repeated. */
export async function reconcile(id: string, definition: unknown, run: DeliveryRun, save: () => Promise<void>, owned: () => Promise<void>, observe: () => Promise<boolean>, mutate: () => Promise<unknown>) {
  const commandSha256 = crypto.createHash('sha256').update(JSON.stringify(definition)).digest('hex');
  run.operations ??= [];
  const matches = run.operations.filter(op => op.id === id);
  if (matches.length > 1) throw new Error(`${id} has ambiguous operation history; inspect the release before retrying`);
  let operation = matches[0];
  if (operation && operation.commandSha256 !== commandSha256) throw new Error(`${id} target or action changed; create a new release`);
  await owned();
  if (operation) {
    operation.status = 'unknown'; operation.endedAt = new Date().toISOString();
    await save();
    await owned();
  }
  const observed = await observe();
  await owned();
  if (observed) {
    if (!operation) { operation = { id, kind: 'post-deploy', status: 'verified', commandSha256, startedAt: new Date().toISOString() }; run.operations.push(operation); }
    operation.status = 'verified'; operation.endedAt = new Date().toISOString(); await save(); return;
  }
  if (operation) throw new Error(`${id} has an unresolved outcome or observed drift; inspect the platform before retrying`);
  operation = { id, kind: 'post-deploy', status: 'intent', commandSha256, startedAt: new Date().toISOString() };
  run.operations.push(operation); await save();
  try {
    await owned(); await mutate();
    await owned();
    const satisfied = await observe();
    await owned();
    if (!satisfied) throw new Error(`${id} postcondition was not observed; allow the platform to finish then reconcile`);
    operation.status = 'verified'; operation.endedAt = new Date().toISOString(); await save();
  } catch (error) {
    // A revoked owner cannot overwrite its successor's release. The durable intent
    // already records an uncertain outcome when ownership can no longer be proven.
    await owned();
    operation.status = 'unknown'; operation.endedAt = new Date().toISOString(); await save(); throw error;
  }
}
