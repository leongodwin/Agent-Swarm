import { execFile } from 'node:child_process';
import {parseUnambiguousJson} from './unambiguousJson.ts';

export class CommandError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
    public readonly code: number | string | null,
    public readonly observation:{kind:'exit'|'spawn'|'terminated'|'output-limit'|'encoding';signal:NodeJS.Signals|null;killed:boolean}={kind:'exit',signal:null,killed:false},
  ) {
    super(message);
  }
}

/** Run a CLI (gh, git) without a shell and return trimmed stdout. */
export function run(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number; input?: string } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      cmd,
      args,
      {
        cwd: opts.cwd,
        timeout: opts.timeoutMs ?? 120_000,
        maxBuffer: 32 * 1024 * 1024,
        encoding:'buffer',
        windowsHide: true,
        env: { ...process.env, GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0', NO_COLOR: '1' },
      },
      (err, stdout, stderr) => {
        const code=err?.code??null,signal=err?.signal??null,killed=err?.killed===true;
        let output:string,diagnostic:string;
        try{if(!Buffer.isBuffer(stdout)||!Buffer.isBuffer(stderr))throw new Error('Unverified output bytes');output=new TextDecoder('utf-8',{fatal:true}).decode(stdout);diagnostic=new TextDecoder('utf-8',{fatal:true}).decode(stderr);}
        catch{reject(new CommandError('Native command output encoding could not be verified; metadata is unavailable','',code,{kind:'encoding',signal,killed}));return;}
        if (err) {
          const detail = diagnostic.trim()||err.message;
          const kind=code==='ERR_CHILD_PROCESS_STDIO_MAXBUFFER'?'output-limit':signal||killed?'terminated':typeof code==='string'?'spawn':'exit';
          reject(new CommandError(`${cmd} ${args.slice(0, 3).join(' ')} failed: ${detail}`,diagnostic,code,{kind,signal,killed}));
          return;
        }
        resolve(output.trim());
      },
    );
    if (opts.input !== undefined) {
      child.stdin?.end(opts.input);
    }
  });
}

export const gh = (args: string[], opts?: { cwd?: string; timeoutMs?: number; input?: string }) => run('gh', args, opts);
export const git = (args: string[], opts?: { cwd?: string; timeoutMs?: number }) => run('git', args, opts);

export async function ghJson<T>(args: string[], opts?: { cwd?: string; timeoutMs?: number }): Promise<T> {
  const out = await gh(args, opts);
  return (out ? parseUnambiguousJson(out) : null) as T;
}
