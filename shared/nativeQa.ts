import {z} from 'zod';
const hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const deniedAssertionSchema=z.strictObject({
 adapter:z.literal('native-denied-create-v1'),operation:z.enum(['create-project','create-request']),
 assertions:z.tuple([z.literal('authenticated-403'),z.literal('no-correlated-write'),z.literal('no-correlated-dispatch')]),
 observationWindowMs:z.number().int().min(1000).max(60000),pollIntervalMs:z.number().int().min(100).max(5000),
}).refine(v=>v.pollIntervalMs<=v.observationWindowMs,'Polling exceeds observation window');
export const nativeTargetSchema=z.strictObject({
 siteUrl:z.url().refine(v=>{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&!u.port&&/^[a-z0-9-]+[.]sharepoint[.]com$/.test(u.hostname)&&/^\/sites\/[A-Za-z0-9_-]+$/.test(u.pathname)&&u.href===v;}),
 siteCollectionId:z.uuid(),webId:z.uuid(),listId:z.uuid(),
});
export const nativeDeniedCheckSchema=z.strictObject({testName:z.string().trim().min(1).max(200),scenarioId:id,
 contract:deniedAssertionSchema,tenantId:z.uuid(),deniedSubject:z.uuid(),observerSubject:z.uuid(),deniedIdentity:id,observerIdentity:id,deniedUsername:z.email(),observerUsername:z.email(),targetSha256:hash,target:nativeTargetSchema.optional(),
 authorizationBoundary:z.strictObject({kind:z.literal('single-user-selected-app'),deniedClientId:z.uuid(),observerClientId:z.uuid(),observerGraphScope:z.enum(['Sites.Read.All','Sites.Manage.All']).optional()}).optional(),
 // Explicit reviewed workflow IDs; display-name searches never define coverage.
 dispatchHistory:z.strictObject({environmentId:z.string().regex(/^(?:Default-)?[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}$/),workflowIds:z.array(z.uuid()).min(1).max(10).refine(rows=>new Set(rows.map(v=>v.toLowerCase())).size===rows.length,'Duplicate workflow IDs')}).optional(),
}).refine(v=>v.deniedIdentity.toLowerCase()!==v.observerIdentity.toLowerCase()&&(v.authorizationBoundary?
 v.deniedSubject.toLowerCase()===v.observerSubject.toLowerCase()&&v.deniedUsername.toLowerCase()===v.observerUsername.toLowerCase()&&v.authorizationBoundary.deniedClientId.toLowerCase()!==v.authorizationBoundary.observerClientId.toLowerCase()&&!!v.target:
 v.deniedSubject.toLowerCase()!==v.observerSubject.toLowerCase()&&v.deniedUsername.toLowerCase()!==v.observerUsername.toLowerCase()),'Distinct native users required unless explicitly testing one user through distinct selected-permission applications');
export type NativeDeniedCheck=z.infer<typeof nativeDeniedCheckSchema>;
export const nativeQaContextSchema=z.strictObject({runId:z.uuid(),releaseId:z.uuid(),planHash:hash,recordSha256:hash,sourceCommit:z.string().regex(/^[a-f0-9]{40,64}$/),environmentUrl:z.url(),startedAt:z.iso.datetime()});
export type NativeQaContext=z.infer<typeof nativeQaContextSchema>;
