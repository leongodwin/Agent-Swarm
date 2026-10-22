import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readBoundedText} from '../server/boundedJson.ts';
import {installWorkerPreflight} from '../server/workerPreflightInstall.ts';
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [checkout,candidate,reviewedSha256,...extra]=process.argv.slice(2);if(!checkout||!candidate||!reviewedSha256||extra.length)throw new Error('Usage: install-worker-preflight <checkout> <reviewed-candidate-file> <reviewed-sha256>');
 const content=await readBoundedText(path.resolve(candidate),32768);if(content===undefined)throw new Error('Reviewed candidate is missing');
 console.log(JSON.stringify(await installWorkerPreflight(checkout,content,reviewedSha256),null,2));
}
