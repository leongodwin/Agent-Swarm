import { z } from 'zod';
import crypto from 'node:crypto';
import { verifyTenantSnapshot } from './tenantDlp.ts';

const classification = z.enum(['Confidential', 'General', 'Blocked']);
const connector = z.object({id:z.string().min(1).max(500),name:z.string().max(500).optional(),type:z.string().max(500).optional()}).strict();
const policySchema = z.object({name:z.string().min(1).max(500),displayName:z.string().max(500).optional(),
  environmentType:z.enum(['AllEnvironments','OnlyEnvironments','ExceptEnvironments']),
  environments:z.array(z.object({name:z.string().min(1).max(100),id:z.string().max(500).optional(),type:z.string().max(500).optional()}).strict()).max(5000),
  defaultConnectorsClassification:classification,connectorGroups:z.array(z.object({classification,connectors:z.array(connector).max(5000)}).strict()).max(3),
  id:z.string().optional(),etag:z.string().nullable().optional(),createdBy:z.unknown().optional(),createdTime:z.string().optional(),lastModifiedBy:z.unknown().optional(),lastModifiedTime:z.string().optional(),
}).strict();
const resourcesSchema = z.array(z.object({id:z.string().min(1).max(500),complete:z.boolean(),connectors:z.array(z.string().min(1).max(500)).max(1000)}).strict()).min(1).max(1000);
const environmentSchema=z.string().regex(/^(?:Default-)?[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
export interface StandardPolicyResult {status:'clear'|'blocked'|'unavailable';scope:'declared-resource-standard-classification';policySha256?:string;reasons:string[];appliedPolicies:string[];complianceVerified:false}
/** Canonical standard connector ID form only; this does not certify catalogue membership. */
export function standardConnectorId(value:string):string|null {
  const id=value.replace(/^\/providers\/Microsoft.PowerApps\/apis\//i,'').toLowerCase();
  return /^shared_[a-z0-9_]+$/.test(id) ? id : null;
}
/** Standard classification evaluation is per app/flow, never across unrelated resources.
 * This cannot prove resource inventory completeness or advanced/action/endpoint policy compliance. */
export function evaluateStandardPolicies(snapshot:unknown, identity:{tenantId:string;caller:string}, environmentId:string, resources:unknown, now=Date.now()):StandardPolicyResult {
  const result:StandardPolicyResult={status:'unavailable',scope:'declared-resource-standard-classification',reasons:[],appliedPolicies:[],complianceVerified:false};
  const reason=(message:string)=>{if(result.reasons.length<30&&!result.reasons.includes(message))result.reasons.push(message);};
  try {
    if(JSON.stringify(snapshot).length>8*1024*1024||JSON.stringify(resources).length>1024*1024)throw new Error('inventory size limit');
    const inventory=verifyTenantSnapshot(snapshot,identity,now),environment=environmentSchema.parse(environmentId).toLowerCase(),targets=resourcesSchema.parse(resources);
    const entries=targets.reduce((sum,resource)=>sum+resource.connectors.length,0);
    if(entries>10000||inventory.policies.length*(entries+targets.length)>1000000)throw new Error('evaluation complexity limit');
    if(new Set(targets.map(resource=>resource.id)).size!==targets.length) throw new Error('ambiguous resources');
    result.policySha256=crypto.createHash('sha256').update(JSON.stringify(inventory.policies)).digest('hex');
    let blocked=false,unknown=targets.some(resource=>!resource.complete);
    const denials:string[]=[];
    const deny=(message:string)=>{blocked=true;const bounded=message.slice(0,1000);if(denials.length<30&&!denials.includes(bounded))denials.push(bounded);};
    if(unknown)reason('Resource inventory is incomplete; known connector checks cannot authorize it');
    for(const raw of inventory.policies) {
      const parsed=policySchema.safeParse(raw);
      if(!parsed.success) {unknown=true;reason('A policy contains unsupported or malformed configuration');continue;}
      const policy=parsed.data;
      let groups:Map<string,z.infer<typeof classification>>;
      try{
      const environments=policy.environments.map(item=>environmentSchema.parse(item.name).toLowerCase());
      if(new Set(environments).size!==environments.length || (policy.environmentType==='AllEnvironments' && environments.length)) throw new Error('ambiguous policy scope');
      const applies=policy.environmentType==='AllEnvironments' || (policy.environmentType==='OnlyEnvironments' ? environments.includes(environment) : !environments.includes(environment));
      if(!applies) continue;
      groups=new Map<string,z.infer<typeof classification>>(); const seen=new Set<string>();
      for(const group of policy.connectorGroups) {
        if(seen.has(group.classification)) throw new Error('ambiguous connector groups');seen.add(group.classification);
        for(const item of group.connectors) {
          const id=standardConnectorId(item.id);
          if(!id) {unknown=true;reason(`Policy ${policy.name} requires unsupported connector classification`);continue;}
          if(groups.has(id)) throw new Error('ambiguous connector classification');groups.set(id,group.classification);
        }
      }
      }catch{unknown=true;reason('A policy contains ambiguous or invalid scope/classification configuration');continue;}
      result.appliedPolicies.push(policy.name);
      for(const resource of targets) {
        const classes=new Set<string>();
        for(const rawId of resource.connectors) {
          const id=standardConnectorId(rawId);
          if(!id) {unknown=true;reason(`Resource ${resource.id} needs custom, virtual or HTTP connector evidence`);continue;}
          const explicit=groups.get(id);
          // Default Blocked has platform exceptions for nonblockable connectors.
          // No catalogue is inferred from a connector's display name.
          if(!explicit && policy.defaultConnectorsClassification==='Blocked') {unknown=true;reason(`Resource ${resource.id} requires verified default-blocking exception rules`);continue;}
          const assigned=explicit??policy.defaultConnectorsClassification;
          if(assigned==='Blocked') deny(`Policy ${policy.name} blocks ${id} in ${resource.id}`);
          else classes.add(assigned);
        }
        if(classes.has('Confidential')&&classes.has('General')) deny(`Policy ${policy.name} separates Business and Non-Business connectors in ${resource.id}`);
      }
    }
    // Even with no standard policies, unsupported resources are not silently approved.
    if(targets.some(resource=>resource.connectors.some(id=>!standardConnectorId(id)))) {unknown=true;reason('Resource inventory contains unsupported connector types');}
    result.status=blocked?'blocked':unknown?'unavailable':'clear';
    result.reasons=[...denials,...result.reasons.filter(message=>!denials.includes(message))].slice(0,30);
    if(!result.reasons.length) result.reasons.push('Declared resources passed standard classification only; advanced rules, endpoints, exemptions and schema are separate');
  } catch {result.status='unavailable';result.reasons=['Policy identity, freshness, scope, classifications or resource inventory cannot be verified'];}
  return result;
}
