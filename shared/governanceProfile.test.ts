import {expect,it} from 'vitest';
import {governanceProfileSchema,governanceProfileBlockers} from './governanceProfile.ts';
const now=Date.now(),evidence=[{reference:'synthetic-receipt.json',sha256:'a'.repeat(64),observedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString()}];
const control={id:'retention',name:'Retention',owner:'security-owner',scope:'Pilot records',requirement:'required',availability:'available',delivery:'manual',verification:'verified',rationale:'Inspected manual retention procedure and actual configuration',evidence};
const fixture=()=>governanceProfileSchema.parse({tenantId:'11111111-1111-4111-8111-111111111111',environmentUrl:'https://test.crm4.dynamics.com',audience:'Dedicated pilot user',subscriptions:[],controls:[control]});
it('permits a verified manual baseline without pretending premium automation is available',()=>{
 const profile=fixture();profile.controls.push({...profile.controls[0],id:'auto-label',name:'Automatic labelling',requirement:'optional',availability:'unavailable',delivery:'none',verification:'unverified',evidence:[]});
 expect(governanceProfileBlockers(profile,now)).toEqual([]);
});
it('does not infer automated control effectiveness or entitlements from a product name',()=>{
 const profile=fixture();profile.controls[0].delivery='automated';profile.controls[0].subscriptionProducts=['Microsoft 365 E5'];
 expect(governanceProfileBlockers(profile,now)[0]).toContain('entitlement');
 profile.subscriptions.push({product:'Microsoft 365 E5',assignmentScope:'Pilot user',state:'enabled',evidence});
 profile.controls[0].verification='unverified';expect(governanceProfileBlockers(profile,now)[0]).toContain('not independently verified');
 profile.controls[0].verification='verified';expect(governanceProfileBlockers(profile,now)).toEqual([]);
 profile.subscriptions[0].evidence=[{...evidence[0],expiresAt:new Date(now-1).toISOString()}];expect(governanceProfileBlockers(profile,now)[0]).toContain('entitlement');
});
it('keeps required missing controls blocked and requires evidence for inapplicability',()=>{
 const profile=fixture();profile.controls[0].availability='unavailable';expect(governanceProfileBlockers(profile,now)[0]).toContain('required control');
 expect(()=>governanceProfileSchema.parse({...profile,controls:[{...profile.controls[0],requirement:'not-applicable',evidence:[]}]})).toThrow('require evidence');
 profile.controls[0].requirement='not-applicable';expect(governanceProfileBlockers(profile,now)).toEqual([]);
});
