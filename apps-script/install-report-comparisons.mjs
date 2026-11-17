// Patch the installed source in place, preserving authentication and every other feature.
import {readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const [rootArg,helperArg,modulesArg,manifestArg]=process.argv.slice(2);
if(!rootArg||!helperArg||!modulesArg||!manifestArg)throw Error('Expected remote directory, helper file, parser modules and manifest path');
const root=resolve(rootArg),helper=readFileSync(helperArg,'utf8');
const require=createRequire(join(resolve(modulesArg),'package.json')),{parse}=require('acorn');
const sha=s=>createHash('sha256').update(s).digest('hex');
const files=readdirSync(root).filter(p=>p.endsWith('.js'));
const originals=new Map(files.map(name=>[name,readFileSync(join(root,name),'utf8')]));
const catalog=()=>[...originals].flatMap(([file,text])=>parse(text,{ecmaVersion:'latest'}).body.filter(n=>n.type==='FunctionDeclaration'&&n.id).map(node=>({file,text,node,name:node.id.name})));
const definitions=catalog();
for(const name of ['doPost','arquemPdf_','arquemXlsx_','arquemCapacidadesAnexos_'])
 if(definitions.filter(d=>d.name===name).length!==1)throw Error('Expected exactly one installed '+name);
const edits=new Map(),add=(file,at,value)=>edits.set(file,[...(edits.get(file)||[]),{at,value}]);
for(const [name,needle,injection,required] of [
 ['arquemPdf_','doc.saveAndClose();','arquemComparativosPdf_(body,p);\n  ',['doc','body','p']],
 ['arquemXlsx_','SpreadsheetApp.flush();','arquemComparativosXlsx_(ss,p);\n  ',['ss','p']]
]){
 const item=definitions.find(d=>d.name===name),body=item.text.slice(item.node.start,item.node.end);
 if(body.includes(injection.trim().split(';')[0]))continue;
 if(required.some(v=>!new RegExp('\\b'+v+'\\b').test(body))||body.split(needle).length!==2)throw Error('Unexpected structure in '+name);
 add(item.file,item.node.start+body.indexOf(needle),injection);
}
const cap=definitions.find(d=>d.name==='arquemCapacidadesAnexos_');
if(!cap.text.slice(cap.node.start,cap.node.end).includes("comparisonVersion:'sector-comparisons-v1'")){
 const returns=cap.node.body.body.filter(n=>n.type==='ReturnStatement'&&n.argument?.type==='ObjectExpression');
 if(returns.length!==1)throw Error('Capabilities must return one explicit object');
 add(cap.file,returns[0].argument.start+1,"comparisonVersion:'sector-comparisons-v1',");
}
parse(helper,{ecmaVersion:'latest'});
const helperName='arquem-comparativos.gs.js';
if(existsSync(join(root,helperName))&&readFileSync(join(root,helperName),'utf8')!==helper)throw Error('Existing comparison helper differs; review before replacing');
const changed=[];
for(const [file,list] of edits){let source=originals.get(file);for(const edit of list.sort((a,b)=>b.at-a.at))source=source.slice(0,edit.at)+edit.value+source.slice(edit.at);parse(source,{ecmaVersion:'latest'});writeFileSync(join(root,file),source);changed.push(file);}
writeFileSync(join(root,helperName),helper);
const currentPost=definitions.find(d=>d.name==='doPost');
const afterPost=parse(readFileSync(join(root,currentPost.file),'utf8'),{ecmaVersion:'latest'}).body.find(n=>n.type==='FunctionDeclaration'&&n.id?.name==='doPost');
const afterText=readFileSync(join(root,currentPost.file),'utf8').slice(afterPost.start,afterPost.end);
if(afterText!==currentPost.text.slice(currentPost.node.start,currentPost.node.end))throw Error('Authentication/dispatcher changed');
writeFileSync(manifestArg,JSON.stringify({version:'sector-comparisons-v1',changed:[...changed,helperName],written:[...changed,helperName].map(name=>({name,sha256:sha(readFileSync(join(root,name),'utf8'))})),unchanged:[...originals].filter(([name])=>!changed.includes(name)&&name!==helperName).map(([name,text])=>({name,sha256:sha(text)})),dispatcherSha256:sha(afterText)},null,2));
console.log(JSON.stringify({ok:true,version:'sector-comparisons-v1',changed:[...changed,helperName],dispatcherPreserved:true,sent:false}));
