import {z} from 'zod';

const logical=z.string().regex(/^[a-z_][a-z0-9_]{0,199}$/);
export const resourceSchemaReference=z.strictObject({resource:z.string().min(1).max(500),logicalName:logical.optional(),entitySet:logical.optional(),columns:z.array(logical).max(100)}).refine(value=>!!value.logicalName!==!!value.entitySet,'Use exactly one table identity');
export type ResourceSchemaReference=z.infer<typeof resourceSchemaReference>;
export interface FlowSchemaReferences {entitySet?:string;columns:string[];unavailable:string[]}

/** Only explicit supported current-environment table parameters. No inference from plural names or expression values. */
export function inspectFlowSchemaReferences(operationId:string,parameters:unknown):FlowSchemaReferences{
  const result:FlowSchemaReferences={columns:[],unavailable:[]};
  const unknown=(reason:string)=>{if(!result.unavailable.includes(reason))result.unavailable.push(reason);};
  if(!['ListRecords','GetItem','CreateRecord','UpdateOnlyRecord','UpdateRecord','DeleteRecord'].includes(operationId)){unknown('Dataverse operation requires a schema-effect adapter');return result;}
  const parsed=z.record(z.string(),z.unknown()).safeParse(parameters);if(!parsed.success){unknown('Dataverse table parameters are unavailable');return result;}
  const fields=parsed.data,table=logical.safeParse(fields.entityName);
  if(table.success)result.entitySet=table.data;else unknown('Dataverse table identity is dynamic or unsupported');
  if(fields.organization!==undefined)unknown('Cross-environment Dataverse operation requires independent target binding');
  const columns=new Set<string>();
  const column=(value:string)=>{const found=logical.safeParse(value);if(found.success)columns.add(found.data);else unknown('Dataverse column or navigation reference requires independent resolution');};
  if(fields.$select!==undefined){
    if(typeof fields.$select!=='string'||!fields.$select.trim())unknown('Dataverse selected columns are dynamic or unavailable');
    else for(const name of fields.$select.split(','))column(name.trim());
  }
  else if(['ListRecords','GetItem'].includes(operationId))unknown('Dataverse read does not declare an explicit selected-column scope');
  for(const [key,value] of Object.entries(fields)){
    if(key.startsWith('item/'))column(key.slice(5));
    if(key==='item'){
      const body=z.record(z.string(),z.unknown()).safeParse(value);if(!body.success)unknown('Dataverse row fields are dynamic or unavailable');else for(const name of Object.keys(body.data))column(name);
    }
  }
  for(const key of ['$filter','$orderby','$expand','fetchXml','filteringattributes','filterexpression'])if(fields[key]!==undefined&&fields[key]!=='')unknown('Dataverse query or trigger schema references require independent resolution');
  if(columns.size>100)unknown('Dataverse explicit column references exceed their bound');
  result.columns=[...columns].sort().slice(0,100);
  return result;
}
