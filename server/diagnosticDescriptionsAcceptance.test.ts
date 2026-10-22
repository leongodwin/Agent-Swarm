import {expect,it} from 'vitest';
import {describeTool,describeOfficeTool,summariseResult,todoLines,resultText,tidyPaths} from './agentRunner.ts';
const cwd='C:\\synthetic\\work';
it('keeps long command, argument and office descriptions bounded without losing execution identity',()=>{
 const long='x'.repeat(10000);
 for(const [tool,input]of [['Bash',{command:long}],['Grep',{pattern:long}],['apply_patch',{command:'*** Add File: '+long}],['mcp__playwright__browser_click',{element:long}],['unknown_tool',{argument:long}]] as const){const description=describeTool(cwd,tool,input);expect(description.length).toBeLessThan(260);expect(description).not.toContain(long);}
 for(const action of ['set_floor_profile','update_job','propose_hire','file_issue','future_action']){const description=describeOfficeTool(action,{floor:3,title:long,summary:long,argument:long});expect(description.length).toBeLessThan(180);expect(description).toContain(action);expect(description).not.toContain(long);}
});
it('distinguishes explicit route clearing from omitted task routing and safely describes missing fields',()=>{
 const unchanged=describeOfficeTool('route_issue',{number:3}),cleared=describeOfficeTool('route_issue',{number:3,specialty:'',depends_on:[]});expect(unchanged).not.toContain('no specialty');expect(unchanged).not.toContain('depends on');expect(cleared).toContain('no specialty');expect(cleared).toContain('depends on nothing');
 for(const tool of ['Bash','Read','Write','Edit','Agent','ToolSearch'])expect(describeTool(cwd,tool,{})).not.toContain('undefined');
});
it('counts file lines and normalizes workspace paths without printing file content as an edit acknowledgment',()=>{
 expect(describeTool('/synthetic/work','Write',{file_path:'/synthetic/work/app.ts'})).toBe('Write app.ts');
 expect(summariseResult(cwd,'Read','one\n\r\n two\n')[0].text).toContain('Read 2 lines');expect(summariseResult(cwd,'Glob','a.ts\n b.ts')[0].text).toContain('Found 2 files');
 for(const tool of ['Edit','MultiEdit','NotebookEdit','Write'])expect(summariseResult(cwd,tool,'private file contents')[0].text).not.toContain('private file contents');
});
it('bounds diagnostic output, respects blank output and strips current directory command prefixes',()=>{expect(summariseResult(cwd,'Bash','\r\n ')).toEqual([{kind:'result',text:'  ⎿ (no output)'}]);const rows=summariseResult(cwd,'Bash',Array.from({length:8},()=> 'x'.repeat(300)).join('\n'));expect(rows).toHaveLength(4);expect(rows[0].text.length).toBeLessThan(180);expect(rows[3].text).toContain('+5 lines');expect(tidyPaths('/synthetic/work','cd "/synthetic/work" && cat /synthetic/work/app.ts')).toBe('cat ./app.ts');});
it('limits task-list summaries and ignores non-text result attachments',()=>{expect(todoLines({todos:'invalid'})).toEqual([]);const rows=todoLines({todos:[{status:'completed',content:'done'},{status:'in_progress',content:'running'},{},...Array.from({length:15},()=>({content:'x'.repeat(200)}))]});expect(rows).toHaveLength(12);expect(rows[0].text).toContain('☒ done');expect(rows[1].text).toContain('◐ running');expect(rows[2].text).toContain('☐');expect(rows[3].text.length).toBeLessThan(160);expect(resultText(null)).toBe('');expect(resultText('raw')).toBe('raw');expect(resultText([{type:'image',data:'never text'},null,{type:'text',text:'Observed'}])).toBe('Observed');});
