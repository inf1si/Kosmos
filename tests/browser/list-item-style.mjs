// Synthetic workspace only. Run through tsx; Supabase and same-origin endpoints are intercepted.
// Changing the paragraph style of one nested list item takes that line out to the left edge; the items above it keep their level.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {seedWorkspace} from '../../src/lib/seed.ts';
import {workspaceSchema} from '../../src/lib/model.ts';
import {newNote,addNote} from '../../src/lib/personal-notes.ts';
import {chooseOption,selectedValue} from './select.mjs';

const require=createRequire(import.meta.url),playwright=require(process.env.KOSMOS_PLAYWRIGHT_MODULE||'playwright-core');

const engine=process.env.KOSMOS_BROWSER_ENGINE||'chromium',base=process.env.KOSMOS_TEST_BASE_URL||'http://127.0.0.1:3210',output=resolve(process.env.KOSMOS_BROWSER_OUTPUT||`test-results/list-item-style/${engine}`);

await mkdir(output,{recursive:true});

const browser=await playwright[engine].launch(engine==='chromium'?{headless:true,executablePath:process.env.KOSMOS_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']}:{headless:true});

const errors=[],results=[];

let activePage;

const until=async(page,check,label)=>{for(let i=0;i<100;i++){if(await check())return;await page.waitForTimeout(80);}

assert.fail(`Timed out: ${label}`);};

const paragraph=text=>({type:'paragraph',content:[{type:'text',text}]}),item=(text,...rest)=>({type:'listItem',content:[paragraph(text),...rest]}),list=(type,...items)=>({type,content:items});

const task=(text,...rest)=>({type:'taskItem',attrs:{checked:false},content:[paragraph(text),...rest]});

/** Block structure without attributes: 'p:글' for a text block, [type, children] for a container. */
const outline=node=>node.content?.some(child=>child.type==='text')||!node.content?`${node.type==='paragraph'?'p':node.type==='heading'?`h${node.attrs.level}`:node.type}:${(node.content||[]).map(child=>child.text||'').join('')}`:[node.type,node.content.map(outline)];

const nested=(type='bulletList',li=item)=>[paragraph('앞 문단'),list(type,li('가',list(type,li('나1'),li('나2'),li('나3'))),li('다')),paragraph('뒤 문단')];

/** What the document looks like once 나2 has left the lists: 나1 stays under 가, and 나3 follows with 다 as one list. */
const expected=(tag,type='bulletList',itemType='listItem')=>['p:앞 문단',[type,[[itemType,['p:가',[type,[[itemType,['p:나1']]]]]]]],`${tag}:나2`,[type,[[itemType,['p:나3']],[itemType,['p:다']]]],'p:뒤 문단'];

try{
 for(const width of [1280,360]){
  let data=seedWorkspace();const scene=data.works[0].documents.find(doc=>doc.kind==='scene');

  scene.title='합성 원고';scene.content={type:'doc',content:nested()};
  const note={...newNote(),title:'합성 노트',content:{type:'doc',content:nested('taskList',task)}},ordered={...newNote(),title:'번호 노트',content:{type:'doc',content:nested('orderedList')}};data=addNote(addNote(data,note),ordered);workspaceSchema.parse(data);
  let version=1,cloudSeen=false,closing=false;
  const context=await browser.newContext({viewport:{width,height:900}});
  const profile={id:'11111111-1111-4111-8111-111111111111',aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',created_at:'2026-10-25T00:00:00.000Z',app_metadata:{provider:'email',providers:['email']},user_metadata:{},identities:[]};
  const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),token=`${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:profile.id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})}.synthetic-signature`;
  await context.addInitScript(({profile,token})=>{
   localStorage.setItem('kosmos-app-preferences',JSON.stringify({studioStart:'last'}));
   localStorage.setItem('sb-krakjollsufgnwealroh-auth-token',JSON.stringify({access_token:token,refresh_token:'synthetic-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:profile}));
  },{profile,token});
  await context.route('**/auth/v1/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(profile)}));
  await context.route('**/rest/v1/**',async route=>{
   const request=route.request(),path=new URL(request.url()).pathname;cloudSeen=true;let value={};

   if(path.endsWith('/authors'))value={user_id:profile.id};
   else if(path.endsWith('/workspaces'))value={id:data.id,payload:data,version};
   else if(path.endsWith('/save_workspace')){const input=request.postDataJSON();data=workspaceSchema.parse(input.p_payload);version++;value={status:'saved',version};}

   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
  });
  await context.route('**/api/**',route=>route.fulfill({status:200,contentType:'application/json',body:'{"connected":false,"configured":false,"providers":[],"storageAvailable":true}'}));

  if(context.routeWebSocket)await context.routeWebSocket('**/realtime/**',ws=>ws.close());
  const page=await context.newPage();activePage=page;page.setDefaultTimeout(15000);page.on('pageerror',error=>{if(!closing)errors.push(error.message);});
  await page.goto(`${base}/studio`,{waitUntil:'networkidle'});await page.locator('.manuscript[contenteditable=true]').first().waitFor();
  assert.equal(cloudSeen,true,'the synthetic cloud workspace is required');

  const menuItem=name=>page.getByRole('menuitem',{name,exact:true});

  /** Runs every way of changing the paragraph style against one editor. */
  async function check(shell,saved,type='bulletList',itemType='listItem'){
   const body=shell.locator('.manuscript'),line=text=>body.locator('p,h1,h2,h3').filter({hasText:new RegExp(`^${text}$`)}),style=shell.getByRole('combobox',{name:'문단 스타일',exact:true});
   const before=outline({type:'doc',content:nested(type,itemType==='taskItem'?task:item)})[1];
   const now=()=>outline(saved().content)[1].filter((entry,index,all)=>index<all.length-1||entry!=='p:');
   const is=(want,label)=>until(page,async()=>JSON.stringify(now())===JSON.stringify(want),label);
   const left=text=>line(text).evaluate(el=>el.getBoundingClientRect().left),lefts=async()=>({나1:await left('나1'),나3:await left('나3'),다:await left('다')});
   /** On screen: the changed line starts at the left edge of the text, 나1 has not moved, and 나3 is now level with 다. */
   const placed=async()=>{const edge=await left('앞 문단');assert.equal(await left('나2'),edge);assert.deepEqual(await lefts(),{나1:start.나1,나3:start.다,다:start.다});};

   const undo=async()=>{await body.focus();await page.keyboard.press('ControlOrMeta+z');};

   const right=async text=>{const target=line(text);await target.scrollIntoViewIfNeeded();const b=await target.boundingBox();await page.mouse.click(b.x+Math.min(12,b.width/2),b.y+b.height/2,{button:'right'});};

   await line('나2').waitFor();const start=await lefts();

   assert(start.나1>start.다+8,'the inner items start deeper than the outer ones');

   // Toolbar style box: 나2 leaves the lists, 나1 stays where it was, and Ctrl+Z brings every line back.
   for(const [value,tag] of [['2','h2'],['1','h1'],['3','h3']]){
    await line('나2').click();await chooseOption(style,value);await body.locator(tag).filter({hasText:/^나2$/}).waitFor();
    await is(expected(tag,type,itemType),`toolbar ${tag}`);await placed();assert.equal(await selectedValue(style),value);
    await undo();await is(before,`undo toolbar ${tag}`);assert.deepEqual(await lefts(),start);
   }

   // Right-click menu on the same item. 일반 문단 takes it out of the list as a plain paragraph.
   await right('나2');await menuItem('문단 스타일').click();await menuItem('제목 2').click();await is(expected('h2',type,itemType),'menu heading');await placed();
   await undo();await is(before,'undo menu heading');
   await right('나2');await menuItem('문단 스타일').click();await menuItem('일반 문단').click();await is(expected('p',type,itemType),'menu paragraph');await placed();
   // The line is now a plain paragraph outside the list, so the menu no longer offers 일반 문단 for it.
   await right('나2');await menuItem('문단 스타일').click();assert.equal(await menuItem('일반 문단').isDisabled(),true);await page.keyboard.press('Escape');await menuItem('일반 문단').waitFor({state:'detached'});
   await undo();await is(before,'undo menu paragraph');

   // Slash command typed at the end of the item; the query text goes away with the command.
   await line('나2').click();await page.keyboard.press('End');await page.keyboard.insertText('/h2');await page.getByRole('option',{name:'제목 2',exact:true}).waitFor();await page.keyboard.press('Enter');
   await is(expected('h2',type,itemType),'slash heading');await placed();
   await undo();await until(page,async()=>JSON.stringify(now()).includes('"p:나1"]],['+JSON.stringify(itemType)),'undo slash returns the item to its list');
   await until(page,async()=>{if(JSON.stringify(now())===JSON.stringify(before))return true;await undo();

return false;},'undo slash text');

   // The first and the last inner item, and an outer item that has children.
   await line('나1').click();await chooseOption(style,'2');
   await is(['p:앞 문단',[type,[[itemType,['p:가']]]],'h2:나1',[type,[[itemType,['p:나2']],[itemType,['p:나3']],[itemType,['p:다']]]],'p:뒤 문단'],'first inner item');await undo();await is(before,'undo first');
   await line('나3').click();await chooseOption(style,'2');
   await is(['p:앞 문단',[type,[[itemType,['p:가',[type,[[itemType,['p:나1']],[itemType,['p:나2']]]]]]]],'h2:나3',[type,[[itemType,['p:다']]]],'p:뒤 문단'],'last inner item');await undo();await is(before,'undo last');
   await line('가').click();await chooseOption(style,'2');
   await is(['p:앞 문단','h2:가',[type,[[itemType,['p:나1']],[itemType,['p:나2']],[itemType,['p:나3']],[itemType,['p:다']]]],'p:뒤 문단'],'outer item with children');await undo();await is(before,'undo outer');

   // Left in place for the screenshot and the reload check.
   await line('나2').click();await chooseOption(style,'2');await is(expected('h2',type,itemType),'final heading');

   return {body,line,is,placed};
  }

  const studio=page.locator('.editor-panes > .editor-shell'),savedScene=()=>data.works[0].documents.find(doc=>doc.id===scene.id);
  const {body,is,placed}=await check(studio,savedScene);

  await page.screenshot({path:resolve(output,`studio-${width}.png`)});
  await page.reload({waitUntil:'networkidle'});await body.locator('h2').filter({hasText:/^나2$/}).waitFor();await is(expected('h2'),'kept after reload');await placed();

  for(const [id,type,itemType] of [[note.id,'taskList','taskItem'],[ordered.id,'orderedList','listItem']]){
   await page.goto(`${base}/studio#notes/${id}`,{waitUntil:'networkidle'});const notes=page.locator('.notes-workspace .editor-shell');await notes.locator('.manuscript').waitFor();
   await check(notes,()=>data.notes.find(entry=>entry.id===id),type,itemType);
   await page.screenshot({path:resolve(output,`notes-${type}-${width}.png`)});
  }

  results.push({width,cloud:cloudSeen});closing=true;await context.close();
 }

 assert.deepEqual(errors,[]);await writeFile(resolve(output,'results.json'),JSON.stringify({engine,results,errors},null,2));console.log(JSON.stringify({engine,results,errors,output}));
}catch(error){console.log(JSON.stringify({errors}));

if(activePage&&!activePage.isClosed())await activePage.screenshot({path:resolve(output,'failure.png')});throw error;}finally{await browser.close();}
