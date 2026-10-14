import type {AgentCli,EffortLevel} from './types.ts';
export const CODEX_REASONING_EFFORT={low:'low',medium:'medium',high:'high',xhigh:'xhigh',max:'xhigh'} as const satisfies Record<EffortLevel,string>;

export const ALLOWED_RUNTIMES = ['codex','gemini','opencode'] as const;
export const DEFAULT_RUNTIME = 'codex' as const;
export function allowedRuntime(value:unknown):value is typeof ALLOWED_RUNTIMES[number] {
  return ALLOWED_RUNTIMES.some(runtime=>runtime===value);
}
/** OpenCode must pin an approved provider/model instead of inheriting an arbitrary default. */
export function runtimeModelError(cli:AgentCli,model:string):string|null {
  if(!allowedRuntime(cli))return 'Only Codex, Gemini and OpenCode are permitted';
  const normalized=model.trim();
  if(/claude|anthropic|(?:^|\/)opus|(?:^|\/)sonnet|(?:^|\/)haiku/i.test(normalized))return 'Claude models and providers are not permitted';
  if(cli==='opencode'&&!/^(?:openai\/gpt-|google\/gemini-)/i.test(normalized))return 'OpenCode requires an explicit openai/gpt-* or google/gemini-* model';
  return null;
}
