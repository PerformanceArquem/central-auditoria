import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const extension=readFileSync('apps-script/arquem-relatorios-anexos.gs','utf8');
const complete=readFileSync('apps-script/central-auditoria-emails-completo.gs','utf8');

test('pacote completo usa o gerador Zenvia Voz x Chat da extensão',()=>{
  const signature='function arquemVozChatDados_(raw)';
  assert.ok(extension.includes(signature));
  assert.ok(complete.includes(signature));
  const extensionGenerator=extension.slice(extension.indexOf(signature));
  const completeGenerator=complete.slice(complete.indexOf(signature));
  assert.equal(completeGenerator,extensionGenerator,'Geradores divergem após arquemVozChatDados_');
});

test('envio do pacote completo exige homologação real de Voz x Chat',()=>{
  assert.match(complete,/reportData\.zenviaVoice\s*&&\s*arquemCapacidadesAnexos_\(\)\.zenviaVoiceReady\s*!==\s*true/);
  assert.match(complete,/function arquemHomologarVozChatSemEnvio\(/);
  assert.match(complete,/ARQUEM_ZENVIA_VOICE_VALIDATED_VERSION/);
  assert.match(complete,/MailApp\.sendEmail\(/);
});
