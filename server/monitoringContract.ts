import type {ReleasePlan} from './releasePlan.ts';
import {HttpError} from './httpError.ts';
export interface MonitoringManifest {manualDevelopmentGovernance?:boolean;preparation?:{kind:string};recovery?:{scope?:string};hasUi:boolean;targetComponents:{kind:string}[];postDeployActions:{type:string}[];postDeploy:unknown[]}
export function backendAccessMonitoring(plan:ReleasePlan,manifest:MonitoringManifest){
 return plan.acceptanceProfile==='functional-development'&&!!plan.verification.api&&!plan.verification.cloudFlowChecks&&manifest.manualDevelopmentGovernance===true&&!manifest.hasUi&&(manifest.targetComponents.length>0&&manifest.targetComponents.every(component=>component.kind==='dataverse-table')||manifest.preparation?.kind==='pinned-artifact-v1'&&manifest.recovery?.scope==='empty-solution-only'&&manifest.targetComponents.length===0&&!manifest.postDeployActions.length)&&!manifest.postDeploy.length&&manifest.postDeployActions.every(action=>action.type==='schema-check');
}
/** Backend access readiness is not a workflow-health or transaction pass.
 * Other releases retain fresh workflow probes, including API plans with flows. */
export function assertMonitoringContract(plan:ReleasePlan,manifest:MonitoringManifest,checks:{id:string;category:string;passed?:boolean}[],live=false){
 const backend=backendAccessMonitoring(plan,manifest),selected=plan.monitoring.criticalProbeIds.map(id=>checks.find(check=>check.id===id&&(!live||check.passed)));
 for(let index=0;index<selected.length;index++)if(!selected[index]||!(backend?['authentication','environment']:['workflow']).includes(selected[index]!.category))throw new HttpError(409,`Critical ${backend?'backend access':'workflow'} probe ${plan.monitoring.criticalProbeIds[index]} is missing`);
 if(backend&&['authentication','environment'].some(category=>!selected.some(check=>check?.category===category)))throw new HttpError(409,'Backend monitoring requires registered authentication and environment probes; transaction acceptance remains separate');
}
