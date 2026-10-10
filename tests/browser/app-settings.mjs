// Run through tsx; see docs/settings.md for browser/module configuration.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { seedWorkspace } from '../../src/lib/seed.ts';
import { fromText, uid, workspaceSchema } from '../../src/lib/model.ts';
import { addNote, newNote } from '../../src/lib/personal-notes.ts';

const require = createRequire(import.meta.url);

const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');

const base = process.env.KOSMOS_TEST_BASE_URL || 'http://127.0.0.1:3210';

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/app-settings');

await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });

// Older checks start in the editor; the studio home has its own check (studio-home.mjs).
await context.addInitScript(() => { try { const key = 'kosmos-app-preferences', value = JSON.parse(localStorage.getItem(key) || '{}');

 if (!('studioStart' in value)) localStorage.setItem(key, JSON.stringify({ ...value, studioStart: 'last' })); } catch { /* Storage blocked: the test sees the home and fails loudly. */ } });

const note = { ...newNote(), title: '합성 노트', content: fromText('\n\n반복 문장.\n\n반복 문장.\n\n마지막 문장.'), tags: ['생각'] };

const other = { ...newNote(), title: '보관 노트', content: fromText('다른 태그'), tags: ['자료'] };

const richId=uid(),richContent=[{type:'text',text:'서식 보존',marks:[{type:'bold'},{type:'fontSize',attrs:{size:24}}]},{type:'footnote',attrs:{noteId:uid(),text:'보존할 각주'}},{type:'text',text:'노트 링크',marks:[{type:'wikiLink',attrs:{targetId:other.id}}]}];

note.content.content.push({type:'paragraph',attrs:{blockId:richId},content:richContent});

let data = addNote(addNote(seedWorkspace(), other), note), version = 1, saves = 0;

const work=data.works[0],scene=work.documents[0],setting=work.documents.find(d=>d.kind==='wiki'),memo=work.documents.find(d=>d.kind==='memo');

scene.content=fromText('\n\n반복 문장.\n\n반복 문장.\n\n마지막 문장.');

scene.content.content.push({type:'paragraph',attrs:{blockId:richId},content:richContent.map(n=>n.marks?.some(m=>m.type==='wikiLink')?{...n,marks:[{type:'wikiLink',attrs:{targetId:setting.id}}]}:n)});

setting.content=fromText('\n\n설정 원문.');

memo.content=fromText('\n\n메모 원문.');

const errors = [], layouts = [];

const profile = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'synthetic@example.invalid', created_at: '2026-10-04T00:00:00.000Z', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [] };

const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');

