export interface PackagedConstraints {values:Record<string,unknown>;unavailable:string[]}
/** Extract explicit source facts only. Length is a storage-byte field, not MaxLength.
 * Ambiguous/defaulted encodings never acquire inferred constraint values. */
export function packagedColumnConstraints(attribute:Record<string,any>):PackagedConstraints{
  const values:Record<string,unknown>={},access:Record<string,unknown>={},unavailable:string[]=[];
  const type=typeof attribute.Type==='string'?attribute.Type.toLowerCase():'';
  const applicable:Record<string,string[]>={MaxLength:['nvarchar','ntext'],MinValue:['int','decimal','money'],MaxValue:['int','decimal','money'],Accuracy:['decimal','money'],MaxSizeInKB:['file'],optionset:['picklist']};
  for(const [field,types] of Object.entries(applicable))if(attribute[field]!==undefined&&!types.includes(type))unavailable.push(`Source ${field} is unsupported for this column type`);
  const numeric=(source:string,target:string,valid:(value:number)=>boolean)=>{
    if(attribute[source]===undefined)return;
    const raw=attribute[source];
    if(typeof raw!=='string'||! /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)||!Number.isFinite(Number(raw))||!valid(Number(raw))){unavailable.push(`Invalid source ${source}`);return;}
    values[target]=Number(raw);
  };
  if(['nvarchar','ntext'].includes(type))numeric('MaxLength','maxLength',n=>Number.isSafeInteger(n)&&n>0);
  if(['int','decimal','money'].includes(type)){
    const valid=(n:number)=>type!=='int'||Number.isInteger(n)&&n>=-2147483648&&n<=2147483647;
    numeric('MinValue','minValue',valid);numeric('MaxValue','maxValue',valid);
    if(typeof values.minValue==='number'&&typeof values.maxValue==='number'&&values.minValue>values.maxValue)unavailable.push('Reversed source numeric bounds');
  }
  if(['decimal','money'].includes(type))numeric('Accuracy','precision',n=>Number.isInteger(n)&&n>=0&&n<=10);
  if(type==='file')numeric('MaxSizeInKB','maxSizeInKB',n=>Number.isSafeInteger(n)&&n>0);
  for(const [source,target] of Object.entries({ValidForCreateApi:'create',ValidForReadApi:'read',ValidForUpdateApi:'update',IsSecured:'secured',IsLogical:'logical'})){
    if(attribute[source]===undefined)continue;
    if(!['0','1'].includes(attribute[source]))unavailable.push(`Invalid source ${source}`);else access[target]=attribute[source]==='1';
  }
  if(attribute.SourceType!==undefined){if(!['0','1','2'].includes(attribute.SourceType))unavailable.push('Invalid source SourceType');else access.sourceType=Number(attribute.SourceType);}
  if(Object.keys(access).length)values.access=access;
  if(type==='picklist'&&attribute.optionset!==undefined){
    const options=attribute.optionset?.options?.option;
    if(options===undefined||options===''||Array.isArray(attribute.optionset)){unavailable.push('Choice values are unavailable in the source export');}
    else{
      const rows=Array.isArray(options)?options:[options];const numbers=rows.map(row=>row?.['@_value']);
      if(rows.length>10000||numbers.some(value=>typeof value!=='string'||! /^-?\d+$/.test(value)||!Number.isInteger(Number(value))||Number(value)<-2147483648||Number(value)>2147483647)||new Set(numbers.map(Number)).size!==numbers.length)unavailable.push('Invalid or ambiguous source choice values');
      else values.options=numbers.map(Number);
    }
  }
  // XML formats/lookup type codes require their own validated translation and
  // global choice/default semantics cannot be established by this extractor.
  if(attribute.Format!==undefined)unavailable.push('Source format requires validated translation');
  for(const field of ['DateTimeBehavior','PrecisionSource','AccuracySource'])if(attribute[field]!==undefined)unavailable.push(`Source ${field} requires validated translation`);
  if(attribute.LookupTypes!==undefined&&attribute.LookupTypes!=='')unavailable.push('Source lookup encodings require independent endpoint validation');
  return {values,unavailable};
}

export function comparePackagedConstraints(observed:PackagedConstraints,expected:Record<string,unknown>|undefined):{status:'matched'|'blocked'|'unavailable';reason:string}{
  const approved=expected??{};
  for(const [key,value] of Object.entries(observed.values)){
    if(key==='access'){
      const access=approved.access as Record<string,unknown>|undefined;
      if(!access||typeof access!=='object'||Object.entries(value as Record<string,unknown>).some(([field,actual])=>access[field]!==actual))return {status:'blocked',reason:'Packaged access flags lack an exact approved declaration'};
    }else if(Array.isArray(value)){
      const declared=approved[key];
      if(!Array.isArray(declared)||declared.length!==value.length||declared.slice().map(String).sort().join('\n')!==value.slice().map(String).sort().join('\n'))return {status:'blocked',reason:'Packaged constraint values lack an exact approved declaration'};
    }else if(approved[key]!==value)return {status:'blocked',reason:'Packaged constraint lacks an exact approved declaration'};
  }
  const missing=Object.keys(approved).some(key=>!(key in observed.values)||(key==='access'&&Object.keys(approved.access as object).some(field=>!(field in (observed.values.access as object)))));
  if(observed.unavailable.length||missing)return {status:'unavailable',reason:'Source constraints are incomplete or require validated translation'};
  return {status:'matched',reason:'Supported explicit source constraints match declarations'};
}
