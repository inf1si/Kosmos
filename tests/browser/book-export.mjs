// Uses synthetic account/workspace responses, including on production. No writer credentials or writes.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {PDFDocument} from 'pdf-lib';
import JSZip from 'jszip';
import {chooseOption,selectedValue} from './select.mjs';
import {bookFixture} from '../fixtures/book-work.ts';
import {workspaceSchema} from '../../src/lib/model.ts';
import {PALETTES} from '../../src/lib/theme.ts';

const require=createRequire(import.meta.url),playwright=require(process.env.KOSMOS_PLAYWRIGHT_MODULE||'playwright-core');

const engine=process.env.KOSMOS_BROWSER_ENGINE||'chromium',base=process.env.KOSMOS_TEST_BASE_URL||'http://127.0.0.1:3210',output=resolve(process.env.KOSMOS_BROWSER_OUTPUT||`test-results/book-export/${engine}`);

await mkdir(output,{recursive:true});

const browser=await playwright[engine].launch(engine==='chromium'?{headless:true,executablePath:process.env.KOSMOS_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']}:{headless:true});

const results=[],errors=[],palettes=process.env.KOSMOS_BOOK_QUICK==='1'?PALETTES.slice(0,1):PALETTES;

let activePage;

try{
 for(const width of [1280,360]){
  const fixture=bookFixture();let data=workspaceSchema.parse(fixture.data),version=1,cloudSeen=false,writes=0;
  const context=await browser.newContext({viewport:{width,height:1000}}),profile={id:'11111111-1111-4111-8111-111111111111',aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',created_at:'2026-10-26T00:00:00.000Z',app_metadata:{provider:'email',providers:['email']},user_metadata:{},identities:[]};
  const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),token=`${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:profile.id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})}.synthetic-signature`;
  await context.addInitScript(({profile,token})=>{
   if(window!==window.top)return;

   // Safari before 18.4 has no Iterator helpers; the dialog must still open there.
   const iterator=Object.getPrototypeOf(Object.getPrototypeOf([].values()));

   for(const name of ['map','filter','take','drop','flatMap','reduce','toArray','forEach','some','every','find'])delete iterator[name];

   localStorage.setItem('kosmos-app-preferences',JSON.stringify({studioStart:'last'}));
   localStorage.setItem('sb-krakjollsufgnwealroh-auth-token',JSON.stringify({access_token:token,refresh_token:'synthetic-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:profile}));
  },{profile,token});
  await context.route('**/auth/v1/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(profile)}));
  await context.route('**/rest/v1/**',async route=>{
   const request=route.request(),path=new URL(request.url()).pathname;cloudSeen=true;let value={};

   if(path.endsWith('/authors'))value={user_id:profile.id};
   else if(path.endsWith('/workspaces'))value={id:data.id,payload:data,version};
   else if(path.endsWith('/save_workspace')){const input=request.postDataJSON();data=workspaceSchema.parse(input.p_payload);version++;writes++;value={status:'saved',version};}

   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
  });
  await context.route('**/api/**',route=>route.fulfill({status:200,contentType:'application/json',body:'{"connected":false,"configured":false,"providers":[],"storageAvailable":true}'}));

  if(context.routeWebSocket)await context.routeWebSocket('**/realtime/**',ws=>ws.close());
  const page=await context.newPage();activePage=page;page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${base}/studio`,{waitUntil:'networkidle'});await page.locator('.manuscript[contenteditable=true]').first().waitFor();

  if(!cloudSeen){
   await page.evaluate(data=>new Promise((resolve,reject)=>{const request=indexedDB.open('orbit-novel-studio-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('workspaces','readwrite');tx.objectStore('workspaces').put({namespace:'preview',data,localVersion:1,cloudVersion:0,dirty:false,lastExportAt:null});tx.oncomplete=()=>{db.close();resolve();};

tx.onerror=()=>reject(tx.error);};}),data);
   await page.reload({waitUntil:'networkidle'});
  }

  const stored=()=>page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('orbit-novel-studio-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('workspaces','readonly'),get=tx.objectStore('workspaces').getAll();get.onsuccess=()=>resolve(get.result.map(record=>record.data));tx.oncomplete=()=>db.close();};}));
  const before=JSON.stringify(await stored());

  // Open through the real settings control, including the mobile sidebar.
  if(width===360)await page.getByRole('button',{name:'사이드바 열기',exact:true}).click();
  await page.locator('[data-settings-opener]').first().click();
  await page.getByRole('button',{name:'저장 · 백업',exact:true}).click();
  await page.getByRole('button',{name:'책으로 내보내기',exact:true}).click();
  const dialog=()=>page.getByRole('dialog',{name:'책으로 내보내기',exact:true}),group=name=>dialog().getByRole('group',{name,exact:true}),frame=()=>page.frameLocator('iframe[title="책 쪽 미리보기"]');
  await dialog().waitFor();assert.equal(await dialog().getByRole('textbox',{name:'책 제목',exact:true}).inputValue(),'우주 너머의 책');
  assert.equal(await dialog().getByRole('textbox',{name:'책 저자',exact:true}).inputValue(),'합성 작가');
  await dialog().getByRole('button',{name:'설정으로 돌아가기',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'책으로 내보내기',exact:true}).evaluate(el=>el===document.activeElement),true);
  await page.getByRole('button',{name:'가져오기 · 내보내기',exact:true}).click();
  await page.getByRole('tab',{name:'내보내기',exact:true}).click();
  await page.getByRole('button',{name:'책으로 내보내기 · PDF / EPUB / HTML',exact:true}).click();
  await dialog().getByRole('textbox',{name:'책 제목',exact:true}).fill(`검증 책 ${width}`);
  // Actual keyboard selection, then consecutive paper/layout/font controls.
  await chooseOption(dialog().getByRole('combobox',{name:'책 용지',exact:true}),'trade');
  await group('책 방향').getByRole('button',{name:'가로',exact:true}).click();
  await group('책 단수').getByRole('button',{name:'2단',exact:true}).click();
  await chooseOption(dialog().getByRole('combobox',{name:'책 글꼴',exact:true}),'wanted');
  await chooseOption(dialog().getByRole('combobox',{name:'책 줄 간격',exact:true}),'2');
  await dialog().getByRole('spinbutton',{name:'책 글자 크기',exact:true}).fill('7');
  await dialog().getByRole('button',{name:'미리보기',exact:true}).click();
  await dialog().getByRole('alert').filter({hasText:'글자 크기는 8–20pt'}).waitFor();
  await dialog().getByRole('spinbutton',{name:'책 글자 크기',exact:true}).fill('11');
  await dialog().getByRole('button',{name:'미리보기',exact:true}).click();
  await frame().locator('svg text').first().waitFor({timeout:60000});
  await frame().locator('body').evaluate(()=>document.fonts.ready);
  assert(await frame().locator('svg').evaluate(svg=>svg.getBoundingClientRect().bottom<=innerHeight+1),'one whole page fits the preview');
  assert((await frame().locator('svg text').allTextContents()).join('').includes(`검증 책 ${width}`));
  const viewBox=await frame().locator('svg').getAttribute('viewBox');const dims=viewBox.split(' ').map(Number);assert(dims[2]>dims[3]);

  // Two-page view: page 1 stands alone as a right-hand page, then 2–3; landscape pages stack so both stay legible.
  const boxes=()=>frame().locator('.page').evaluateAll(pages=>pages.map(page=>{const b=page.getBoundingClientRect();

return {x:b.x,y:b.y,bottom:b.bottom,width:b.width};}));

  await group('미리보기 펼침').getByRole('button',{name:'두 쪽',exact:true}).click();await dialog().getByText(/^1 \/ \d+쪽$/).waitFor();assert.equal(await frame().locator('.page').count(),1);
  await dialog().getByRole('button',{name:'다음 쪽',exact:true}).click();await frame().locator('.page#book-page-3').waitFor();await dialog().getByText(/^2–3 \/ \d+쪽$/).waitFor();
  const stacked=await boxes();assert(stacked[1].y>stacked[0].y);assert(Math.abs(stacked[1].x-stacked[0].x)<1);
  assert(await frame().locator('.page').evaluateAll(pages=>pages.every(page=>page.getBoundingClientRect().bottom<=innerHeight+1)),'both whole pages fit the preview');
  assert((await frame().locator('svg text').allTextContents()).join('').includes('한글과'));

  async function save(format){
   if(format!=='pdf')await group('책 파일 형식').getByRole('button',{name:format.toUpperCase(),exact:true}).click();
   await dialog().getByRole('button',{name:`${format.toUpperCase()} 만들기`,exact:true}).click();
   const link=dialog().getByRole('link',{name:/파일 저장/});await link.waitFor({timeout:60000});
   const pending=page.waitForEvent('download');await link.click();const download=await pending,path=resolve(output,`${width}.${format}`);await download.saveAs(path);

return path;
  }

  const pdfPath=await save('pdf'),pdf=await PDFDocument.load(await readFile(pdfPath));assert(pdf.getPageCount()>=4);assert(pdf.getPage(0).getWidth()>pdf.getPage(0).getHeight());
  const text=execFileSync('pdftotext',['-layout',pdfPath,'-'],{encoding:'utf8'});assert(text.includes('한글과'));assert(text.includes('마지막 문장까지 보존'));assert(text.includes('각주 설명'));assert(!text.includes('비공개참조제목'));assert(!text.includes('미선택 비밀 원고'));
  // A changed control clears the old download; empty selection cannot export.
  await dialog().getByRole('spinbutton',{name:'책 여백',exact:true}).fill('20');assert.equal(await dialog().getByRole('link',{name:/파일 저장/}).count(),0);
  await dialog().locator('summary').click();await dialog().getByRole('button',{name:'선택 해제',exact:true}).click();assert.equal(await dialog().getByRole('button',{name:'PDF 만들기',exact:true}).isDisabled(),true);
  await dialog().getByRole('button',{name:'원고만',exact:true}).click();await dialog().locator('summary').click();
  await group('책 파일 형식').getByRole('button',{name:'EPUB',exact:true}).click();assert.equal(await dialog().getByRole('combobox',{name:'책 용지',exact:true}).count(),0);
  const epubPath=await save('epub'),epub=await JSZip.loadAsync(await readFile(epubPath)),chapter=await epub.file('OEBPS/chapter-1.xhtml').async('string');assert(chapter.includes('한글과'));assert(!chapter.includes('비공개참조제목'));assert((await epub.file('OEBPS/content.opf').async('string')).includes('reflowable'));
  const htmlPath=await save('html'),html=await readFile(htmlPath,'utf8');assert(html.includes('data:font/woff2'));assert(html.includes('font-licenses'));assert(!html.includes('99999999-9999-4999-8999-999999999999'));
  // Load the downloaded standalone HTML with all HTTP requests blocked: embedded font and actual text still render.
  const standalone=await context.newPage();await standalone.route('**/*',route=>route.abort());await standalone.setContent(html);await standalone.evaluate(()=>document.fonts.ready);assert(await standalone.locator('.page').count()>=4);assert((await standalone.locator('svg text').allTextContents()).join('').includes('관측 기록'));await standalone.screenshot({path:resolve(output,`${width}-standalone.png`),fullPage:true});await standalone.close();
  await dialog().getByRole('button',{name:'미리보기',exact:true}).click();await frame().locator('svg text').first().waitFor({timeout:60000});

  for(const palette of palettes)for(const mode of ['light','dark']){
   await page.evaluate(({palette,mode})=>{document.documentElement.dataset.palette=palette;document.documentElement.dataset.theme=mode;},{palette,mode});
   await dialog().getByRole('textbox',{name:'책 제목',exact:true}).focus();

   const metrics=await dialog().evaluate(root=>{const b=root.getBoundingClientRect(),input=root.querySelector('input[aria-label="책 제목"]'),style=getComputedStyle(input),controls=[...root.querySelectorAll('button,input,[role=combobox]')].filter(el=>el.getBoundingClientRect().width>0);

return {left:b.left,right:b.right,viewport:innerWidth,overflow:root.scrollWidth>root.clientWidth+1,font:style.fontSize,focused:document.activeElement===input,outline:style.outlineStyle,color:style.color,background:style.backgroundColor,escaped:controls.filter(el=>{const b=el.getBoundingClientRect();

return b.left<root.getBoundingClientRect().left||b.right>root.getBoundingClientRect().right+1;}).length};});

   assert(metrics.left>=0&&metrics.right<=metrics.viewport+1,`${palette}/${mode} modal`);assert.equal(metrics.overflow,false,`${palette}/${mode} overflow`);assert.equal(metrics.escaped,0,`${palette}/${mode} control`);assert(metrics.focused);assert.notEqual(metrics.color,metrics.background);

   if(palette===palettes[0]||palette===palettes.at(-1))await dialog().screenshot({path:resolve(output,`${width}-${palette}-${mode}.png`)});
   results.push({width,palette,mode,...metrics});
  }

  await group('책 파일 형식').getByRole('button',{name:'EPUB',exact:true}).click();

  for(const palette of palettes)for(const mode of ['light','dark']){
   await page.evaluate(({palette,mode})=>{document.documentElement.dataset.palette=palette;document.documentElement.dataset.theme=mode;},{palette,mode});
   const overflow=await dialog().evaluate(root=>root.scrollWidth>root.clientWidth+1);assert.equal(overflow,false,`${palette}/${mode} EPUB overflow`);

   if(palette===palettes[0])await dialog().screenshot({path:resolve(output,`${width}-epub-${mode}.png`)});
   results.push({width,palette,mode,format:'epub',overflow});
  }

  // Portrait spreads sit side by side, page 1 on the right half.
  await group('책 파일 형식').getByRole('button',{name:'PDF',exact:true}).click();await group('책 방향').getByRole('button',{name:'세로',exact:true}).click();await dialog().getByRole('button',{name:'미리보기',exact:true}).click();await frame().locator('svg text').first().waitFor({timeout:60000});
  const [single]=await boxes(),frameWidth=await frame().locator('body').evaluate(()=>innerWidth);assert(single.x>frameWidth/2-1,'page 1 is a right-hand page');
  await dialog().getByRole('button',{name:'다음 쪽',exact:true}).click();await dialog().getByText(/^2–3 \/ \d+쪽$/).waitFor();const across=await boxes();assert(across[1].x>across[0].x);assert(Math.abs(across[1].y-across[0].y)<1);
  await group('책 파일 형식').getByRole('button',{name:'EPUB',exact:true}).click();
  await dialog().getByRole('button',{name:'닫기',exact:true}).click();
  assert.equal(JSON.stringify(await stored()),before,'export must not alter workspace or settings');
  await page.reload({waitUntil:'networkidle'});assert.equal(JSON.stringify(await stored()),before,'reload retains original workspace');
  // The last book settings for this work come back on this device after a reload.

  if(width===360)await page.getByRole('button',{name:'사이드바 열기',exact:true}).click();
  await page.locator('[data-settings-opener]').first().click();await page.getByRole('button',{name:'저장 · 백업',exact:true}).click();await page.getByRole('button',{name:'책으로 내보내기',exact:true}).click();
  assert.equal(await dialog().getByRole('textbox',{name:'책 제목',exact:true}).inputValue(),`검증 책 ${width}`);assert.equal(await group('책 파일 형식').getByRole('button',{name:'EPUB',exact:true}).getAttribute('aria-pressed'),'true');
  await group('책 파일 형식').getByRole('button',{name:'PDF',exact:true}).click();assert.equal(await selectedValue(dialog().getByRole('combobox',{name:'책 용지',exact:true})),'trade');assert.equal(await selectedValue(dialog().getByRole('combobox',{name:'책 글꼴',exact:true})),'wanted');
  await dialog().getByRole('button',{name:'닫기',exact:true}).click();assert.equal(JSON.stringify(await stored()),before,'remembered settings stay out of the workspace');
  assert.equal(writes,0,'synthetic server saw no source mutations');
  await context.close();
 }

 assert.deepEqual(errors,[]);await writeFile(resolve(output,'results.json'),JSON.stringify({base,engine,results,errors},null,2));console.log(JSON.stringify({engine,base,cases:results.length,downloads:6,sourceUnchanged:true}));
} catch(error){if(activePage&&!activePage.isClosed())await activePage.screenshot({path:resolve(output,'failure.png'),fullPage:true});throw error;}
finally{await browser.close();}
