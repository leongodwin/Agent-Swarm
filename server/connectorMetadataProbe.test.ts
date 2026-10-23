import {expect,it} from 'vitest';
import {connectorProbeFixturePlan} from './testFixtures/connectorProbe.ts';
import {buildConnectorMetadataProbe,assertConnectorProbeReadback,connectorProbePlanSchema,CONNECTOR_PROBE_URI,CONNECTOR_PROBE_MISSING_URI} from './connectorMetadataProbe.ts';

const plan=()=>connectorProbeFixturePlan() as any;
it('builds exactly two fixed folder GETs, one manual trigger, no message routes or send action',()=>{const p=connectorProbePlanSchema.parse(plan()),built=buildConnectorMetadataProbe(p),text=JSON.stringify(built.definition),actions=Object.values(built.definition.actions).filter(a=>a.type==='OpenApiConnection') as any[];expect(actions).toHaveLength(2);expect(actions.map(a=>a.inputs.parameters.Uri)).toEqual([CONNECTOR_PROBE_URI,CONNECTOR_PROBE_MISSING_URI]);expect(actions.every(a=>a.inputs.parameters.Method==='GET'&&a.inputs.retryPolicy.type==='none')).toBe(true);expect(text).not.toMatch(/\/messages|SendEmail|Recurrence|recipient|approvedReport/);expect(built.definition.actions.Missing_folder_http.runAfter).toEqual({Validate_folder_metadata:['Succeeded']});expect(built.definition.triggers.manual.kind).toBe('Button');expect(built.connectionRefs.shared_office365.source).toBe('Embedded');expect(assertConnectorProbeReadback(p,built.definition,built.connectionRefs)).toMatchObject({businessAuthorityGranted:false,messageRoutesPresent:false,sendActionPresent:false});});
it('normalizes only the exact server-injected authentication reference on readback',()=>{const p=connectorProbePlanSchema.parse(plan()),b=buildConnectorMetadataProbe(p),d:any=structuredClone(b.definition);d.actions.Metadata_http.inputs.authentication="@parameters('$authentication')";expect(()=>assertConnectorProbeReadback(p,d,b.connectionRefs)).not.toThrow();d.actions.Metadata_http.inputs.authentication={type:'Other'};expect(()=>assertConnectorProbeReadback(p,d,b.connectionRefs)).toThrow('CONNECTOR_PROBE_READBACK_DIFFERS');});
it.each([
 (p:any)=>{p.definition={};},(p:any)=>{p.uri='https://other';},(p:any)=>{p.qaOwner=p.owner;},
 (p:any)=>{p.connection.connector='shared_commondataserviceforapps';},(p:any)=>{p.connection.logicalName='foreign_office365';},
 (p:any)=>{p.publisher.prefix='new';},(p:any)=>{p.flow.name='Unscoped';},
 (p:any)=>{p.historyPolicy.recordId='22222222-2222-4222-8222-222222222222';},(p:any)=>{p.historyPolicy.recordSha256='b'.repeat(64);},
 (p:any)=>{p.historyPolicy.ownerId='22222222-2222-4222-8222-222222222222';},
 (p:any)=>{p.limits.maxTaskDurationMs=120001;},(p:any)=>{p.limits.maxNativeCalls=65;},(p:any)=>{p.limits.hostTriggerCalls=2;},
 (p:any)=>{p.target.environmentUrl='https://approved.crm4.dynamics.com:444/';},
 (p:any)=>{p.target.environmentUrl='https://other.example/';},(p:any)=>{p.target.environmentUrl='http://approved.crm4.dynamics.com/';},
 (p:any)=>{p.target.environmentUrl='https://approved.crm4.dynamics.com/other';},(p:any)=>{p.target.environmentUrl='https://approved.crm4.dynamics.com/?other=1';},
 (p:any)=>{p.target.environmentUrl='https://user@approved.crm4.dynamics.com/';},
])('refuses arbitrary authority, target drift and changed bounds',mutate=>{const p=plan();mutate(p);expect(()=>buildConnectorMetadataProbe(p)).toThrow();});
it.each([
 (d:any)=>{d.actions.Metadata_http.inputs.parameters.Uri='https://graph.microsoft.com/v1.0/me/messages';},
 (d:any)=>{d.actions.Metadata_http.inputs.parameters.Method='POST';},
 (d:any)=>{d.actions.Metadata_http.inputs.retryPolicy.type='exponential';},
 (d:any)=>{d.actions.Metadata_http.inputs.host.operationId='SendEmailV2';},
 (d:any)=>{d.actions.Metadata_http.inputs.host.connectionName='other';},
 (d:any)=>{d.triggers.manual.kind='Http';},
 (d:any)=>{d.actions.Missing_folder_http.runAfter={Probe_context:['Succeeded']};},
 (d:any)=>{d.actions.Validate_folder_metadata.inputs.content='unverified';},
 (d:any)=>{d.actions.Other={type:'Compose',inputs:'extra'};},
])('rejects changed stopped-flow readback before any grant',mutate=>{const p=connectorProbePlanSchema.parse(plan()),b=buildConnectorMetadataProbe(p),d:any=structuredClone(b.definition);mutate(d);expect(()=>assertConnectorProbeReadback(p,d,b.connectionRefs)).toThrow(/^CONNECTOR_PROBE_READBACK_DIFFERS$/);});
it('refuses a changed connection binding or an extra connection',()=>{const p=connectorProbePlanSchema.parse(plan()),b=buildConnectorMetadataProbe(p),refs:any=structuredClone(b.connectionRefs);refs.shared_office365.connectionName='shared-office365-other';expect(()=>assertConnectorProbeReadback(p,b.definition,refs)).toThrow();expect(()=>assertConnectorProbeReadback(p,b.definition,{...b.connectionRefs,other:b.connectionRefs.shared_office365})).toThrow();});
