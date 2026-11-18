import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const reconciler=read('apps-script/ci-clasp-reconcile-dry-run.mjs');
const attachments=read('apps-script/ci-clasp-safe-overlays.mjs');
const voice=read('apps-script/ci-clasp-dopost-voice-guard-dryrun.mjs');
const workflow=read('.github/workflows/appsscript-clasp-controlled.yml');

test('reviewed AST inventory 9:49 is explicitly allowlisted, not arbitrary counts',()=>{
 assert.match(reconciler,/new Set\(\['6:39', '8:48', '9:49'\]\)/);
 assert.match(attachments,/new Set\(\['6:39','8:48','9:49'\]\)/);
 assert.match(voice,/new Set\(\['6:39','8:48','9:49'\]\)/);
 for(const source of [reconciler,attachments,voice])
  assert.match(source,/homologacao-pr103-isolada\.js/);
 assert.match(reconciler,/lostNames\.length\|\|newNames\.length/);
 assert.match(reconciler,/Duplicate remains in test candidate/);
 assert.match(attachments,/Candidate has duplicate global function/);
 assert.match(voice,/Duplicate global:/);
});
test('the no-email and original doPost guards survive all inventory changes',()=>{
 assert.match(reconciler,/manifesto|Manifesto/i);
 assert.match(attachments,/Production doPost modified/);
 assert.match(voice,/Official doPost not preserved exactly/);
 assert.match(workflow,/ci-clasp-no-email-dryrun-guard\.mjs/);
 assert.match(workflow,/ci-clasp-dopost-contract\.mjs/);
 assert.match(workflow,/ci-clasp-voice-guard-order\.mjs/);
 assert.match(workflow,/test "\$RELEASE_ENABLED" = 'true'/);
 assert.match(workflow,/EXPECTED_REMOTE/);
 assert.match(workflow,/APPROVED_SOURCE/);
});
test('release remains manual, gated and does not update /exec automatically',()=>{
 assert.match(workflow,/inputs\.operation == 'publish'/);
 assert.match(workflow,/environment: apps-script-production/);
 assert.match(workflow,/Existing \/exec deployment NOT updated/);
 assert.doesNotMatch(workflow,/clasp deploy\s+--deploymentId/);
});
