import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import {z} from 'zod';
import {HOME_DIR} from './config.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';

const require = createRequire(import.meta.url);
const accessSchema=z.union([z.strictObject({schemaVersion:z.literal(1),mode:z.literal('coordinator-handoff')}),z.strictObject({schemaVersion:z.literal(1),mode:z.literal('extension-shared'),endpoint:z.string().refine(value=>{try{const u=new URL(value);return u.protocol==='http:'&&u.hostname==='127.0.0.1'&&!!u.port&&u.pathname==='/mcp'&&!u.search&&!u.hash&&!u.username&&!u.password&&u.href===value;}catch{return false;}})})]);
/** Installed and pinned with the office, so each agent avoids an npx download/startup race. */
function browserAccess(accessFile=path.join(HOME_DIR,'tools','browser','access.json')) {
  let stat:fs.Stats|undefined;try{stat=fs.lstatSync(accessFile);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(stat){
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>4096||fs.realpathSync(accessFile)!==path.resolve(accessFile))throw Error('Browser access configuration must be a bounded unlinked file');
    const config=accessSchema.parse(parseUnambiguousJson(fs.readFileSync(accessFile,'utf8'),{maxBytes:4096}));
    return config;
  }
  return null;
}
export function coordinatorBrowserEnabled(accessFile?:string){return browserAccess(accessFile)?.mode==='coordinator-handoff';}
export function browserBridgeEndpoint(accessFile?:string):string|null {const config=browserAccess(accessFile);if(config?.mode==='coordinator-handoff')throw Error('Browser uses coordinator handoff; request delivery_record browser_handoff instead of Playwright');return config?.endpoint??null;}
export function playwrightMcp(outputDir?: string,accessFile?:string) {
  const endpoint=browserBridgeEndpoint(accessFile);
  if(endpoint)return {command:process.execPath,args:[path.join(import.meta.dirname,'browserProxy.mjs'),endpoint]};
  const cli = path.join(path.dirname(require.resolve('@playwright/mcp/package.json')), 'cli.js');
  return { command: process.execPath, args: [cli, '--headless', '--isolated',
    ...(outputDir ? ['--output-dir', outputDir] : []), '--init-script', path.join(import.meta.dirname, 'browser-init.js')] };
}
