import { generateHldContent, type HldInput, type HldResult } from '../shared/hld.ts';
import {saveHldArtifact} from './hldArtifacts.ts';
export * from '../shared/hld.ts';

/** Only server-resolved checkout paths may reach this function. */
export async function generateHld(input: HldInput,guard:()=>void=()=>{},repoId?:string): Promise<HldResult> {
  const result = generateHldContent(input);
  if (!input.repoPath) return result;
  return saveHldArtifact(input.repoPath,input,result,guard,repoId);
}
