import fs from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {readBoundedText} from './boundedJson.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import {sharepointPlan,sharepointHash,journalSchema} from './sharepointProvisioning.ts';
import type {FlowAdapter} from './flowAdapter.ts';

/** Resolve only a verified resource from the server's completed bootstrap.
 * The native resolver encodes path arguments once; SharePoint's dataset segment
 * requires two layers. Encode the canonical raw URL once here, never retry. */
export async function sharepointConnectorSchema(home:string,cwd:string,repoId:string,key:string,identity:{tenantId:string;username:string;environmentId:string},connection:string,flow:FlowAdapter,guard:()=>void){
 const read=async(file:string)=>{guard();const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||await fs.realpath(file)!==path.resolve(file))throw Error('Schema input must be a regular unlinked file');const text=await readBoundedText(file,64*1024);guard();if(!text)throw Error('Schema input unavailable');return text;};
 const planFile=path.join(cwd,'cubefarm.sharepoint.json'),planBytes=await read(planFile),plan=sharepointPlan.parse(parseUnambiguousJson(planBytes)),planSha256=sharepointHash(plan);
 if(plan.tenantId.toLowerCase()!==identity.tenantId.toLowerCase()||plan.username.toLowerCase()!==identity.username.toLowerCase())throw Error('Schema plan identity differs');
 const resource=plan.resources.find(r=>r.key===key);if(!resource)throw Error('Unknown planned schema resource');
 const journalFile=path.join(home,'planning','sharepoint-provisioning',planSha256+'.json'),journalBytes=await read(journalFile),journal=journalSchema.parse(parseUnambiguousJson(journalBytes));
 const authority=z.object({repoId:z.literal(repoId)}).parse(parseUnambiguousJson(journal.authority));
 const entries=journal.entries.filter(e=>e.key===key);
 if(journal.planSha256!==planSha256||entries.length!==1||entries[0].status!=='verified'||!entries[0].id||entries[0].migration||!entries[0].marker.startsWith(`CubeFarm:${planSha256}:`))throw Error('Schema resource lacks exact verified bootstrap provenance');
 const check=async()=>{guard();if(await read(planFile)!==planBytes||await read(journalFile)!==journalBytes)throw Error('Schema plan or bootstrap changed');};await check();
 const result=await flow.call('invoke_operation',{env:identity.environmentId,connector:'shared_sharepointonline',connection,operation:'GetTable',params:{dataset:encodeURIComponent(plan.siteUrl),table:entries[0].id}});await check();
 const field=z.object({type:z.enum(['string','integer','number','boolean','object','array']).optional(),$ref:z.string().regex(/^#\/definitions\/[A-Za-z0-9_.-]+$/).optional()}).refine(value=>value.type!==undefined||value.$ref!==undefined,'Field needs a supported type or local reference');
 const schema=z.object({name:z.string(),schema:z.object({type:z.literal('array'),items:z.object({type:z.literal('object'),properties:z.record(z.string(),field),required:z.array(z.string()).optional()})})}).parse(result);
 if(schema.name.toLowerCase()!==entries[0].id.toLowerCase()||!schema.schema.items.properties.Title||resource.columns.some(c=>!Object.hasOwn(schema.schema.items.properties,c.name)))throw Error('Native schema does not match the planned list');
 if(schema.schema.items.required?.some(name=>!Object.hasOwn(schema.schema.items.properties,name)))throw Error('Required field is missing from native schema');
 return {scope:'native-sharepoint-list-schema',repoId:authority.repoId,planSha256,resourceKey:key,siteUrl:plan.siteUrl,listId:entries[0].id,connectionId:connection,environmentId:identity.environmentId,tenantId:identity.tenantId,username:identity.username,encoding:'sharepoint-dataset-double-path-v1',metadata:result,requiredFields:schema.schema.items.required??[],limits:['Native connector field metadata only; not effective item-write rights, application runtime or QA approval','Required list fields are a conservative create-flow precheck, not an operation-specific PatchItem schema. Preserve required unchanged values only under an independently approved task contract.']};
}
