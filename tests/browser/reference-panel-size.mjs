// Run through tsx against `pnpm exec next dev --webpack` with the synthetic Supabase settings in docs/local-verification; see docs/settings.md.
// The reference panel (연결·첨부·노트·AI 대화) is resized by its left edge and can be shown large in place of the editor, in the studio and in notes.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {seedWorkspace} from '../../src/lib/seed.ts';
import {workspaceSchema} from '../../src/lib/model.ts';
import {addNote,newNote} from '../../src/lib/personal-notes.ts';
import {PALETTES} from '../../src/lib/theme.ts';

const require=createRequire(import.meta.url),{chromium}=require(process.env.KOSMOS_PLAYWRIGHT_MODULE||'playwright-core');

const base=process.env.KOSMOS_TEST_BASE_URL||'http://localhost:3210',output=resolve(process.env.KOSMOS_BROWSER_OUTPUT||'test-results/reference-panel-size');

await mkdir(output,{recursive:true});

const browser=await chromium.launch({executablePath:process.env.KOSMOS_CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']}),errors=[],results=[];

const paragraph=text=>({type:'paragraph',content:[{type:'text',text}]});

const saved=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('kosmos-app-preferences')||'{}').referenceWidth??null);

const box=locator=>locator.evaluate(el=>{const b=el.getBoundingClientRect();

return {left:Math.round(b.left),right:Math.round(b.right),width:Math.round(b.width),display:getComputedStyle(el).display};});

const pageOverflow=page=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);

/** Presses the handle's middle and moves the pointer by dx in steps, like a hand drag. */
async function drag(page,dx){
  const handle=await page.getByRole('separator',{name:'참고 패널 폭'}).boundingBox(),x=handle.x+handle.width/2,y=handle.y+handle.height/2;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y,{steps:8});await page.mouse.up();
}

