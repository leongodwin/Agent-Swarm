import {z} from 'zod';
import type {FlowAdapter} from './flowAdapter.ts';
import {SOURCE_CAPSULE_BYTES,assertSourceCapsuleDefinition,sourceDigest,sourceNames,validateSourceCapsule,validateSourceRepetitions} from './headlessSourceContract.ts';

const bindingSchema=z.strictObject({environmentId:z.uuid(),flowId:z.uuid(),runId:z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),nonce:z.uuid(),dataMode:z.enum(['synthetic','mailbox']),definitionSha256:z.string().regex(/^[a-f0-9]{64}$/),startedAt:z.iso.datetime({offset:true}),endedAt:z.iso.datetime({offset:true})});
export type SourceObservationBinding=z.infer<typeof bindingSchema>;

/** Inert observation primitive. The release runner must supply reviewed admission,
 * identity, deadline and protected-storage guards before wiring this capability.
 * No trigger, write operation, content URL fetch or provider retry is available.
 * The returned source/index is private; only the separate receipt may be logged. */
export async function observeHeadlessSource(adapter:Pick<FlowAdapter,'call'>,rawBinding:SourceObservationBinding,definition:unknown,guard:()=>Promise<void>){
 try{
  const binding=bindingSchema.parse(rawBinding);
  if(sourceDigest(definition)!==binding.definitionSha256)throw Error('SOURCE_DEFINITION_DIFFERS');
  const staticProof=assertSourceCapsuleDefinition(definition);
  const args={env:binding.environmentId,flow:binding.flowId,run:binding.runId};
  const call=async(tool:string,extra:Record<string,unknown>={})=>{await guard();const result=await adapter.call(tool,{...args,...extra});await guard();return result;};
  const actions=z.array(z.object({name:z.string(),status:z.string()}).passthrough()).max(500).parse(await call('get_run_actions'));
  const status=(name:string,expected:string)=>{const rows=actions.filter(a=>a.name===name);if(rows.length!==1||rows[0].status!==expected)throw Error('SOURCE_ACTION_STATUS_DIFFERS');};
  status(sourceNames.capsule,'Succeeded');
  if(binding.dataMode==='synthetic'){
   for(const name of [sourceNames.read,sourceNames.validate,sourceNames.append,'Next_page_action'])status(name,'Skipped');
   status(sourceNames.fixture,'Succeeded');status(sourceNames.setFixture,'Succeeded');
  }else{
   for(const name of [sourceNames.read,sourceNames.validate,sourceNames.append,'Next_page_action'])status(name,'Succeeded');
   status(sourceNames.fixture,'Skipped');status(sourceNames.setFixture,'Skipped');
  }
  const rawEnvelope=await call('get_run_action_content',{action:sourceNames.capsule,which:'outputs',maxBytes:SOURCE_CAPSULE_BYTES});if(rawEnvelope&&typeof rawEnvelope==='object'&&['skipped','truncated','partial','preview','error'].some(key=>Object.hasOwn(rawEnvelope,key)))throw Error('SOURCE_CONTENT_INCOMPLETE');
  const envelope=z.object({action:z.literal(sourceNames.capsule),which:z.literal('outputs'),content:z.unknown()}).passthrough().parse(rawEnvelope);
  if(!Object.hasOwn(envelope,'content'))throw Error('SOURCE_CONTENT_MISSING');
  const source=validateSourceCapsule(envelope.content,{dataMode:binding.dataMode,nonce:binding.nonce,startedAt:binding.startedAt,endedAt:binding.endedAt});
  const repetitions:Record<string,ReturnType<typeof validateSourceRepetitions>>={};
  if(binding.dataMode==='mailbox')for(const action of [sourceNames.read,sourceNames.validate,sourceNames.append,'Next_page_action'])repetitions[action]=validateSourceRepetitions(await call('get_run_action_repetitions',{action,top:101,includeLinks:false}),action,source.counts.pages,binding);
  if(binding.dataMode==='mailbox')for(let i=0;i<source.counts.pages;i++){
   const read=repetitions[sourceNames.read][i],validate=repetitions[sourceNames.validate][i],append=repetitions[sourceNames.append][i],next=repetitions.Next_page_action[i];
   if(Date.parse(validate.startTime)<Date.parse(read.endTime)||Date.parse(append.startTime)<Date.parse(validate.endTime)||Date.parse(next.startTime)<Date.parse(append.endTime)||i>0&&Date.parse(read.startTime)<Date.parse(repetitions.Next_page_action[i-1].endTime))throw Error('SOURCE_NATIVE_DATAFLOW_ORDER');
  }
  await guard();
  return{privateSource:source,privateRepetitions:repetitions,receipt:{schemaVersion:1,method:staticProof.method,dataMode:binding.dataMode,flowId:binding.flowId,runId:binding.runId,nonce:binding.nonce,definitionSha256:binding.definitionSha256,sourceSha256:source.capsuleSha256,indexSha256:sourceDigest(source.index),repetitionsSha256:sourceDigest(repetitions),counts:source.counts,independentNativeRepetitionValueComparison:false,sourceOnlyMaximumBytes:SOURCE_CAPSULE_BYTES,checkerExecuted:false,successAccepted:false}};
 }catch{throw Error('SOURCE_OBSERVATION_FAILED_CONTENT_WITHHELD');}
}