const token = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub: profile.id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })}.synthetic-signature`;

await context.addInitScript(({ profile, token, key }) => localStorage.setItem(key, JSON.stringify({ access_token: token, refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: profile })), { profile, token, key: process.env.KOSMOS_TEST_AUTH_STORAGE_KEY || 'sb-krakjollsufgnwealroh-auth-token' });

await context.route('**/*.supabase.co/**', async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let value = {};

    if (path.includes('/auth/v1/user'))
        value = profile;
    else if (path.endsWith('/authors'))
        value = { user_id: profile.id };
    else if (path.endsWith('/workspaces'))
        value = { id: data.id, payload: data, version };
    else if (path.endsWith('/save_workspace')) {
        const input = request.postDataJSON();
        assert.equal(input.p_base_version, version);
        data = workspaceSchema.parse(input.p_payload);
        version++;
        saves++;
        value = { status: 'saved', version };
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
});

await context.route('**/api/backup/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"connected":false,"configured":false}' }));

if (context.routeWebSocket)
    await context.routeWebSocket('**/realtime/**', ws => ws.close());

const page = await context.newPage();

page.setDefaultTimeout(15000);

page.on('filechooser',()=>{});

page.on('pageerror', error => errors.push(error.message));

const button = name => page.getByRole('button', { name, exact: true });

const until = async (check, label) => { for (let i = 0; i < 100; i++) { if (check()) return; await page.waitForTimeout(100); }

 throw new Error(`Timed out: ${label}`); };

const providers=[{id:'openai',label:'OpenAI',configured:true,model:'synthetic-model',source:'server',browserStored:false,browserInvalid:false},{id:'anthropic',label:'Claude',configured:true,model:'synthetic-model',source:'server',browserStored:false,browserInvalid:false},{id:'gemini',label:'Gemini',configured:false,model:null,source:null,browserStored:false,browserInvalid:false}];

await context.route('**/api/ai/providers',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({providers,storageAvailable:true})}));

const editor=()=>page.locator('.editor-panes > .editor-shell .manuscript');

const dialog=()=>page.getByRole('dialog',{name:'설정'});

const section=name=>dialog().locator('.settings-nav').getByRole('button',{name,exact:true});

const choose=async(group,name)=>{await dialog().getByRole('group',{name:group,exact:true}).getByRole('button',{name,exact:true}).click();};

const openSettings=async()=>{await page.locator('.studio-tools').getByRole('button',{name:'설정',exact:true}).click();await dialog().waitFor();};

const close=async()=>{await page.keyboard.press('Escape');await dialog().waitFor({state:'detached'});};

const stored=key=>page.evaluate(key=>localStorage.getItem(key),key);

const prefs=async()=>JSON.parse(await stored('kosmos-app-preferences')||'{}');

const manuscriptStyle=()=>editor().evaluate(el=>{const p=el.querySelectorAll('p')[1],s=getComputedStyle(el),q=getComputedStyle(p);

return {lineHeight:s.lineHeight,fontSize:s.fontSize,maxWidth:s.maxWidth,fontFamily:s.fontFamily,indent:q.textIndent,gap:q.marginBottom};});

try{
  await page.goto(`${base}/studio`,{waitUntil:'domcontentloaded'});await editor().waitFor();
  const before=await manuscriptStyle();
  assert.deepEqual({lineHeight:before.lineHeight,fontSize:before.fontSize,maxWidth:before.maxWidth,indent:before.indent,gap:before.gap},{lineHeight:'36px',fontSize:'18px',maxWidth:'680px',indent:'18px',gap:'21.6px'},'defaults match the old fixed layout');

  // Display: brightness can return to the device setting, which the toggle alone could not do.
  await openSettings();
  assert.equal(await section('화면').getAttribute('aria-pressed'),'true');
  await choose('밝기','다크');assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');assert.equal(await stored('orbis-theme'),'dark');
  await choose('색 계열','카세트');assert.equal(await page.evaluate(()=>document.documentElement.dataset.palette),'cassette');
  await choose('밝기','기기 설정');assert.equal(await stored('orbis-theme'),null);assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'light');
  await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  await page.emulateMedia({colorScheme:'light'});await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  await choose('색 계열','보라');

  // Manuscript display applies to the open manuscript at once.
  await section('원고 표시').click();
  await dialog().getByRole('combobox',{name:'본문 글꼴'}).selectOption({label:'나눔명조'});
  await dialog().getByRole('combobox',{name:'본문 글자 크기'}).selectOption('20');
  await choose('줄간격','2.4');await choose('문단 첫 줄 들여쓰기','없음');await choose('문단 간격','0.6줄');await choose('본문 폭','800px');
  const preview=await dialog().locator('.settings-preview .manuscript').evaluate(el=>({lineHeight:getComputedStyle(el).lineHeight,indent:getComputedStyle(el.querySelectorAll('p')[1]).textIndent}));
  assert.deepEqual(preview,{lineHeight:'48px',indent:'0px'});
  await close();
  let after=await manuscriptStyle();
  assert.deepEqual({lineHeight:after.lineHeight,fontSize:after.fontSize,maxWidth:after.maxWidth,indent:after.indent,gap:after.gap},{lineHeight:'48px',fontSize:'20px',maxWidth:'800px',indent:'0px',gap:'12px'});
  assert.match(after.fontFamily,/nanum.?myeongjo|Nanum_Myeongjo|__Nanum/i);
  assert.equal(await page.locator('.editor-panes > .editor-shell').getByRole('combobox',{name:'본문 글꼴'}).inputValue(),'nanum-myeongjo','toolbar shows the same font');
  await page.reload();await editor().waitFor();after=await manuscriptStyle();
  assert.deepEqual([after.lineHeight,after.maxWidth,after.indent],['48px','800px','0px'],'survives reload');

  // Tools: plot board and graph open with the chosen view; count basis is shared with the statistics popover.
  await openSettings();await section('집필 도구').click();
  await dialog().getByRole('combobox',{name:'글자 수 기준'}).selectOption('words');
  await choose('플롯보드 첫 보기','진행 상태');await choose('문서 그래프 첫 범위','주변 연결');await choose('주변 연결 단계','2단계');await choose('시점 인물 연결선','끔');
  assert.deepEqual(await prefs(),{lineHeight:2.4,paragraphIndent:0,paragraphGap:0.6,manuscriptWidth:800,plotBoardMode:'status',graphScope:'local',graphDepth:2,graphIncludePov:false,aiIncludeManuscript:true,aiAttachLinked:true,checkpointMinutes:10,studioStart:'last'});
  await close();
  assert.match(await page.locator('.editor-panes > .editor-shell .editor-toolbar').innerText(),/단어/);
  await page.locator('.studio-tools').getByRole('button',{name:'플롯보드',exact:true}).click();
  assert.equal(await page.getByRole('group',{name:'보드 기준'}).getByRole('button',{name:'진행 상태'}).getAttribute('aria-pressed'),'true');
  await page.locator('.studio-tools').getByRole('button',{name:'문서 그래프',exact:true}).click();
  assert.equal(await page.getByLabel('그래프 범위').getByRole('button',{name:'주변 연결',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await page.getByRole('combobox',{name:'주변 연결 단계'}).inputValue(),'2');
  await page.getByRole('button',{name:/^필터/}).click();assert.equal(await page.getByRole('checkbox',{name:'시점 인물 연결'}).isChecked(),false);await page.keyboard.press('Escape');

  // AI: the existing AI settings live in this section; new chats start with the chosen sources.
  await page.locator('.doc-tab').filter({hasText:scene.title}).getByRole('tab').click();await editor().waitFor();
  await openSettings();await section('AI').click();
  await dialog().getByRole('combobox',{name:'설정할 AI 제공자'}).waitFor();await dialog().getByRole('heading',{name:'내 스킬'}).waitFor();
  await choose('현재 문서 포함','끔');await choose('연결 설정 자동 첨부','끔');await close();
  await page.getByRole('button',{name:'AI 대화',exact:true}).click();
  await page.locator('.chat-context summary').waitFor();assert.match(await page.locator('.chat-context summary').innerText(),/원고 제외 · 참고 0개/);
  await page.getByRole('button',{name:'AI 대화',exact:true}).click();

  // Data: the checkpoint interval is stored; sync timings remain internal.
  await openSettings();await section('저장 · 백업').click();
  await dialog().getByRole('combobox',{name:'자동 복구 지점 간격'}).selectOption('5');assert.equal((await prefs()).checkpointMinutes,5);
  await dialog().getByRole('button',{name:'백업과 복구'}).click();await page.getByRole('dialog',{name:'백업과 복구'}).waitFor();assert.equal(await dialog().count(),0);await page.keyboard.press('Escape');

  // Templates, backup, interchange and note import live only here; the sidebars keep 휴지통 and the light/dark switch.
  for(const name of ['템플릿','백업과 복구','가져오기 · 내보내기'])assert.equal(await page.locator('.studio-tools').getByRole('button',{name,exact:true}).count(),0,`${name} moved to settings`);
  assert.equal(await page.locator('.studio-tools').getByRole('button',{name:/휴지통/}).count(),1);
  assert.equal(await page.locator('.sidebar-footer .palette-picker').count(),0);assert.equal(await page.locator('.sidebar-footer').getByRole('button',{name:'작품 정보'}).count(),0);
  assert.equal(await page.locator('.sidebar-footer .theme-toggle').count(),1);
  await openSettings();await section('저장 · 백업').click();await dialog().getByRole('button',{name:'템플릿',exact:true}).click();
  await page.getByRole('dialog',{name:'템플릿'}).waitFor();assert.equal(await dialog().count(),0,'settings closes under templates');await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'템플릿'}).waitFor({state:'detached'});
  await openSettings();await section('저장 · 백업').click();await dialog().getByRole('button',{name:'노트 가져오기',exact:true}).click();
  await page.getByRole('dialog',{name:'노트 가져오기'}).waitFor();await page.locator('.notes-workspace').waitFor();assert.equal(await dialog().count(),0);

  for(const name of ['노트 가져오기','템플릿','백업과 복구'])assert.equal(await page.locator('.notes-tools').getByRole('button',{name,exact:true}).count(),0,`${name} moved out of the notes sidebar`);
  await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'노트 가져오기'}).waitFor({state:'detached'});
  await page.locator('.notes-tools').getByRole('button',{name:'설정',exact:true}).click();await section('저장 · 백업').click();await dialog().getByRole('button',{name:'템플릿',exact:true}).click();
  await page.getByRole('dialog',{name:'템플릿'}).getByRole('button',{name:'새 템플릿 저장'}).click();
  assert.match(await page.getByRole('dialog',{name:'템플릿'}).innerText(),/노트 \d+개/,'notes space opens note templates');await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'템플릿'}).waitFor({state:'detached'});
  await page.locator('.notes-mode').getByRole('button',{name:'집필실'}).click();await page.locator('.studio-tools').waitFor();
  await openSettings();await section('단축키').click();assert.equal(await dialog().locator('.settings-keys > div').count(),8);
  // Reset brings back the old fixed layout for that section only.
  await section('원고 표시').click();await dialog().getByRole('button',{name:'기본값으로'}).click();
  const reset=await prefs();assert.deepEqual([reset.lineHeight,reset.paragraphIndent,reset.paragraphGap,reset.manuscriptWidth,reset.plotBoardMode,reset.checkpointMinutes],[2,1,1.2,680,'status',5]);
  await close();after=await manuscriptStyle();assert.deepEqual([after.lineHeight,after.fontSize,after.maxWidth,after.indent],['36px','18px','680px','18px']);

  // Notes: the views chosen here and in the notes space are the same value.
  await openSettings();await section('노트').click();await choose('노트 홈 보기','보드');await choose('노트 목록','최근 수정순');await close();
  await page.locator('.notes-mode').getByRole('button',{name:'노트'}).click();await page.locator('.notes-workspace').waitFor();
  await page.getByRole('button',{name:'노트 홈',exact:true}).click();
  assert.equal(await page.getByRole('group',{name:'노트 첫 화면 보기'}).getByRole('button',{name:'보드'}).getAttribute('aria-pressed'),'true');
  assert.equal(await page.getByRole('group',{name:'노트 목록 보기'}).getByRole('button',{name:'최근 수정순'}).getAttribute('aria-pressed'),'true');
  await page.getByRole('group',{name:'노트 첫 화면 보기'}).getByRole('button',{name:'최근'}).click();
  await page.locator('.notes-tools').getByRole('button',{name:'설정',exact:true}).click();await dialog().waitFor();
  assert.equal(await section('노트').getAttribute('aria-pressed'),'true','opens at the notes section from notes');
  assert.equal(await dialog().getByRole('group',{name:'노트 홈 보기'}).getByRole('button',{name:'최근'}).getAttribute('aria-pressed'),'true');
  await close();
  await page.waitForFunction(el=>el===document.activeElement,await page.locator('.notes-tools').getByRole('button',{name:'설정',exact:true}).elementHandle());
  const active=await page.evaluate(()=>document.activeElement?.outerHTML.slice(0,120));assert.equal(await page.locator('.notes-tools').getByRole('button',{name:'설정',exact:true}).evaluate(el=>el===document.activeElement),true,'focus returns to the opener: '+active);

  // Layout: six palettes x two widths, no horizontal overflow, dialog inside the viewport.
  await page.goto(`${base}/studio`);await editor().waitFor();

  for(const width of [1280,360])for(const palette of ['violet','cassette','cyber'])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height:width===360?740:900});await page.waitForTimeout(100); // Let the resize handler settle the sidebar drawer before opening settings.
    await page.evaluate(({palette,theme})=>{localStorage.setItem('orbis-palette',palette);localStorage.setItem('orbis-theme',theme);document.documentElement.dataset.palette=palette;document.documentElement.dataset.theme=theme;},{palette,theme});

    if(width===360&&!(await page.locator('.studio-sidebar').isVisible()))await page.getByRole('button',{name:'사이드바 열기'}).click();
    await openSettings();

    for(const [name,file] of [['화면','display'],['원고 표시','manuscript'],['집필 도구','tools'],['노트','notes'],['AI','ai'],['저장 · 백업','data'],['단축키','keys']]){
      await section(name).click();

if(name==='AI')await dialog().getByRole('combobox',{name:'설정할 AI 제공자'}).waitFor();
      const box=await dialog().boundingBox(),overflow=await dialog().evaluate(el=>[el,...el.querySelectorAll('.settings-body,.settings-row')].some(n=>n.scrollWidth>n.clientWidth+1));
      assert(box.x>=0&&box.x+box.width<=width,`${palette}-${theme}-${width} ${name} inside`);assert(!overflow,`${palette}-${theme}-${width} ${name} no overflow`);
      layouts.push(`${palette}-${theme}-${width}-${name}`);
      await page.screenshot({path:resolve(output,`${file}-${palette}-${theme}-${width}.png`)});
    }

    await close();
  }

  assert.deepEqual(errors,[]);
  await writeFile(resolve(output,'summary.json'),JSON.stringify({layouts,saves},null,2));
  console.log(JSON.stringify({ok:true,layouts:layouts.length,saves}));
}catch(error){await page.screenshot({path:resolve(output,'failure.png')});console.error(errors);throw error;}
finally{await browser.close();}
