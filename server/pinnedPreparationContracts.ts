import {z} from 'zod';
export const sourceCommit=z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/);
export const artifactPath=z.string().max(180).regex(/^[a-zA-Z0-9_][a-zA-Z0-9_.\/-]*$/).refine(value=>value.split('/').every(part=>part&&part!=='.'&&part!=='..'&&!/[. ]$/.test(part)&&!(/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)))&&!value.includes('\\'));
// One fixed authority file may be inspected as committed source. This does not
// widen deployment artifact paths or expose arbitrary hidden configuration.
const pinnedReadPath=z.union([artifactPath,z.literal('.cubefarm/worker-preflight.json')]);
const digest=z.string().regex(/^[a-f0-9]{64}$/);
export const pinnedSourceSchema=z.strictObject({kind:z.literal('pinned-artifact-v1'),sourceCommit,manifestSha256:digest});
export const pinnedArtifactSchema=z.strictObject({kind:z.literal('pinned-artifact-v1'),packageBase64:artifactPath,packageSha256:digest,files:z.array(z.strictObject({path:artifactPath,sha256:digest})).min(3).max(20)});
export const localPreparationSchema=z.strictObject({kind:z.literal('pinned-artifact-v1'),sourceCommit,manifestSha256:digest,checkout:z.string().max(2000),files:z.array(z.strictObject({path:artifactPath,sha256:digest})).min(5).max(22)});
export type LocalPreparation=z.infer<typeof localPreparationSchema>;
export const pinnedGitPrefix=['--no-pager','--no-lazy-fetch','--no-replace-objects','--no-optional-locks','-c','core.fsmonitor=false','-c','protocol.allow=never','-c','credential.helper='];
export function pinnedGitArgs(kind:'blob'|'entry',commit:string,file:string){sourceCommit.parse(commit);pinnedReadPath.parse(file);return [...pinnedGitPrefix,...(kind==='blob'?['cat-file','blob',`${commit}:${file}`]:['ls-tree','-z',commit,'--',file])];}
export function isPinnedGitArgs(args:string[]){
 if(JSON.stringify(args.slice(0,pinnedGitPrefix.length))!==JSON.stringify(pinnedGitPrefix))return false;
 const tail=args.slice(pinnedGitPrefix.length);
 if(tail.length===3&&tail[0]==='cat-file'&&tail[1]==='blob'){const i=tail[2].indexOf(':');return sourceCommit.safeParse(tail[2].slice(0,i)).success&&pinnedReadPath.safeParse(tail[2].slice(i+1)).success;}
 return tail.length===5&&tail[0]==='ls-tree'&&tail[1]==='-z'&&sourceCommit.safeParse(tail[2]).success&&tail[3]==='--'&&pinnedReadPath.safeParse(tail[4]).success;
}
export function nativeEnvironment(env:NodeJS.ProcessEnv,args:string[],file:string){const result={...env};if(/(?:^|[\\/])git(?:\.exe)?$/i.test(file)&&isPinnedGitArgs(args)){for(const key of Object.keys(result))if(/^GIT_/i.test(key))delete result[key];result.GIT_CONFIG_NOSYSTEM='1';result.GIT_CONFIG_GLOBAL=process.platform==='win32'?'NUL':'/dev/null';}return result;}
