import{deliveryRecordContentSchema,type DeliveryRecordContent}from'../shared/deliveryRecord.ts';
/** Makes each governing acceptance criterion explicit in both integration
 * phases. This binds required future assertions; it never supplies results. */
export function bindGovernanceCriteria(content:DeliveryRecordContent):DeliveryRecordContent{
 const next=structuredClone(content),spec=next.applicationSpec,plan=next.taskPlan;
 if(!spec||plan?.schemaVersion!==2||!plan.integrationQa?.length)throw Error('Independent integration contracts required');
 const journey=spec.journeys.find(j=>j.id==='govern');if(!journey||journey.scenarios.length!==3||!['happy','denied','failure'].every(kind=>journey.scenarios.some(s=>s.kind===kind)))throw Error('Complete governing scenarios required');
 for(const requirementId of ['standard-entitlements','independent-delivery']){
  const requirement=next.requirements.find(r=>r.id===requirementId);if(!requirement||!journey.requirementIds.includes(requirementId))throw Error('Governing requirement binding missing');
  const checkId='govern-'+requirementId;
  const check={id:checkId,kind:'runtime' as const,requirementIds:[requirementId],componentIds:['release-evidence'],scenarioIds:journey.scenarios.map(s=>s.id),expectedEvidence:'Independent exact-phase evidence for this acceptance criterion: slice covers only its deployed component map and scenarios; expansion covers the full approved map. Real native identities, target/source/record/release hashes and operation evidence required; no static or predetermined success.'};
  const existing=spec.checks.find(c=>c.id===checkId);if(existing&&JSON.stringify(existing)!==JSON.stringify(check))throw Error('Existing governing check conflicts; independently reconcile it');if(!existing)spec.checks.push(check);
  for(const qa of plan.integrationQa){
   if(!qa.checkIds.includes(checkId))qa.checkIds.push(checkId);
   for(const scenario of journey.scenarios){const row={checkId,scenarioId:scenario.id,testName:`showcase-${qa.purpose}-${checkId}-${scenario.kind}`,criterion:requirement.acceptance};const old=qa.cases.find(c=>c.checkId===checkId&&c.scenarioId===scenario.id);if(old&&JSON.stringify(old)!==JSON.stringify(row))throw Error('Existing governing case conflicts; independently reconcile it');if(!old)qa.cases.push(row);}
  }
 }
 return deliveryRecordContentSchema.parse(next);
}
