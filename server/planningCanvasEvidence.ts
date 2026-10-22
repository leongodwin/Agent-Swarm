import crypto from 'node:crypto';
import {deliveryRecordContentSchema, type DeliveryRecordContent} from '../shared/deliveryRecord.ts';

export interface CanvasPlanningTarget {appId:string;environmentId:string;account:string;connectionId:string;site:string;resourceIds:string[]}
export interface CapturedPlanningEvidence {reference:string;bytes:Buffer}
/** Reconciles a prerequisite observation only. Never creates review or runtime acceptance. */
export function reconcileCanvasPlanning(content:DeliveryRecordContent,target:CanvasPlanningTarget,artifacts:CapturedPlanningEvidence[],now=Date.now()):DeliveryRecordContent {
 if(artifacts.length!==3||new Set(artifacts.map(a=>a.reference)).size!==3)throw new Error('Require three distinct captured evidence artifacts');
 const [sync,ui,schemas]=artifacts.map(a=>JSON.parse(a.bytes.toString('utf8')));
 const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
 if(!equal(sync.target,{environmentId:target.environmentId,appId:target.appId,account:target.account})||ui.appId!==target.appId||ui.environmentId!==target.environmentId||ui.account!==target.account||ui.connectionId!==target.connectionId||ui.site!==target.site)throw new Error('Canvas evidence target mismatch');
 if(sync.scope!=='canvas-source-sync-diagnostic-only'||sync.status!=='source-sync-observed'||sync.sourceSyncObserved!==true||sync.cleanupVerified!==true||sync.authoringApproved!==false||sync.runtimeVerified!==false||!Array.isArray(sync.files)||sync.files.length===0||new Set(sync.files.map((f:any)=>f.name)).size!==sync.files.length||sync.files.some((f:any)=>!f.name?.endsWith('.pa.yaml')||!Number.isSafeInteger(f.bytes)||f.bytes<=0||!/^[a-f0-9]{64}$/.test(f.sha256)))throw new Error('Source sync evidence is incomplete');
 if(ui.scope!=='existing-source-association-only'||target.resourceIds.length!==3||new Set(target.resourceIds).size!==3||!equal([...ui.selectedIds??[]].sort(),[...target.resourceIds].sort())||ui.selectedIds.includes(ui.excludedId)||ui.published!==false||ui.savedStatus!=='All changes are saved.'||!Array.isArray(ui.pickerResources)||new Set(ui.pickerResources.map((r:any)=>r.Name)).size!==ui.pickerResources.length)throw new Error('Saved dedicated resource evidence is incomplete');
 const names=target.resourceIds.map(id=>ui.pickerResources?.find((r:any)=>r.Name===id)?.DisplayName);
 if(names.some(n=>typeof n!=='string')||new Set(names).size!==3||schemas.scope!=='live-native-data-source-schema-only'||schemas.schemas?.length!==3)throw new Error('Require all three native schemas');
 const observedNames=schemas.schemas.map((s:any)=>{if(s.status!=='fulfilled'||s.value?.isError||s.value?.content?.length!==1||s.value.content[0].type!=='text')throw new Error('Native schema missing or ambiguous');const text=s.value.content[0].text;const match=/^Data Source: ([^\r\n]+)\r\nKind: Connected\r\n/.exec(text);if(!match||!/^Columns \([1-9][0-9]*\):$/m.test(text)||text.match(/^Data Source:/gm)?.length!==1)throw new Error('Native schema missing or ambiguous');return match[1];});
 if(!equal([...observedNames].sort(),[...names].sort()))throw new Error('Native schema missing or ambiguous');
 const evidence=artifacts.map((a,i)=>{
  const observedAt=[sync,ui,schemas][i].observedAt,stamp=Date.parse(observedAt),expires=stamp+2*60*60*1000;
  if(!Number.isFinite(stamp)||stamp>now||expires<=now)throw new Error('Evidence expired or future dated; recapture rather than extending its lifetime');
  return{reference:a.reference,sha256:crypto.createHash('sha256').update(a.bytes).digest('hex'),observedAt:new Date(stamp).toISOString(),expiresAt:new Date(expires).toISOString()};
 });
 const next=structuredClone(content),finding=next.findings.find(f=>f.id==='canvas-session');if(!finding)throw new Error('Canvas finding is missing');
 Object.assign(finding,{status:'observed',conclusion:'ready',statement:`Saved app ${target.appId} joined in ${target.environmentId} as ${target.account}; genuine nonempty native source sync and saved association of all three dedicated SharePoint sources observed. Native connected schemas returned for each. This establishes the source-authoring prerequisite only. Compilation, App checker, export, licensing, runtime and deployment remain unverified. Source YAML alone does not contain association metadata.`,remedy:'Use the exact saved app and observed source names/types; preserve its authoring lease. Implement only after independent design/task approval. Require separate compile, App checker, export and independent runtime evidence before release.',evidence});
 // Reconcile only the exact disproven clauses; retain all other task gates and assumptions.
 for(const decision of next.applicationSpec?.decisions??[])if(decision.id==='supported-delivery'&&decision.answer)decision.answer=decision.answer.replace('Current Canvas editor is not joined and production native attempt/complete coverage are unsupported.','The dedicated saved Canvas editor is joined and source/schema preparation is observed; production native attempt/complete coverage remain unsupported.');
 for(const task of next.taskPlan?.tasks??[])if(task.issue===7)task.inputs=task.inputs.map(input=>input.replace('No blank or expense app session.',`Use saved dedicated app ${target.appId}, including its blank responsive baseline; no unrelated, unbound or expense app session.`));
 for(const task of next.taskPlan?.tasks??[])if(task.issue===5&&next.sourceCommit)task.inputs=task.inputs.map(input=>input.replace(/^(Pinned cubefarm\.sharepoint\.json, cubefarm\.authoring\.json and docs\/delivery\/AUTHORING-CONTRACT\.md at current source )[a-f0-9]{40,64}$/,'$1'+next.sourceCommit));
 return deliveryRecordContentSchema.parse(next);
}
