import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

for (const path of ['arquem-relatorios-anexos.gs','central-auditoria-emails-completo.gs']) {
  test('saldo de jornada positivo, negativo e zero nos anexos: '+path,async()=>{
    const code=await readFile(new URL('../apps-script/'+path,import.meta.url),'utf8');
    const context={console,Date};
    vm.createContext(context);
    vm.runInContext(code,context);
    assert.equal(context.arquemSaldo_(73),'+01:13:00');
    assert.equal(context.arquemSaldo_(-23),'-00:23:00');
    assert.equal(context.arquemSaldo_(0),'+00:00:00');
    assert.equal(context.arquemSaldo_(141),'+02:21:00');
    assert.equal(context.arquemSaldo_(-180),'-03:00:00');
    assert.match(code,/\['Colaborador','Setor','Horas','Meta mínima','Jornada','Falta mínimo','Falta jornada','Saldo mínimo','Saldo jornada'\]/);
    assert.match(code,/\['Colaborador','Setor','Horas','Mínimo','Jornada','Falta mínimo','Falta jornada','Saldo mínimo','Saldo jornada','Origem'\]/);
    assert.match(code,/x\.minimumBalance!==undefined\?x\.minimumBalance/);
    assert.match(code,/x\.targetBalance!==undefined\?x\.targetBalance/);
    assert.match(code,/\['Data','Colaborador','Setor','Horas','Jornada ref.','Meta mínima ref.','Saldo mínimo','Saldo jornada'\]/);
    assert.match(code,/\['Data','Colaborador','Setor','Horas','Jornada','Mínimo','Saldo mínimo','Saldo jornada','Situação'\]/);
    assert.match(code,/x\.referenceMinutes\?arquemSaldo_\(/);
  });
}
