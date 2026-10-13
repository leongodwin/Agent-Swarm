import {z} from 'zod';
import type {Request} from './targetOperations.ts';

const logical=z.string().regex(/^[a-z_][a-z0-9_]*$/);
export const columnContract=z.object({name:logical,type:z.enum(['String','Memo','Integer','Decimal','Money','DateTime','Boolean','Lookup','Picklist','Uniqueidentifier','File']),required:z.enum(['None','Recommended','ApplicationRequired','SystemRequired']),
  constraints:z.object({maxLength:z.number().int().positive().optional(),minValue:z.number().finite().optional(),maxValue:z.number().finite().optional(),precision:z.number().int().min(0).max(10).optional(),precisionSource:z.number().int().min(0).max(2).optional(),
    format:z.string().min(1).max(100).optional(),dateTimeBehavior:z.enum(['UserLocal','DateOnly','TimeZoneIndependent']).optional(),targets:z.array(logical).min(1).max(50).optional(),options:z.array(z.number().int().min(-2147483648).max(2147483647)).min(1).max(10000).optional(),maxSizeInKB:z.number().int().positive().optional(),
    access:z.object({create:z.boolean(),read:z.boolean(),update:z.boolean(),secured:z.boolean(),logical:z.boolean().optional(),sourceType:z.number().int().min(0).max(2).optional()}).strict().optional(),
  }).strict().optional(),
}).strict().superRefine((column,ctx)=>{
  const allowed:Record<string,string[]>={String:['maxLength','format'],Memo:['maxLength','format'],Integer:['minValue','maxValue','format'],Decimal:['minValue','maxValue','precision'],Money:['minValue','maxValue','precision','precisionSource'],DateTime:['format','dateTimeBehavior'],Lookup:['targets'],Picklist:['options'],File:['maxSizeInKB'],Boolean:[],Uniqueidentifier:[]};
  for(const key of Object.keys(column.constraints??{}))if(key!=='access'&&!allowed[column.type].includes(key))ctx.addIssue({code:'custom',message:`Constraint ${key} is invalid for ${column.type}`});
  const c=column.constraints;if(c?.minValue!==undefined&&c.maxValue!==undefined&&c.minValue>c.maxValue)ctx.addIssue({code:'custom',message:'Column numeric bounds are reversed'});
  for(const values of [c?.targets,c?.options])if(values&&new Set<string|number>(values).size!==values.length)ctx.addIssue({code:'custom',message:'Constraint values must be unique'});
});
export type ColumnContract=z.infer<typeof columnContract>;
export const baseAttribute=z.object({LogicalName:logical,AttributeType:z.string(),AttributeTypeName:z.object({Value:z.string()}).optional(),RequiredLevel:z.object({Value:z.string()}),MetadataId:z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i).optional()}).passthrough();
export const attributeType=(value:z.infer<typeof baseAttribute>)=>value.AttributeTypeName?.Value==='FileType'?'File':value.AttributeType;
const set=(values:unknown)=>z.array(z.union([z.string(),z.number()])).parse(values).map(String).sort().join('\n');
const common='LogicalName,MetadataId,AttributeType,AttributeTypeName,RequiredLevel,IsValidForCreate,IsValidForRead,IsValidForUpdate,IsSecured,IsLogical,SourceType';
const fields:Record<string,string>={String:'MaxLength,Format',Memo:'MaxLength,Format',Integer:'MinValue,MaxValue,Format',Decimal:'MinValue,MaxValue,Precision',Money:'MinValue,MaxValue,Precision,PrecisionSource',DateTime:'Format,DateTimeBehavior',Lookup:'Targets',Picklist:'',File:'MaxSizeInKB',Boolean:'',Uniqueidentifier:''};

/** Compare declared constraints only. This does not prove complete table/relationship
 * coverage or the current user's effective security-role access. */
