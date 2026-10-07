// Run through tsx; see docs/personal-notes.md for browser/module configuration.
import assert from 'node:assert/strict';
import { trashNote } from '../../src/lib/workspace-trash.ts';
import { TRASH_SAVE_REJECTED } from '../../src/lib/sync-recovery.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { seedWorkspace } from '../../src/lib/seed.ts';
import { fromText, uid, workspaceSchema } from '../../src/lib/model.ts';
import { addNote, newNote } from '../../src/lib/personal-notes.ts';

const require = createRequire(import.meta.url);

const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');

const base = process.env.KOSMOS_TEST_BASE_URL || 'http://127.0.0.1:3210';

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/sync-recovery');

await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

// Older checks start in the editor; the studio home has its own check (studio-home.mjs).
await context.addInitScript(() => { try { const key = 'kosmos-app-preferences', value = JSON.parse(localStorage.getItem(key) || '{}');

 if (!('studioStart' in value)) localStorage.setItem(key, JSON.stringify({ ...value, studioStart: 'last' })); } catch { /* Storage blocked: the test sees the home and fails loudly. */ } });

const note=newNote();

const data=addNote(seedWorkspace(),note);

data.works[0].documents[0].content=fromText('\n\n기기 원문.');

const profile = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'synthetic@example.invalid', created_at: '2026-10-04T00:00:00.000Z', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [] };

const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');

