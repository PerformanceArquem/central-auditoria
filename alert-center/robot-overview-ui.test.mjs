import test from 'node:test';
import assert from 'node:assert/strict';
import {mountRobotOverviewControls} from './robot-overview-ui.mjs';
class Element {
 constructor(tag,doc){this.tag=tag;this.ownerDocument=doc;this.children=[];this.listeners={};this.value='';}
 append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}
 setAttribute(){}addEventListener(event,fn){this.listeners[event]=fn;}
}
const valid={ok:true,mode:'read-only',source:'overview-read-only',scope:'all',complete:true,deliveryEnabled:false,writeEnabled:false,alerts:[],review:[],tickets:[],recordsRead:0,referenceTime:'2026-11-27T12:00:00Z'};
function screen(request,authorize=async()=>'fixture-token') {
 const doc={createElement:tag=>new Element(tag,doc)},root=new Element('section',doc);let epoch=0;const data=[];
 const ui=mountRobotOverviewControls(root,{request,authorize,beforeRead:()=>{epoch++;data.splice(0);},onData:snapshot=>data.push(snapshot),getEpoch:()=>epoch});
 const button=root.children.find(e=>e.tag==='button'),status=root.children.at(-1);
 return {data,button,status,run:()=>button.listeners.click(),invalidate:()=>{epoch++;ui.invalidate();}};
}
test('overview control performs one read-only authenticated GET and applies only confirmed snapshots',async()=>{
 let calls=0;const ui=screen(async(url,options)=>{calls++;assert.equal(url,'/api/audit?route=robot-overview&scope=all');assert.equal(options.method,'GET');assert.equal(options.body,undefined);assert.equal(options.headers.Authorization,'Bearer fixture-token');assert.equal(options.cache,'no-store');return {ok:true,json:async()=>valid};});
 await ui.run();assert.equal(calls,1);assert.equal(ui.data.length,1);assert.equal(ui.button.disabled,false);
});
test('partial or delivery-enabled snapshots never reach the panel',async()=>{
 for(const patch of [{complete:false},{deliveryEnabled:true},{writeEnabled:true},{scope:'support'},{recordsRead:1001}]) {
  const ui=screen(async()=>({ok:true,json:async()=>({...valid,...patch})}));await ui.run();assert.equal(ui.data.length,0);assert.match(ui.status.textContent,/não validada/);
 }
});
test('session invalidation during JSON parsing prevents stale results from returning',async()=>{
 let release,started;const ready=new Promise(done=>{started=done;}),body=new Promise(done=>{release=done;});
 const ui=screen(async()=>({ok:true,json:()=>{started();return body;}})),pending=ui.run();
 await ready;ui.invalidate();release(valid);await pending;
 assert.equal(ui.data.length,0);assert.equal(ui.status.textContent,'');assert.equal(ui.button.disabled,false);
});
test('no token and unavailable gate fail without displaying a snapshot',async()=>{
 let calls=0;const anonymous=screen(async()=>{calls++;},async()=>null);await anonymous.run();assert.equal(calls,0);assert.equal(anonymous.data.length,0);
 const disabled=screen(async()=>({ok:false,status:503,json:async()=>({error:'PRIVATE PROVIDER BODY'})}));await disabled.run();assert.match(disabled.status.textContent,/não foi habilitada/);assert.doesNotMatch(disabled.status.textContent,/PRIVATE/);
});
