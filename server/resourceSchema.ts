import {z} from 'zod';
import {resourceSchemaReference,type ResourceSchemaReference} from './flowSchemaReferences.ts';
import type {TargetAction,TargetComponent,Request} from './targetOperations.ts';
import {dataverseGuid} from './targetOperations.ts';

/** Resolve explicit resource references through metadata. Never guess a logical name by singularizing an entity set. */
export async function verifyResourceSchemaReferences(input:ResourceSchemaReference[],tables:TargetComponent[],actions:TargetAction[],request:Request){
  const refs=z.array(resourceSchemaReference).max(300).parse(input),resolved=new Map<string,string>();
  for(const reference of refs){
    let logicalName=reference.logicalName;
    if(reference.entitySet){
      if(!resolved.has(reference.entitySet)){
        const value=z.object({value:z.array(z.object({LogicalName:z.string().regex(/^[a-z_][a-z0-9_]*$/),EntitySetName:z.string(),MetadataId:dataverseGuid})).length(1),'@odata.nextLink':z.never().optional()}).parse(await request('GET',`EntityDefinitions?$select=LogicalName,EntitySetName,MetadataId&$filter=${encodeURIComponent(`EntitySetName eq '${reference.entitySet}'`)}`)).value[0];
        if(value.EntitySetName!==reference.entitySet)throw new Error('Resource table metadata differs from the referenced entity set');
        resolved.set(reference.entitySet,value.LogicalName);
      }
      logicalName=resolved.get(reference.entitySet)!;
    }
    const components=tables.filter(table=>table.kind==='dataverse-table'&&table.logicalName.toLowerCase()===logicalName);
    if(components.length!==1)throw new Error('A resource references a table without one exact approved schema contract');
    const contracts=actions.filter((action):action is Extract<TargetAction,{type:'schema-check'}>=>action.type==='schema-check'&&action.component===components[0].key);
    if(contracts.length!==1||reference.columns.some(column=>!contracts[0].columns.some(expected=>expected.name===column)))throw new Error('Resource column references are outside the approved schema contract');
  }
}
