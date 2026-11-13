import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import './appsscript-zenvia-export-validation.test.mjs';

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


test('Voz e Chat exige duas etapas e revisão visual antes de anunciar capacidade',()=>{
  for(const source of [extension,complete]){
    assert.match(source,/function arquemHomologarVozChatSemEnvio\(/);
    assert.match(source,/function arquemAprovarHomologacaoVozChatSemEnvio\(/);
    assert.match(source,/ARQUEM_ZENVIA_VOICE_VISUAL_APPROVED:'false'/);
    assert.match(source,/ARQUEM_ZENVIA_VOICE_VISUAL_APPROVED:'true'/);
    assert.match(source,/getProperty\('ARQUEM_ZENVIA_VOICE_VISUAL_APPROVED'\)==='true'/);
    const staging=source.slice(source.indexOf('function arquemHomologarVozChatSemEnvio()'),
      source.indexOf('function arquemAprovarHomologacaoVozChatSemEnvio()'));
    assert.doesNotMatch(staging,/ARQUEM_ZENVIA_VOICE_VALIDATED_AT:/,
      'A geração de amostras não deve habilitar a integração');
    assert.match(staging,/DriveApp\.createFile\(/);
    assert.match(staging,/pendingVisualReview:true/);
  }
});
