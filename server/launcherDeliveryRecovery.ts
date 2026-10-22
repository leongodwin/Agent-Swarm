import {inspectDeliveryRecovery} from './deliveryRecovery.ts';
import type {DeliveryService} from './delivery.ts';

/** Explicit operator opt-in, limited to an owning launcher's observed crash and
 * validated absence of all cloud-operation history. Never reconciles remote work. */
export async function reconcileLauncherDelivery(root:string,delivery:Pick<DeliveryService,'available'|'isDraining'|'setDraining'|'recoverStartup'>,context:{enabled:boolean;launcher:boolean;crashedOwnerPid:string|undefined}):Promise<boolean>{
  if(!context.enabled||!context.launcher||delivery.available||!context.crashedOwnerPid||!/^\d+$/.test(context.crashedOwnerPid))return false;
  const pid=Number(context.crashedOwnerPid);if(!Number.isSafeInteger(pid)||pid<=0||pid>2147483647)return false;
  const inspection=await inspectDeliveryRecovery(root);
  if(!inspection.canRecover||!inspection.snapshotSha256)return false;
  const prior=delivery.isDraining;
  delivery.setDraining(true);
  try{await delivery.recoverStartup(inspection.snapshotSha256,pid);return delivery.available;}
  finally{if(prior||delivery.available)delivery.setDraining(prior);}
}
