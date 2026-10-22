import path from 'node:path';
import {summarizeSessionEvidence} from '../server/sessionEvidence.ts';

const home=process.argv[2];
if(!home||!path.isAbsolute(home))throw new Error('Pass an explicit absolute SWARM_HOME path; this command only reads evidence');
console.log(JSON.stringify(summarizeSessionEvidence(home),null,2));
