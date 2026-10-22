import {expect,it} from 'vitest';
import {applicationSpecSchema,applicationSpecBlockers,applicationSpecLinkErrors,type ApplicationSpec} from './applicationSpec.ts';
function spec():ApplicationSpec{return {schemaVersion:1,journeys:[{id:'submit',actor:'Employee',outcome:'Submit an expense',requirementIds:['r1'],scenarios:[{id:'persist',kind:'happy',given:'A valid draft',when:'The employee submits',then:'The expense remains submitted after reload'}]}],decisions:[],assumptions:[],components:[{id:'app',platform:'canvas',owner:'dev',requirementIds:['r1'],contractIds:['expense'],dependsOn:[],findingIds:['source']}],securityBoundaries:[{id:'employee',actor:'Employee',allowed:'Read own expenses',denied:'Read another employee expense',requirementIds:['r1'],findingIds:['source']}],checks:[{id:'persist',kind:'runtime',requirementIds:['r1'],componentIds:['app'],scenarioIds:['persist'],expectedEvidence:'Authenticated journey and persisted readback'}]};}
const record={requirements:[{id:'r1'}],contracts:[{id:'expense'}],findings:[{id:'source'}]};
it('links observable journeys, checks, owners and facts without claiming execution',()=>{
  const value=applicationSpecSchema.parse(spec());expect(applicationSpecLinkErrors(value,record)).toEqual([]);expect(applicationSpecBlockers(value,[])).toEqual([]);
});
it('requires a decision answer and its source and holds material unresolved questions',()=>{
  const value=spec();value.decisions=[{id:'limit',owner:'manager',question:'Who can approve?',requirementIds:['r1'],material:true,status:'open'}];
  expect(applicationSpecBlockers(value,[]).join()).toContain('Who can approve? (owner: manager)');
  value.decisions[0].material=false;expect(applicationSpecBlockers(value,[])).toEqual([]);
  value.decisions[0].status='answered';expect(applicationSpecSchema.safeParse(value).success).toBe(false);
  Object.assign(value.decisions[0],{answer:'The assigned approver',answerSource:'Manager clarification reference 1'});expect(applicationSpecSchema.safeParse(value).success).toBe(true);
});
it('rejects cycles, missing dependencies, duplicate scenario IDs and unlinked runtime checks',()=>{
  const cycle=spec();cycle.components[0].dependsOn=['app'];expect(applicationSpecSchema.safeParse(cycle).success).toBe(false);
  const missing=spec();missing.components[0].dependsOn=['unknown'];expect(applicationSpecSchema.safeParse(missing).success).toBe(false);
  const duplicate=spec();duplicate.journeys[0].scenarios.push({...duplicate.journeys[0].scenarios[0]});expect(applicationSpecSchema.safeParse(duplicate).success).toBe(false);
  const unchecked=spec();unchecked.checks[0].scenarioIds=[];expect(applicationSpecSchema.safeParse(unchecked).success).toBe(false);
});
it('requires every declared requirement to have a journey and check and rejects invented fact/contract links',()=>{
  const value=spec();expect(applicationSpecLinkErrors(value,{...record,requirements:[...record.requirements,{id:'r2'}]})).toEqual(expect.arrayContaining(['r2: missing user journey','r2: missing verification check']));
  value.components[0].contractIds=['unknown'];value.components[0].findingIds=['invented'];expect(applicationSpecLinkErrors(value,record).join()).toMatch(/unknown shared contract.*unknown evidence/);
});
it('requires fresh observed ready findings for critical validated assumptions',()=>{
  const value=spec();value.assumptions=[{id:'receipt',statement:'Receipt content is available',owner:'dev',requirementIds:['r1'],critical:true,status:'validated',findingIds:['source']}];
  const finding={id:'source',status:'observed',conclusion:'ready',evidence:[{observedAt:new Date(1000).toISOString(),expiresAt:new Date(3000).toISOString()}]};
  expect(applicationSpecBlockers(value,[finding],2000)).toEqual([]);expect(applicationSpecBlockers(value,[finding],3000).join()).toContain('receipt');
  expect(applicationSpecBlockers(value,[{...finding,status:'assumed'}],2000)).toHaveLength(1);
});
