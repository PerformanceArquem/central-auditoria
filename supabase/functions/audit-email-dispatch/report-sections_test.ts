import {reportSectionOn,reportSectionFlags,REPORT_SECTION_KEYS} from './report-sections.ts';

function check(condition:boolean, message:string) {
  if(!condition) throw new Error(message);
}

Deno.test('legacy recipient preserves all sections', () => {
  for(const value of [undefined, null]) {
    const flags=reportSectionFlags({report_sections:value});
    check(Object.values(flags).every(Boolean),'Legacy recipient must retain all sections');
  }
});

Deno.test('all eight combinations apply to all three sections', () => {
  for(let mask=0; mask<8; mask++) {
    const selected=Object.fromEntries(REPORT_SECTION_KEYS.map((key,index)=>[key,Boolean(mask&(1<<index))]));
    const recipient={report_sections:selected};
    for(const key of REPORT_SECTION_KEYS) {
      check(reportSectionOn(recipient,key)===selected[key],mask+': '+key);
      check(reportSectionFlags(recipient)[key]===selected[key],'flags '+mask+': '+key);
    }
  }
});

Deno.test('missing keys remain enabled and explicitly false is denied', () => {
  const rec={report_sections:{customers:false}};
  check(!reportSectionOn(rec,'customers'),'Customers must be blocked');
  check(reportSectionOn(rec,'daily_detail'),'Missing daily_detail must be allowed');
  check(reportSectionOn(rec,'activities'),'Missing activities must be allowed');
});

Deno.test('malformed legacy values cannot silently revoke other sections', () => {
  for(const value of [false,0,'',[],42]) {
    check(Object.values(reportSectionFlags({report_sections:value})).every(Boolean),'Legacy fallback '+value);
  }
});
