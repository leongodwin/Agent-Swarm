import {expect,it} from 'vitest';
import {platformDiscoveryRequest} from './platformDiscovery.ts';

it('accepts a service-assigned sequential flow GUID for original-run reconciliation',()=>{
 const request={kind:'headless-run-reconciliation',flowId:'22222222-2222-f111-8222-222222222222',runId:'original-run'};
 expect(platformDiscoveryRequest.parse(request)).toEqual(request);
});
it.each(['not-a-guid','22222222-2222-f111-8222-222222222222/other','Default-22222222-2222-f111-8222-222222222222'])('refuses malformed reconciliation flow ID %s',flowId=>{
 expect(()=>platformDiscoveryRequest.parse({kind:'headless-run-reconciliation',flowId})).toThrow();
});
