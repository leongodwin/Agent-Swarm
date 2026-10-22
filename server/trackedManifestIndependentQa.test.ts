import {expect,it} from 'vitest';
import {deliveryManifest} from './delivery.ts';
function fixture(){return {schemaVersion:1,solutionUniqueName:'Probe',solutionVersion:'1.0.0.0',solutionZip:'probe.zip',hasUi:false,recovery:{runbook:'recovery.md',rehearsalReport:'rehearsal.json'},documentation:['one.md','two.md','three.md'],build:[{executable:'node',args:['build.js']}],test:[{executable:'node',args:['test.js']}],verify:[{executable:'node',args:['verify.js']}]};}
const id='11111111-1111-4111-8111-111111111111';
const approved={manualDevelopmentGovernance:true as const,targetBinding:{organizationId:id,userId:id},platformIdentity:{tenantId:id,environmentId:id,username:'probe@example.test'}};
it('preserves default PAC while requiring explicit reviewed development opt-in for tracked import',()=>{
 expect(deliveryManifest.parse(fixture()).importTransport).toBeUndefined();
 expect(deliveryManifest.safeParse({...fixture(),importTransport:'dataverse-tracked'}).success).toBe(false);
 expect(deliveryManifest.parse({...fixture(),importTransport:'dataverse-tracked',...approved}).importTransport).toBe('dataverse-tracked');
});
it.each(['no-identity','no-binding'])('requires tracked executor preflight %s before mutation',fault=>{
 const manifest:any={...fixture(),importTransport:'dataverse-tracked',...approved};delete manifest[fault==='no-identity'?'platformIdentity':'targetBinding'];expect(deliveryManifest.safeParse(manifest).success).toBe(false);
});
it.each(['missing-digest','with-digest'])('refuses settings %s rather than dropping PAC settings semantics',fault=>{
 expect(deliveryManifest.safeParse({...fixture(),importTransport:'dataverse-tracked',manualDevelopmentGovernance:true,settingsFile:'deployment-settings.json',...(fault==='with-digest'?{settingsSha256:'a'.repeat(64)}:{})}).success).toBe(false);
});
it('refuses an unknown transport rather than silently executing PAC',()=>{expect(deliveryManifest.safeParse({...fixture(),importTransport:'automatic-retry'}).success).toBe(false);});
