// Bundles server/ (and the shared/ code it uses) into dist-server/index.js for the npm package.
// Node won't run TypeScript from inside node_modules, so the published server is plain JavaScript.
// Dependencies stay external: npm installs them next to the package.
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'dist-server');

fs.rmSync(out, { recursive: true, force: true });
await build({
  // The terminal keeper (ptyHost) runs as a process of its own, started from the server's folder.
  entryPoints: [path.join(root, 'server', 'index.ts'), path.join(root, 'server', 'ptyHost.ts')],
  outdir: out,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: true,
  logLevel: 'warning',
});
// Loaded by path at runtime: agentRunner.ts hands it to each agent's Playwright browser.
fs.copyFileSync(path.join(root, 'server', 'browser-init.js'), path.join(out, 'browser-init.js'));
fs.copyFileSync(path.join(root,'server','browserProxy.mjs'),path.join(out,'browserProxy.mjs'));
fs.copyFileSync(path.join(root, 'server', 'tenantDlpReader.ps1'), path.join(out, 'tenantDlpReader.ps1'));
fs.copyFileSync(path.join(root, 'server', 'nativeTreeHost.ps1'), path.join(out, 'nativeTreeHost.ps1'));
fs.copyFileSync(path.join(root, 'server', 'nativeTreeBroker.mjs'), path.join(out, 'nativeTreeBroker.mjs'));
// The bounded reader and schema-bootstrap guard read these sources as UTF-8
// data. import.meta.url resolves beside index.js in the bundled server. These
// assets are never executed as TypeScript or exposed as arbitrary reader paths.
for (const file of ['deliveryPermissions.ts','canvasPackagingRecovery.ts','canvasPackaging.ts','canvasPackagingRuntime.ts','createPackagingSolution.py','deliveryRecords.ts','schemaContinuation.ts','sharepointReconciliation.ts','schemaBootstrap.ts','schemaBootstrapRuntime.ts','sharepointProvisioning.ts','sharepointHistory.ts','sharepointSchemaWriter.ts','sharepointRestAuth.ts','sharepointGraph.ts','sharepointResourceApproval.ts','sharepointWriteReadiness.ts','resourceLease.ts','deliveryRecordTools.ts','officeHttp.ts','index.ts']) {
  fs.copyFileSync(path.join(root, 'server', file), path.join(out, file));
}
console.log(`built ${path.relative(root, out)}/index.js`);
fs.copyFileSync(path.join(root,'server','headlessFlowVerification.ts'),path.join(out,'headlessFlowVerification.ts'));

for(const file of ['aiPromptMetadata.ts','privateReportMetadata.ts','repositoryAccessMetadata.ts','platformDiscovery.ts','headlessAcceptedReport.ts'])fs.copyFileSync(path.join(root,'server',file),path.join(out,file));