const token = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub: profile.id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })}.synthetic-signature`;

await context.addInitScript(({ profile, token, key }) => localStorage.setItem(key, JSON.stringify({ access_token: token, refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: profile })), { profile, token, key: process.env.KOSMOS_TEST_AUTH_STORAGE_KEY || 'sb-krakjollsufgnwealroh-auth-token' });

const errors=[],reports=[];

const page=await context.newPage();

page.setDefaultTimeout(15000);

page.on('pageerror',error=>errors.push(error.message));

let scenario,remote,remoteVersion,attempts,accepted;

await context.route('**/*.supabase.co/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;let value={};

  if(path.includes('/auth/v1/user'))value=profile;
  else if(path.endsWith('/authors'))value={user_id:profile.id};
  else if(path.endsWith('/workspaces'))value={id:remote.id,payload:remote,version:remoteVersion};
  else if(path.endsWith('/save_workspace')){
    const input=request.postDataJSON();attempts.push(input);

    if(input.p_payload.trash===undefined){
      if((scenario==='typing'||scenario==='version'||scenario==='tab'))await page.waitForTimeout(700);
      await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'P0001',message:TRASH_SAVE_REJECTED})});

return;
    }

    if(scenario==='ack'&&accepted){assert.equal(input.p_request_id,accepted.p_request_id);assert.deepEqual(input,accepted);value={status:'saved',version:remoteVersion};}
    else{
      assert.equal(input.p_base_version,remoteVersion);remote=workspaceSchema.parse(input.p_payload);remoteVersion++;accepted=input;

      if(scenario==='ack'){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'503',message:'합성 응답 유실'})});

return;}

      value={status:'saved',version:remoteVersion};
    }
  }

  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
});

await context.route('**/api/backup/**',route=>route.fulfill({status:200,contentType:'application/json',body:'{"connected":false,"configured":false}'}));

await context.route('**/api/ai/**',route=>route.abort());

if(context.routeWebSocket)await context.routeWebSocket('**/realtime/**',ws=>ws.close());

const stored=()=>page.evaluate(async namespace=>new Promise((resolve,reject)=>{const request=indexedDB.open('orbit-novel-studio-v1');request.onsuccess=()=>{const db=request.result,tx=db.transaction('workspaces','readonly'),get=tx.objectStore('workspaces').get(namespace);get.onsuccess=()=>resolve(get.result);get.onerror=()=>reject(get.error);tx.oncomplete=()=>db.close();};

request.onerror=()=>reject(request.error);}),`author:${profile.id}`);

const seed=async row=>{
  await page.goto(`${base}/privacy`,{waitUntil:'domcontentloaded'});
  await page.evaluate(async row=>new Promise((resolve,reject)=>{const request=indexedDB.open('orbit-novel-studio-v1');request.onupgradeneeded=()=>{const db=request.result;db.createObjectStore('workspaces',{keyPath:'namespace'});const revisions=db.createObjectStore('revisions',{keyPath:'id'});revisions.createIndex('namespace','namespace');revisions.createIndex('createdAt','createdAt');const assets=db.createObjectStore('assets',{keyPath:['namespace','id']});assets.createIndex('namespace','namespace');assets.createIndex('id','id');};

request.onsuccess=()=>{const db=request.result,tx=db.transaction('workspaces','readwrite');tx.objectStore('workspaces').put(row);tx.oncomplete=()=>{db.close();resolve();};

tx.onerror=()=>reject(tx.error);};

request.onerror=()=>reject(request.error);}),row);
};

try{
  for(scenario of ['refresh','typing','ack','nonempty','version','tab']){
    attempts=[];accepted=null;remote={...structuredClone(data),trash:[]};remoteVersion=1;
    const local=structuredClone(remote);local.works[0].documents[0].title='최신 기기 제목';
    const old=structuredClone(remote);delete old.trash;old.works[0].documents[0].title='오래된 요청 제목';

    if(scenario==='nonempty')remote=trashNote(remote,note.id);
    // Version changes after opening: make the recovery read see it, not the initial load.
    const row={namespace:`author:${profile.id}`,data:local,localVersion:2,cloudVersion:1,dirty:true,lastExportAt:null,pendingRequest:{id:uid(),localVersion:1,baseVersion:1,data:scenario==='ack'?local:old}};

    if(scenario==='ack')row.pendingRequest.localVersion=2;
    await seed(row);await page.goto(`${base}/studio`);await page.locator('.editor-panes > .editor-shell .manuscript').waitFor();

    if(scenario==='typing'){
      await page.waitForFunction(()=>document.body.textContent.includes('클라우드 동기화 중'));
      const p=page.locator('.editor-panes > .editor-shell .manuscript p').nth(1);await p.click();await page.keyboard.press('End');await page.keyboard.insertText(' 새 입력');
    }

    if(scenario==='tab'){
      await page.waitForFunction(()=>document.body.textContent.includes('클라우드 동기화 중'));
      const newer={...row,localVersion:3,data:structuredClone(local)};newer.data.works[0].documents[0].title='다른 창의 최신 제목';
      await page.evaluate(row=>new Promise((resolve,reject)=>{const request=indexedDB.open('orbit-novel-studio-v1');request.onsuccess=()=>{const db=request.result,tx=db.transaction('workspaces','readwrite');tx.objectStore('workspaces').put(row);tx.oncomplete=()=>{db.close();resolve();};

tx.onerror=()=>reject(tx.error);};

request.onerror=()=>reject(request.error);}),newer);
    }

    if(scenario==='version'){
      await page.waitForFunction(()=>document.body.textContent.includes('클라우드 동기화 중'));remoteVersion=2;
    }

    if(scenario==='nonempty'||scenario==='version'||scenario==='tab'){
      await page.getByRole('dialog',{name:'두 원고를 확인하세요',exact:true}).waitFor();assert.equal(attempts.length,1);assert.equal(attempts[0].p_request_id,row.pendingRequest.id);assert.equal((await stored()).dirty,true);assert.equal((await stored()).pendingRequest.id,row.pendingRequest.id);assert.equal(remote.trash.length,scenario==='nonempty'?1:0);

if(scenario==='tab')assert.equal((await stored()).data.works[0].documents[0].title,'다른 창의 최신 제목');
    }else{
      if(scenario==='ack'){await page.locator('.studio-error').filter({hasText:'합성 응답 유실'}).waitFor();await page.evaluate(()=>window.dispatchEvent(new Event('focus')));}

      await page.waitForFunction(()=>document.body.textContent.includes('클라우드 동기화됨'));await page.locator('.studio-error').waitFor({state:'hidden'});assert.equal(await page.locator('.studio-error').count(),0);
      assert.equal(remote.works[0].documents[0].title,'최신 기기 제목');assert.equal((await stored()).dirty,false);assert.equal((await stored()).pendingRequest,undefined);

      if(scenario==='typing')assert(remote.works[0].documents[0].content.content.some(p=>p.content?.some(n=>n.text?.includes(' 새 입력'))));

      if(scenario!=='ack')assert.notEqual(attempts[0].p_request_id,attempts[1].p_request_id);
      await page.reload();await page.locator('.editor-panes > .editor-shell .manuscript').waitFor();assert.equal(await page.locator('.studio-error').count(),0);
    }

    reports.push({scenario,attempts:attempts.length,passed:true});
  }

  assert.deepEqual(errors,[]);await writeFile(resolve(output,'report.json'),JSON.stringify({reports,errors},null,2));console.log(JSON.stringify({passed:true,reports,errors}));
}catch(error){await page.screenshot({path:resolve(output,'failure.png')});console.error(JSON.stringify({scenario,attempts:attempts.length,syntheticStatus:await page.locator('.save-state').first().innerText().catch(()=>''),dialogs:await page.getByRole('dialog').allTextContents()}));throw error;}finally{await browser.close();}
