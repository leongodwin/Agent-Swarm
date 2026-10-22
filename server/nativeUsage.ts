import {z} from 'zod';
const count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const sample=z.strictObject({schemaVersion:z.literal(1),source:z.literal('opencode-message-v1'),sampleId:z.string().min(1).max(240),inputTokens:count,outputTokens:count,costUsd:z.number().finite().nonnegative().nullable()});
/** Native per-prompt snapshots replace duplicate notifications; they are not cumulative session totals. */
export class AttemptUsage {
 constructor(private currentAttempt=true){}
 private samples=new Map<string,z.infer<typeof sample>>();private missing=false;
 observe(value:unknown){if(!this.currentAttempt)return;const parsed=sample.safeParse(value);if(!parsed.success){this.missing=true;return;}if(this.samples.size>=1000&&!this.samples.has(parsed.data.sampleId)){this.missing=true;return;}this.samples.set(parsed.data.sampleId,parsed.data);}
 snapshot(){const rows=[...this.samples.values()],input=rows.reduce((n,r)=>n+r.inputTokens,0),output=rows.reduce((n,r)=>n+r.outputTokens,0),cost=rows.reduce((n,r)=>n+(r.costUsd??0),0),complete=rows.length>0&&!this.missing&&Number.isSafeInteger(input)&&Number.isSafeInteger(output)&&Number.isFinite(cost);
 return {inputTokens:complete?input:null,outputTokens:complete?output:null,costUsd:complete&&rows.every(r=>r.costUsd!==null)?cost:null,usageCoverage:complete?'complete' as const:rows.length?'partial' as const:'unknown' as const,usageScope:'attempt' as const,usageSource:rows.length?'opencode-message-v1' as const:'unavailable' as const};}
}

/** Evidence source is inseparable from the runtime that produced it. */
export function usageSourceMatches(runtime:string,source:unknown){
 return runtime==='opencode'?source==='opencode-message-v1':runtime==='codex'?source==='codex-response-v1':runtime==='gemini'?source==='gemini-session-v1':false;
}
