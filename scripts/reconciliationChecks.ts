import {fullLauncherPassed,launcherUpdatePassed} from './fullLauncherChecks.ts';
export function reconciledAdoptionPassed(proof:Record<string,any>,error?:unknown){
  if(!fullLauncherPassed(proof,error))return false;
  const r=proof.reconciliation;
  return !!r&&r.operatorOptIn===true&&r.receipt?.authorisation==='operator-opt-in-owned-launcher-crash'&&r.receipt.crashedOwnerPid===proof.beforeCrash.pid&&r.receipt.scope==='no-cloud-operation-history'&&r.receipt.runs===0&&r.receipt.releases===0&&r.receipt.attempts===0&&r.receipt.remoteOutcomeVerified===false&&/^[a-f0-9]{64}$/.test(r.snapshotSha256)&&r.receipt.snapshotSha256===r.snapshotSha256&&/^[a-f0-9]{64}$/.test(r.priorLeaseSha256)&&r.archivedLeaseSha256===r.priorLeaseSha256&&/^[a-f0-9]{64}$/.test(r.priorHistorySha256)&&r.afterHistorySha256===r.priorHistorySha256&&proof.afterCrash.deliveryAvailability==='ready';
}
/** Post-completion updater evidence cannot stand in for active-native retention. */
export function reconciledLauncherPassed(proof:Record<string,any>,error?:unknown){
 return reconciledAdoptionPassed(proof,error)&&proof.completedNativeExit?.absent===true&&proof.completedNativeExit.pid===proof.beforeCrash.nativeRuntime.nativePids[0]&&proof.updateChain?.success?.before?.pid===proof.afterCrash.pid&&launcherUpdatePassed(proof.updateChain,proof.launcherPid,proof.home,0);
}
