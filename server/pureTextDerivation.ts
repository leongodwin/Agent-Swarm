/** Cache one pure text calculation only. Callers still read and validate every
 * current file/authority input. Errors and mutable objects are never cached. */
export function memoizeTextDerivation(derive:(text:string)=>string){
 let previous:string|undefined,output:string|undefined;
 return(text:string)=>{
  if(text===previous&&output!==undefined)return output;
  const value=derive(text);previous=text;output=value;return value;
 };
}
