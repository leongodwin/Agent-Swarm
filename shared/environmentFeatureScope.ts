import {z} from 'zod';
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),hash=z.string().regex(/^[a-f0-9]{64}$/),guid=z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i).transform(value=>value.toLowerCase());
/** A separate administrative phase, never an authoring/private-mail/send grant.
 * Its exact proposal needs assigned independent QA and integrated host source. */
export const environmentFeatureScopeSchema=z.strictObject({
 kind:z.literal('disable-default-solution-flows'),contractId:id,decisionId:id,
 hostTask:z.strictObject({repository:z.literal('leongodwin/Agent-Swarm'),issue:z.number().int().positive(),owner:id,assignee:z.string().regex(/^[A-Za-z0-9-]{1,39}$/),pullRequest:z.number().int().positive(),sourceCommit:z.string().regex(/^[a-f0-9]{40}$/)}),
 target:z.strictObject({tenantId:z.uuid(),environmentId:guid,organizationId:guid,userId:guid,aadObjectId:z.uuid(),username:z.email(),environmentUrl:z.url().refine(value=>{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&u.pathname==='/';},'Credential-free exact HTTPS origin required')}),
 field:z.literal('enableflowsinsolutionbydefault'),value:z.literal(false),
 preservedFlowIds:z.array(guid).length(2).refine(values=>new Set(values).size===2,'Preserve two distinct held flows'),
 preserved:z.array(z.strictObject({kind:z.enum(['connector-probe','standalone-probe']),scopeSha256:hash,indexName:z.string().regex(/^(?:original-probe-failure-index|standalone-probe-[0-9]+-held-index)\.json$/),indexSha256:hash,leaseSha256:hash})).length(2).refine(values=>new Set(values.map(value=>value.kind)).size===2&&new Set(values.map(value=>value.scopeSha256)).size===2,'Preserve both distinct consumed scopes'),
}).superRefine((value,context)=>{for(const item of value.preserved)if(item.kind==='connector-probe'?item.indexName!=='original-probe-failure-index.json':!/^standalone-probe-[0-9]+-held-index\.json$/.test(item.indexName))context.addIssue({code:'custom',message:'Preserved index kind/name differ'});});
export type EnvironmentFeatureScope=z.infer<typeof environmentFeatureScopeSchema>;
