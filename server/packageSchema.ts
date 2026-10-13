import type {PackageInventory} from './packageInventory.ts';
import type {TargetAction,TargetComponent} from './targetOperations.ts';

type Result={status:'matched'|'blocked'|'unavailable';reasons:string[]};
const types:Record<string,string>={nvarchar:'String',ntext:'Memo',int:'Integer',decimal:'Decimal',money:'Money',datetime:'DateTime',bit:'Boolean',lookup:'Lookup',picklist:'Picklist',uniqueidentifier:'Uniqueidentifier',primarykey:'Uniqueidentifier',file:'File'};
const required:Record<string,string>={none:'None',recommended:'Recommended',required:'ApplicationRequired',systemrequired:'SystemRequired',applicationrequired:'ApplicationRequired'};
const sameSet=(a:string[],b:string[])=>a.slice().sort().join('\n')===b.slice().sort().join('\n');

/** Independently packaged facts may reject declarations. Matching this bounded subset
 * does not certify complete source/target schemas or authorize execution. */
export function comparePackageSchema(inventory:PackageInventory,manifest:{targetComponents:TargetComponent[];postDeployActions:TargetAction[]}):Result{
  if(!inventory.archiveComplete)return {status:'unavailable',reasons:['Independent package integrity is incomplete']};
  const pending:string[]=[];
  const actions=manifest.postDeployActions.filter(action=>action.type==='schema-check');
  for(const table of inventory.tables){
    const components=manifest.targetComponents.filter(component=>component.kind==='dataverse-table'&&component.logicalName.toLowerCase()===table.name);
    const contracts=actions.filter(action=>components.some(component=>component.key===action.component));
    if(components.length!==1||contracts.length!==1)return {status:'blocked',reasons:[`Package table ${table.name} lacks one exact approved schema contract`]};
    const action=contracts[0];
    if(table.partial)pending.push(`Table ${table.name} is a partial source export`);
    for(const attribute of table.attributes){
      const type=types[attribute.type.toLowerCase()],level=required[attribute.required.toLowerCase()];
      if(!type||!level){pending.push(`Package column ${table.name}.${attribute.name} has unsupported source semantics`);continue;}
      const expected=action.columns.find(column=>column.name===attribute.name);
      if(!expected)return {status:'blocked',reasons:[`Package column ${table.name}.${attribute.name} lacks an approved declaration`]};
      if(expected.type!==type||expected.required!==level)return {status:'blocked',reasons:[`Package column ${table.name}.${attribute.name} differs from its approved type/required level`]};
    }
    for(const key of table.keys){
      const expected=action.structure?.keys?.find(row=>row.schemaName.toLowerCase()===key.schemaName.toLowerCase());
      if(!expected||!sameSet(expected.attributes,key.attributes))return {status:'blocked',reasons:[`Package alternate key ${table.name}.${key.schemaName} lacks its exact approved column declaration`]};
    }
  }
  for(const relation of inventory.relationships){
    if(!relation.complete){pending.push(`Package relationship ${relation.schemaName} has unsupported source semantics`);continue;}
    const declared=actions.flatMap(action=>{
      const table=manifest.targetComponents.find(component=>component.key===action.component&&component.kind==='dataverse-table')?.logicalName.toLowerCase();
      const belongs=relation.kind==='one-to-many'?table===relation.referencedEntity||table===relation.referencingEntity:table===relation.entity1||table===relation.entity2;
      return belongs?action.structure?.relationships??[]:[];
    }).filter(row=>row.schemaName.toLowerCase()===relation.schemaName.toLowerCase());
    if(!declared.length)return {status:'blocked',reasons:[`Package relationship ${relation.schemaName} lacks an approved declaration`]};
    for(const expected of declared){
      const matches=expected.kind===relation.kind&&(expected.kind==='one-to-many'?expected.referencedEntity===relation.referencedEntity&&expected.referencingEntity===relation.referencingEntity&&expected.referencingAttribute===relation.referencingAttribute&&Object.entries(relation.cascade).every(([key,value])=>expected.cascade[key as keyof typeof expected.cascade]===value):expected.entity1===relation.entity1&&expected.entity2===relation.entity2&&expected.intersectEntity===relation.intersectEntity);
      if(!matches)return {status:'blocked',reasons:[`Package relationship ${relation.schemaName} differs from its approved endpoints/cascade declaration`]};
    }
  }
  return pending.length?{status:'unavailable',reasons:[...new Set(pending)].slice(0,20)}:{status:'matched',reasons:['Supported packaged column, key and relationship facts match declarations; constraints, navigation/hierarchy, complete target schemas and effective security remain unverified']};
}