async function openStudio(width){
  let data=seedWorkspace();const scene=data.works[0].documents.find(doc=>doc.kind==='scene');

  scene.content={type:'doc',content:[paragraph('첫 문단입니다.')]};
  const note={...newNote(),title:'합성 노트',content:{type:'doc',content:[paragraph('노트 문단입니다.')]}};data=addNote(data,note);workspaceSchema.parse(data);
  const context=await browser.newContext({viewport:{width,height:900}});
  const profile={id:'11111111-1111-4111-8111-111111111111',aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',created_at:'2026-10-25T00:00:00.000Z',app_metadata:{provider:'email',providers:['email']},user_metadata:{},identities:[]};
  const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),token=`${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:profile.id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})}.synthetic-signature`;
  await context.addInitScript(({profile,token})=>{
    if(!sessionStorage.getItem('seeded')){sessionStorage.setItem('seeded','1');localStorage.setItem('kosmos-app-preferences',JSON.stringify({studioStart:'last'}));}

    localStorage.setItem('sb-krakjollsufgnwealroh-auth-token',JSON.stringify({access_token:token,refresh_token:'synthetic-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:profile}));
  },{profile,token});
  await context.route('**/auth/v1/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(profile)}));
  await context.route('**/rest/v1/**',async route=>{
    const path=new URL(route.request().url()).pathname;let value={};

    if(path.endsWith('/authors'))value={user_id:profile.id};
    else if(path.endsWith('/workspaces'))value={id:data.id,payload:data,version:1};
    else if(path.endsWith('/save_workspace'))value={status:'saved',version:2};

    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
  });
  await context.route('**/api/**',route=>route.fulfill({status:200,contentType:'application/json',body:'{"connected":false,"configured":false,"providers":[],"storageAvailable":true}'}));

  if(context.routeWebSocket)await context.routeWebSocket('**/realtime/**',ws=>ws.close());
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${base}/studio`,{waitUntil:'networkidle'});await page.locator('.manuscript[contenteditable=true]').first().waitFor();

  return {context,page,note};
}

try{
  // 1. Desktop: drag, clamp, keyboard, reset, shared width across tabs and into notes, and 크게 보기.
  {
    const {context,page,note}=await openStudio(1280),panel=page.locator('.reference-panel'),editor=page.locator('.editor-panes');
    await page.getByRole('button',{name:'AI 대화',exact:true}).click();await panel.locator('.ai-chat').waitFor();
    assert.equal((await box(panel)).width,360,'AI 대화 opens at its default width');
    const before=(await box(panel)).left;await drag(page,-200);
    assert.equal((await box(panel)).width,560,'dragging the left edge left widens the panel');assert.equal(await saved(page),560);assert.equal((await box(panel)).left,before-200,'the panel grows toward the editor');assert((await box(editor)).width>300,'the editor stays beside it');
    await page.getByRole('tab',{name:'연결',exact:true}).click();assert.equal((await box(panel)).width,560,'every tab uses the saved width');
    await page.reload({waitUntil:'networkidle'});await page.locator('.manuscript[contenteditable=true]').first().waitFor();await page.getByRole('button',{name:'AI 대화',exact:true}).click();await panel.locator('.ai-chat').waitFor();
    assert.equal((await box(panel)).width,560,'the width is kept after a reload');
    const row=await box(page.locator('.editor-row')),most=Math.min(960,Math.floor(row.width*.7));
    await drag(page,-2000);assert.equal((await box(panel)).width,most,'at most 70% of the editor row');await drag(page,2000);assert.equal((await box(panel)).width,280,'at least 280px');
    const handle=page.getByRole('separator',{name:'참고 패널 폭'});await handle.focus();await page.keyboard.press('ArrowLeft');assert.equal((await box(panel)).width,296,'← widens by 16px');await page.keyboard.press('ArrowRight');assert.equal((await box(panel)).width,280);
    await handle.dblclick();assert.equal((await box(panel)).width,360,'double-click restores the default');assert.equal(await saved(page),null);
    await drag(page,-140);assert.equal((await box(panel)).width,500);
    // 크게 보기 takes the editor's place; the conversation column stays readable.
    const expand=page.getByRole('button',{name:'크게 보기',exact:true});await expand.click();
    const large=await box(panel);assert.equal(large.left,row.left,'the panel fills the editor row');assert.equal(large.width,row.width);assert.equal((await box(editor)).display,'none','the editor is covered, not removed');assert.equal(await page.getByRole('separator',{name:'참고 패널 폭'}).count(),0,'no resize handle while large');
    const column=await box(panel.locator('.ai-chat'));assert(column.width<=880&&Math.abs(column.left-(large.left+(large.width-column.width)/2))<=2,JSON.stringify(column));
    assert.equal(await page.getByRole('button',{name:'원래 크기로',exact:true}).getAttribute('aria-pressed'),'true');await page.screenshot({path:resolve(output,'studio-expanded-1280.png')});
    await page.getByRole('button',{name:'원래 크기로',exact:true}).click();assert.equal((await box(panel)).width,500,'원래 크기로 returns to the saved width');assert.notEqual((await box(editor)).display,'none');
    await expand.click();await page.getByRole('button',{name:'참고 패널 닫기',exact:true}).click();assert.notEqual((await box(editor)).display,'none','closing the panel brings the editor back');
    await page.getByRole('button',{name:'AI 대화',exact:true}).click();await panel.locator('.ai-chat').waitFor();assert.equal((await box(panel)).width,500,'reopened at the saved width, not large');
    assert.equal(await page.locator('.manuscript[contenteditable=true]').first().innerText(),'첫 문단입니다.');results.push({view:'studio',width:1280});

    // Notes use the same saved width and the same 크게 보기.
    await page.goto(`${base}/studio#notes/${note.id}`,{waitUntil:'networkidle'});await page.getByLabel('노트 본문',{exact:true}).waitFor();
    await page.locator('#note-ai-toggle').click();const notePanel=page.locator('.reference-panel');await notePanel.locator('.ai-chat').waitFor();
    assert.equal((await box(notePanel)).width,500,'notes follow the width set in the studio');await drag(page,40);assert.equal((await box(notePanel)).width,460);assert.equal(await saved(page),460);
    await page.getByRole('button',{name:'크게 보기',exact:true}).click();assert.equal((await box(page.locator('main.studio-panel'))).display,'none');const noteLarge=await box(notePanel);assert(noteLarge.width>900&&noteLarge.right>=1270,JSON.stringify(noteLarge));assert.equal(await pageOverflow(page),0);
    await page.screenshot({path:resolve(output,'notes-expanded-1280.png')});await page.getByRole('button',{name:'원래 크기로',exact:true}).click();assert.notEqual((await box(page.locator('main.studio-panel'))).display,'none');assert.equal((await box(notePanel)).width,460);
    results.push({view:'notes',width:1280});

    // Every palette and mode, at the saved width and large.
    await page.goto(`${base}/studio`,{waitUntil:'networkidle'});await page.locator('.manuscript[contenteditable=true]').first().waitFor();await page.getByRole('button',{name:'AI 대화',exact:true}).click();await panel.locator('.ai-chat').waitFor();

    for(const palette of PALETTES)for(const mode of ['light','dark']){
      await page.evaluate(({palette,mode})=>{document.documentElement.dataset.palette=palette;document.documentElement.dataset.theme=mode;},{palette,mode});

      for(const large of [false,true]){
        if(large)await page.getByRole('button',{name:'크게 보기',exact:true}).click();

        const layout=await panel.evaluate(el=>{const b=el.getBoundingClientRect(),tabs=el.querySelector('.reference-tabs'),buttons=[...tabs.querySelectorAll('.icon-button')].map(btn=>btn.getBoundingClientRect());

return {right:b.right,buttons:buttons.every(r=>r.right<=b.right+1&&r.left>=b.left),overflow:tabs.scrollWidth>tabs.clientWidth+1};});

        assert(layout.right<=1281&&layout.buttons&&!layout.overflow&&await pageOverflow(page)===0,JSON.stringify({palette,mode,large,layout}));

        if(large){if(['violet','cassette','cyber'].includes(palette))await page.screenshot({path:resolve(output,`expanded-${palette}-${mode}.png`)});await page.getByRole('button',{name:'원래 크기로',exact:true}).click();}
        else if(['violet','cassette','cyber'].includes(palette)){await page.getByRole('separator',{name:'참고 패널 폭'}).hover();await page.screenshot({path:resolve(output,`resize-${palette}-${mode}.png`)});}
      }

      results.push({view:'palette',palette,mode});
    }

    await context.close();
  }

  // 2. Narrow screens: the panel is a drawer without a resize handle; 크게 보기 fills the screen.
  for(const width of [900,360]){
    const {context,page}=await openStudio(width),panel=page.locator('.reference-panel');
    await page.getByRole('button',{name:'AI 대화',exact:true}).click();await panel.locator('.ai-chat').waitFor();
    assert.equal(await page.getByRole('separator',{name:'참고 패널 폭'}).count(),0,'no resize handle on a drawer');
    await page.getByRole('button',{name:'크게 보기',exact:true}).click();const large=await box(panel),row=await box(page.locator('.editor-row'));
    assert.equal(large.width,row.width,'large view covers the editor row');assert.equal(await pageOverflow(page),0);await page.screenshot({path:resolve(output,`expanded-${width}.png`)});
    await page.getByRole('button',{name:'원래 크기로',exact:true}).click();assert.equal((await box(panel)).width,360);
    results.push({view:'drawer',width});await context.close();
  }

  assert.equal(errors.length,0,errors.join('\n'));console.log(JSON.stringify({cases:results.length,errors}));
}finally{await browser.close();}
