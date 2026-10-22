import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {schemaBootstrapConfigurationRoot} from './schemaBootstrapRuntime.ts';
import {sharepointHash} from './sharepointProvisioning.ts';
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
function root(){const home=fs.mkdtempSync(path.join(os.tmpdir(),'schema-project-config-'));roots.push(home);return home;}
it('keeps legacy files intact while selecting a separate project configuration',()=>{
 const home=root(),legacy=path.join(home,'write-target-approval.json');fs.writeFileSync(legacy,'retained approval');
 expect(schemaBootstrapConfigurationRoot(home,'owner/new')).toBe(home);
 const selected=path.join(home,'planning','project-configuration',sharepointHash('owner/new'));fs.mkdirSync(selected,{recursive:true});
 expect(schemaBootstrapConfigurationRoot(home,'owner/new')).toBe(selected);expect(schemaBootstrapConfigurationRoot(home,'owner/other')).toBe(home);expect(fs.readFileSync(legacy,'utf8')).toBe('retained approval');
 // An incomplete configured scope stays selected; caller must reject missing
 // approvals instead of silently executing with the legacy project credentials.
 expect(fs.readdirSync(selected)).toEqual([]);
});
it('refuses linked scoped directories and linked ancestors',()=>{
 const home=root(),outside=root(),base=path.join(home,'planning','project-configuration');fs.mkdirSync(base,{recursive:true});
 fs.symlinkSync(outside,path.join(base,sharepointHash('owner/new')),'junction');expect(()=>schemaBootstrapConfigurationRoot(home,'owner/new')).toThrow('Unsafe');
 const second=root();fs.mkdirSync(path.join(second,'planning'));fs.symlinkSync(outside,path.join(second,'planning','project-configuration'),'junction');expect(()=>schemaBootstrapConfigurationRoot(second,'owner/other')).toThrow('Unsafe');
});
