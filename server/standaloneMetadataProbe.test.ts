import {expect,it} from 'vitest';
import {standaloneProbeFixturePlan} from './testFixtures/standaloneProbe.ts';
import {buildStandaloneMetadataProbe,assertStandaloneProbeReadback} from './standaloneMetadataProbe.ts';
it('builds only two literal metadata GETs with a direct connection and an independent quarantine',()=>{
 const plan=standaloneProbeFixturePlan(),built=buildStandaloneMetadataProbe(plan),text=JSON.stringify(built);
 expect(text).not.toMatch(/connectionReferenceLogicalName|SendEmail|\/messages|Recurrence/);
 expect(Object.values(built.definition.actions).filter(a=>a.type==='OpenApiConnection')).toHaveLength(2);
 expect(plan.quarantine.membershipSettlementVerified).toBe(false);
 expect(assertStandaloneProbeReadback(plan,built.definition,built.connectionRefs)).toMatchObject({businessAuthorityGranted:false,sendActionPresent:false});
});
it('allows only the observed fixed template stamp and presentation metadata while preserving binding bytes',()=>{
 const p=standaloneProbeFixturePlan(),b=buildStandaloneMetadataProbe(p),d:any=structuredClone(b.definition);
 d.metadata={templateId:'fa2c7b91-3e04-4d8a-b6f1-a9e5c8d20147'};
 const refs={shared_office365:{...b.connectionRefs.shared_office365,displayName:'Office 365 Outlook',iconUri:'https://static.powerapps.com/resource/ppcr/releases/v1.0.1831/1.0.1831.5113/office365/icon.png',brandColor:'#0078D4',tier:'Standard',apiName:'office365',isProcessSimpleApiReferenceConversionAlreadyDone:false}};
 expect(assertStandaloneProbeReadback(p,d,refs)).toMatchObject({connectionRefsSha256:b.connectionRefsSha256});expect(d).toHaveProperty('metadata');
 d.metadata.other=true;expect(()=>assertStandaloneProbeReadback(p,d,refs)).toThrow();
});
it.each([
 (p:any)=>{p.publisher={};},(p:any)=>{p.solution={};},(p:any)=>{p.connection.logicalName='old_ref';},
 (p:any)=>{p.owner=p.qaOwner;},(p:any)=>{p.quarantine.replayAuthorized=true;},(p:any)=>{p.quarantine.holdPreserved=false;},
 (p:any)=>{p.quarantine.solutionId=p.quarantine.flowId;},(p:any)=>{p.historyPolicy.recordId='22222222-2222-4222-8222-222222222222';},
 (p:any)=>{p.historyPolicy.recordSha256='0'.repeat(64);},(p:any)=>{p.historyPolicy.ownerId='22222222-2222-4222-8222-222222222222';},
 (p:any)=>{p.target.environmentUrl='https://wrong.example/';},(p:any)=>{p.flow.name='AS-Recruitment-E2E-Digest';},
 (p:any)=>{p.limits.maxNativeCalls=65;},(p:any)=>{p.limits.maxTaskDurationMs=120001;},
])('refuses packaging, authority, quarantine or bound drift',mutate=>{
 const p:any=standaloneProbeFixturePlan();mutate(p);expect(()=>buildStandaloneMetadataProbe(p)).toThrow();
});
it.each([
 (_d:any,r:any)=>{r.shared_office365.connectionReferenceLogicalName='old';},
 (_d:any,r:any)=>{r.shared_office365.connectionName='shared-office365-other';},
 (_d:any,r:any)=>{r.other={};},(_d:any,r:any)=>{r.shared_office365.unknown=true;},
 (d:any)=>{d.actions.Metadata_http.inputs.parameters.Uri='https://graph.microsoft.com/v1.0/me/messages';},
 (d:any)=>{d.actions.Metadata_http.inputs.host.operationId='SendEmailV2';},
 (d:any)=>{d.actions.Metadata_http.inputs.retryPolicy.type='exponential';},
 (d:any)=>{d.triggers.manual.kind='Http';},(d:any)=>{d.metadata={templateId:'other'};},
])('refuses native binding/action/trigger drift',mutate=>{
 const p=standaloneProbeFixturePlan(),b=buildStandaloneMetadataProbe(p),d:any=structuredClone(b.definition),r:any=structuredClone(b.connectionRefs);mutate(d,r);expect(()=>assertStandaloneProbeReadback(p,d,r)).toThrow();
});

