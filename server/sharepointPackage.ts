import type {PackageInventory} from './packageInventory.ts';
import {sharepointDeliverySchema} from './sharepointDelivery.ts';
import {sharepointHash} from './sharepointProvisioning.ts';
/** Package bindings are not runtime or policy approval. Reject wrong targets
 * before import, including a package silently omitting its declared app. */
export function assertSharepointPackage(inventory:PackageInventory,input:unknown,expectedComponents:{kind:string;logicalName:string}[]=[]){
 const contract=sharepointDeliverySchema.parse(input);if(!inventory.archiveComplete)throw Error('SharePoint package archive could not be fully inspected');
 for(const expected of expectedComponents.filter(c=>c.kind==='canvas'))if(!inventory.components.some(c=>c.type===300&&c.name?.toLowerCase()===expected.logicalName.toLowerCase())||!inventory.resources.some(r=>r.kind==='canvas'&&r.id.toLowerCase()===expected.logicalName.toLowerCase()))throw Error('Expected Canvas app is absent from package');
 for(const component of inventory.components.filter(c=>c.type===300))if(!inventory.resources.some(r=>r.kind==='canvas'&&r.id.toLowerCase()===component.name?.toLowerCase()))throw Error('Declared Canvas app is absent from package');
 const sources=inventory.resources.flatMap(resource=>{
  if(resource.connectors.includes('shared_sharepointonline')&&(resource.sharepointBindingsComplete!==true||!resource.sharepointSources?.length))throw Error('SharePoint package resource lacks explicit site/list bindings');
  return(resource.sharepointSources??[]).map(source=>({...source,resource:resource.id}));
 });
 for(const source of sources)if(source.siteUrl!==contract.plan.siteUrl||!contract.bindings.some(b=>b.listId.toLowerCase()===source.listId.toLowerCase()))throw Error('Packaged SharePoint binding differs from the approved target');
 for(const binding of contract.bindings)if(!sources.some(s=>s.listId.toLowerCase()===binding.listId.toLowerCase()))throw Error('Planned SharePoint resource is not referenced by the package');
 return{scope:'sharepoint-package-bindings',packageSha256:inventory.packageSha256,planSha256:sharepointHash(contract.plan),sources,limits:['Package site/list references only; actual Canvas component/play identity, effective access and native runtime QA remain required']};
}
