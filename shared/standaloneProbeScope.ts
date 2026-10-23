import {z} from 'zod';
/** Prospective selection only. Old probe leases and business gates stay intact. */
export const standaloneProbeScopeSchema=z.strictObject({
 kind:z.literal('outlook-folder-metadata-standalone-v1'),taskIssue:z.number().int().positive(),
 flowComponentId:z.literal('digest-flow'),flowResource:z.string().regex(/^[A-Za-z0-9_-]{1,160}$/),
 authoringOrderContractId:z.literal('standalone-connector-probe-authority'),
 resourcePolicy:z.literal('new-flow-with-quarantined-original'),historyPolicy:z.literal('existing-tenant-history-and-protected-windows-leaf'),
 businessAuthorityGranted:z.literal(false),messageAccessAllowed:z.literal(false),sendAllowed:z.literal(false),
});
