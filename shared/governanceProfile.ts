import {z} from 'zod';

const text=z.string().trim().min(1).max(4000);
export const governanceEvidence=z.strictObject({reference:text,sha256:z.string().regex(/^[a-f0-9]{64}$/),observedAt:z.iso.datetime(),expiresAt:z.iso.datetime()});
/** Entitlements, configuration and effectiveness are separate observations.
 * Product names never imply that a control is licensed or working. */
export const governanceProfileSchema=z.strictObject({
  tenantId:z.uuid(),environmentUrl:z.url(),audience:text,
  subscriptions:z.array(z.strictObject({product:text,skuId:z.uuid().optional(),assignmentScope:text,state:z.enum(['enabled','disabled','unknown']),evidence:z.array(governanceEvidence).min(1).max(20)})).max(100),
  controls:z.array(z.strictObject({id:z.string().regex(/^[\w-]{1,80}$/),name:text,owner:text,scope:text,
    requirement:z.enum(['required','optional','not-applicable']),
    availability:z.enum(['available','unavailable','unknown']),
    subscriptionProducts:z.array(text).max(20).default([]),
    delivery:z.enum(['automated','manual','none']),verification:z.enum(['verified','unverified']),
    rationale:text,evidence:z.array(governanceEvidence).max(20),
  })).min(1).max(100),
}).superRefine((profile,ctx)=>{
  if(new Set(profile.controls.map(c=>c.id)).size!==profile.controls.length)ctx.addIssue({code:'custom',message:'Governance control IDs must be unique'});
  for(const control of profile.controls)if((control.verification==='verified'||control.requirement==='not-applicable')&&!control.evidence.length)ctx.addIssue({code:'custom',message:'Verified or inapplicable controls require evidence'});
  for(const receipt of [...profile.subscriptions.flatMap(s=>s.evidence),...profile.controls.flatMap(c=>c.evidence)])if(Date.parse(receipt.expiresAt)<=Date.parse(receipt.observedAt))ctx.addIssue({code:'custom',message:'Governance evidence expiry must follow observation'});
});
export type GovernanceProfile=z.infer<typeof governanceProfileSchema>;
export function governanceProfileBlockers(profile:GovernanceProfile,now=Date.now()):string[]{
  const fresh=(e:z.infer<typeof governanceEvidence>)=>Date.parse(e.observedAt)<=now+60000&&Date.parse(e.expiresAt)>now;
  return profile.controls.flatMap(control=>{
    if(control.requirement==='optional')return [];
    const prefix=`Governance ${control.name} (owner: ${control.owner})`;
    if(!control.evidence.length||!control.evidence.every(fresh))return [`${prefix}: inspect current evidence`];
    if(control.requirement==='not-applicable')return [];
    if(control.delivery==='automated'&&(!control.subscriptionProducts.length||control.subscriptionProducts.some(product=>!profile.subscriptions.some(subscription=>subscription.product===product&&subscription.state==='enabled'&&subscription.evidence.length>0&&subscription.evidence.every(fresh)))))return [`${prefix}: verify current entitlement and assignment evidence for the automated control`];
    if(control.availability!=='available'||control.delivery==='none'||control.verification!=='verified')return [`${prefix}: required control is not independently verified; implement an evidenced automated or manual control, or revise scope through independent review`];
    return [];
  });
}