export function compareColumn(column:ColumnContract,input:unknown,migration=false) {
  column=columnContract.parse(column);
  const actual=baseAttribute.parse(input),c=column.constraints;
  if(actual.LogicalName!==column.name||attributeType(actual)!==column.type||actual.RequiredLevel.Value!==column.required)throw new Error(`Schema mismatch for ${column.name}`);
  if(!c)return;
  const numeric=(key:keyof typeof c,property:string,direction?:'upper'|'lower')=>{
    const expected=c[key];if(expected===undefined)return;const observed=z.number().finite().parse(actual[property]);
    if(migration&&direction?(direction==='upper'?Number(expected)<observed:Number(expected)>observed):expected!==observed)throw new Error(`Schema ${property} differs for ${column.name}`);
  };
  numeric('maxLength','MaxLength','upper');numeric('minValue','MinValue','lower');numeric('maxValue','MaxValue','upper');numeric('precision','Precision','upper');numeric('precisionSource','PrecisionSource');numeric('maxSizeInKB','MaxSizeInKB','upper');
  if(c.format!==undefined&&z.string().parse(actual.Format)!==c.format)throw new Error(`Schema Format differs for ${column.name}`);
  if(c.dateTimeBehavior!==undefined&&z.object({Value:z.string()}).parse(actual.DateTimeBehavior).Value!==c.dateTimeBehavior)throw new Error(`Schema DateTimeBehavior differs for ${column.name}`);
  if(c.targets&&set(z.array(logical).parse(actual.Targets))!==set(c.targets))throw new Error(`Lookup targets differ for ${column.name}`);
  if(c.options){const options=z.object({Options:z.array(z.object({Value:z.number().int()})).max(10000),'Options@odata.nextLink':z.never().optional()}).parse(actual.OptionSet);const observed=options.Options.map(option=>option.Value);if(new Set(observed).size!==observed.length|| (migration?observed.some(value=>!c.options!.includes(value)):set(observed)!==set(c.options)))throw new Error(`Choice values differ for ${column.name}`);}
  if(c.access){for(const [key,property] of Object.entries({create:'IsValidForCreate',read:'IsValidForRead',update:'IsValidForUpdate',secured:'IsSecured',logical:'IsLogical',sourceType:'SourceType'})){const expected=c.access[key as keyof typeof c.access];if(expected!==undefined){const observed=key==='sourceType'?z.number().int().parse(actual[property]):z.boolean().parse(actual[property]);if(expected!==observed)throw new Error(`Schema ${property} differs for ${column.name}`);}}}
}
export async function verifyColumns(columns:ColumnContract[],table:string,attributes:unknown[],request:Request,migration=false) {
  logical.parse(table);
  columns=z.array(columnContract).min(1).max(100).parse(columns);
  if(new Set(columns.map(column=>column.name)).size!==columns.length)throw new Error('Duplicate declared columns');
  const rows=attributes.map(value=>baseAttribute.parse(value));if(rows.length>=5000||new Set(rows.map(row=>row.LogicalName)).size!==rows.length)throw new Error('Schema inventory is truncated or ambiguous');
  const metadataIds=rows.flatMap(row=>row.MetadataId?[row.MetadataId.toLowerCase()]:[]);
  if(new Set(metadataIds).size!==metadataIds.length)throw new Error('Schema metadata IDs are ambiguous');
  for(const column of columns) {
    const current=rows.find(row=>row.LogicalName===column.name);if(!current){if(migration)continue;throw new Error(`Missing declared column ${column.name}`);}
    compareColumn({...column,constraints:undefined},current,migration);
    if(column.constraints&&Object.keys(column.constraints).length){
      if(!current.MetadataId)throw new Error('Typed schema lookup requires a metadata ID');
      const suffix=column.type==='Uniqueidentifier'?'UniqueIdentifier':column.type;
      const cast=`Microsoft.Dynamics.CRM.${suffix}AttributeMetadata`;
      const select=common+(fields[column.type]?','+fields[column.type]:'');
      const detailed=baseAttribute.parse(await request('GET',`EntityDefinitions(LogicalName='${table}')/Attributes(${current.MetadataId})/${cast}?$select=${select}${column.constraints.options?'&$expand=OptionSet':''}`));
      if(detailed.MetadataId?.toLowerCase()!==current.MetadataId.toLowerCase())throw new Error('Typed schema response changed identity');
      compareColumn(column,detailed,migration);
    }
  }
}
