import {z} from 'zod';
import {functionalRequestFieldsSchema,functionalRequestSnapshotSchema} from '../shared/functionalShowcase.ts';
import {claimHash} from './nativeClaimReconciliation.ts';
import type {SharepointRequest} from './sharepointProvisioning.ts';
const versionId=z.string().regex(/^(?:0|[1-9][0-9]{0,9})\.(?:0|[1-9][0-9]{0,9})$/);
const metadata=z.object({id:versionId,lastModifiedDateTime:z.iso.datetime({offset:true})});
const version=metadata.extend({fields:functionalRequestFieldsSchema});
type Snapshot=z.infer<typeof functionalRequestSnapshotSchema>;
export const duplicateBaselineSchema=z.strictObject({version:versionId,modifiedAt:z.iso.datetime({offset:true}),observedAt:z.iso.datetime({offset:true})});
export const duplicateSignalSchema=z.strictObject({baseline:duplicateBaselineSchema,scenarioStartedAt:z.iso.datetime({offset:true}),version:versionId,modifiedAt:z.iso.datetime({offset:true}),finalVersion:versionId,finalModifiedAt:z.iso.datetime({offset:true}),observedAt:z.iso.datetime({offset:true}),fields:functionalRequestFieldsSchema,providerVersionSha256:z.string().regex(/^[a-f0-9]{64}$/)});
export function compareItemVersion(a:string,b:string){const x=versionId.parse(a).split('.').map(BigInt),y=versionId.parse(b).split('.').map(BigInt);return x[0]===y[0]?(x[1]===y[1]?0:x[1]>y[1]?1:-1):x[0]>y[0]?1:-1;}
interface Input {graph:SharepointRequest;list:string;before:Snapshot;readCurrent:()=>Promise<Snapshot>;guard:()=>Promise<void>;now:()=>number}
async function reader(input:Input){
 const get=async(suffix:string)=>{await input.guard();const raw=await input.graph('GET',`${input.list}/${input.before.id}/versions${suffix}`);await input.guard();if(Buffer.byteLength(JSON.stringify(raw))>256000)throw Error('Duplicate version evidence oversized');return raw;};
 const page=z.object({value:z.array(metadata).min(1).max(200),'@odata.nextLink':z.never().optional()}).parse(await get('?$top=200'));
 if(new Set(page.value.map(v=>v.id)).size!==page.value.length)throw Error('Duplicate item versions are ambiguous');
 const entries=page.value.sort((a,b)=>compareItemVersion(a.id,b.id));
 const expand=async(m:z.infer<typeof metadata>)=>{const raw=await get('/'+encodeURIComponent(m.id)+'?$expand=fields'),v=version.parse(raw);if(v.id!==m.id||v.lastModifiedDateTime!==m.lastModifiedDateTime||Date.parse(v.lastModifiedDateTime)>input.now())throw Error('Duplicate version identity or chronology differs');return{value:v,sha256:claimHash(raw)};};
 return{entries,expand};
}
export async function readDuplicateBaseline(input:Input){
 const r=await reader(input),latest=(await r.expand(r.entries.at(-1)!)).value;
 if(claimHash(latest.fields)!==claimHash(input.before.fields)||claimHash(await input.readCurrent())!==claimHash(input.before))throw Error('Duplicate baseline changed during version observation');
 return duplicateBaselineSchema.parse({version:latest.id,modifiedAt:latest.lastModifiedDateTime,observedAt:new Date(input.now()).toISOString()});
}
export function assertDuplicateSignal(raw:unknown,before:Snapshot,after:Snapshot){
 const s=duplicateSignalSchema.parse(raw),expected={...before.fields,ProbeStatus:'New'};
 if(before.id!==after.id||before.version===after.version||claimHash(before.fields)!==claimHash(after.fields)||claimHash(s.fields)!==claimHash(expected)||compareItemVersion(s.baseline.version,s.version)>=0||compareItemVersion(s.version,s.finalVersion)>=0||Date.parse(s.baseline.modifiedAt)>Date.parse(s.baseline.observedAt)||Date.parse(s.baseline.observedAt)>Date.parse(s.scenarioStartedAt)||Date.parse(s.scenarioStartedAt)>Date.parse(s.modifiedAt)||Date.parse(s.modifiedAt)>Date.parse(s.finalModifiedAt)||Date.parse(s.finalModifiedAt)>Date.parse(s.observedAt)||Date.parse(s.observedAt)>Date.now())throw Error('Duplicate signal version, chronology or protected fields differ');
 return s;
}
export async function observeDuplicateSignal(input:Input&{baseline:z.infer<typeof duplicateBaselineSchema>;scenarioStartedAt:string;after:Snapshot}){
 const r=await reader(input),latest=(await r.expand(r.entries.at(-1)!)).value;
 if(claimHash(latest.fields)!==claimHash(input.after.fields)||claimHash(await input.readCurrent())!==claimHash(input.after))throw Error('Duplicate restored version differs');
 const candidates=[];for(const m of r.entries.filter(v=>compareItemVersion(v.id,input.baseline.version)>0&&compareItemVersion(v.id,latest.id)<0&&Date.parse(v.lastModifiedDateTime)>=Date.parse(input.scenarioStartedAt))){const v=await r.expand(m);if(claimHash(v.value.fields)===claimHash({...input.before.fields,ProbeStatus:'New'}))candidates.push(v);}
 if(candidates.length!==1)throw Error('Exactly one post-baseline duplicate signal version required');
 const chosen=candidates[0],again=await r.expand(chosen.value);
 if(again.sha256!==chosen.sha256||claimHash(await input.readCurrent())!==claimHash(input.after))throw Error('Duplicate signal changed during observation');
 return assertDuplicateSignal({baseline:input.baseline,scenarioStartedAt:input.scenarioStartedAt,version:chosen.value.id,modifiedAt:chosen.value.lastModifiedDateTime,finalVersion:latest.id,finalModifiedAt:latest.lastModifiedDateTime,observedAt:new Date(input.now()).toISOString(),fields:chosen.value.fields,providerVersionSha256:chosen.sha256},input.before,input.after);
}
