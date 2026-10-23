import {z} from 'zod';

/** Explicit selection of a separately reviewed, fixed technical probe. This
 * descriptor alone grants no work or execution authority. Legacy records keep
 * their current gates; business design/task/private/send gates are unchanged. */
export const connectorProbeScopeSchema=z.strictObject({
 kind:z.literal('outlook-folder-metadata-probe-v1'),taskIssue:z.number().int().positive(),
 flowComponentId:z.literal('digest-flow'),solutionComponentId:z.literal('solution'),
 resourcePolicy:z.literal('same-eventual-owned-flow'),
 historyPolicy:z.literal('existing-tenant-history-and-protected-windows-leaf'),
 businessAuthorityGranted:z.literal(false),messageAccessAllowed:z.literal(false),sendAllowed:z.literal(false),
});
