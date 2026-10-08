// Run with tsx. All author reads/writes are intercepted using synthetic publications.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { seedWorkspace } from '../../src/lib/seed.ts';
import { makePublication, newDocument, uid, workspaceSchema } from '../../src/lib/model.ts';
import { applyNavigation, resolveNavigation } from '../../src/lib/document-navigation.ts';
import { libraryItemSchema, sortPublications } from '../../src/lib/library-order.ts';

const require=createRequire(import.meta.url),{chromium}=require(process.env.KOSMOS_PLAYWRIGHT_MODULE||'playwright-core');

const base=process.env.KOSMOS_TEST_BASE_URL||'http://127.0.0.1:3210',output=resolve(process.env.KOSMOS_BROWSER_OUTPUT||'test-results/library-order-drag');

await mkdir(output,{recursive:true});

const data=seedWorkspace();

while(data.works.length<12)data.works.push({...structuredClone(data.works[1]),id:uid(),documents:[newDocument('scene','합성 원고')],publications:[],activePublicationId:null});

data.works=data.works.map((work,i)=>{
    const title=`합성 작품 ${String(i+1).padStart(2,'0')}${i===0?'가'.repeat(180):''}`,p=makePublication({...work,title},[work.documents.find(d=>d.kind==='scene').id]);
    p.libraryPosition=i+1;p.publishedAt=`2026-10-${String(12-i).padStart(2,'0')}T00:00:00Z`;

    return applyNavigation({...work,title,publications:[p],activePublicationId:p.id},resolveNavigation(work));
});

workspaceSchema.parse(data);

let publications=data.works.map(w=>structuredClone(w.publications[0])),writes=0,failSave=false,holdSave=false,releaseSave;

const authorItems=()=>sortPublications(publications).map(p=>libraryItemSchema.parse(p));

const original=authorItems().map(p=>p.id),errors=[];

const browser=await chromium.launch({executablePath:process.env.KOSMOS_CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});

const context=await browser.newContext({viewport:{width:1280,height:900},hasTouch:true});

const profile={id:'11111111-1111-4111-8111-111111111111',aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',created_at:'2026-10-04T00:00:00.000Z',app_metadata:{provider:'email',providers:['email']},user_metadata:{},identities:[]};

const enc=value=>Buffer.from(JSON.stringify(value)).toString('base64url'),token=`${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:profile.id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})}.synthetic-signature`;

await context.addInitScript(({profile,token,key})=>localStorage.setItem(key,JSON.stringify({access_token:token,refresh_token:'synthetic-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:profile})),{profile,token,key:process.env.KOSMOS_TEST_AUTH_STORAGE_KEY||'sb-krakjollsufgnwealroh-auth-token'});

await context.route('**/*.supabase.co/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;let value={};

    if(path.includes('/auth/v1/user'))value=profile;
    else if(path.endsWith('/authors'))value={user_id:profile.id};
    else if(path.endsWith('/workspaces'))value={id:data.id,payload:data,version:1};
    else if(path.endsWith('/get_author_library'))value=authorItems();
    else if(path.endsWith('/set_library_order')){
        const ids=request.postDataJSON().p_publication_ids;writes++;
        assert.deepEqual([...ids].sort(),[...authorItems().map(p=>p.id)].sort());

        if(holdSave)await new Promise(resolve=>{releaseSave=resolve;});

        if(failSave){await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({message:'합성 저장 실패',code:'P0001'})});

return;}

        publications=ids.map((id,i)=>({...publications.find(p=>p.id===id),libraryPosition:i+1}));value=authorItems();
    }else if(path.endsWith('/save_workspace'))throw new Error('순서 편집은 원고 작업 공간을 저장하지 않아야 합니다.');

    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
});

await context.route('**/api/backup/**',route=>route.fulfill({status:200,contentType:'application/json',body:'{"connected":false,"configured":false}'}));

if(context.routeWebSocket)await context.routeWebSocket('**/realtime/**',ws=>ws.close());

const page=await context.newPage(),cdp=await context.newCDPSession(page);

page.setDefaultTimeout(15000);

page.on('pageerror',e=>errors.push(e.message));

const button=name=>page.getByRole('button',{name,exact:true}),dialog=()=>page.getByRole('dialog',{name:'서재 순서 편집',exact:true});

const rows=()=>dialog().locator('[data-library-id]'),row=id=>dialog().locator(`[data-library-id="${id}"]`),grip=id=>row(id).locator('.library-order-grip');

const order=()=>rows().evaluateAll(elements=>elements.map(el=>el.dataset.libraryId));

async function until(check){for(let i=0;i<60&&!await check();i++)await page.waitForTimeout(50);assert(await check());}

async function open(){await button('서재 순서 편집').click();await dialog().locator('.library-order-row').first().waitFor();}

async function close(){await dialog().getByRole('button',{name:'닫기',exact:true}).click();await dialog().waitFor({state:'hidden'});await until(async()=>await button('서재 순서 편집').evaluate(el=>el===document.activeElement));}

async function reset(){if(await button('저장된 순서로').isEnabled())await button('저장된 순서로').click();}

async function begin(id,target,edge='after',touch=false){
    await grip(id).scrollIntoViewIfNeeded();
    const from=await grip(id).boundingBox(),to=await row(target).boundingBox(),x=from.x+from.width/2,y=from.y+from.height/2,point={x:to.x+to.width/2,y:edge==='before'?to.y+5:to.y+to.height-5};

    if(touch){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point]});}
    else{await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(point.x,point.y,{steps:8});}

    await until(async()=>await row(target).getAttribute('data-drop-edge')===edge);
}

async function end(touch=false){if(touch)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await page.mouse.up();await until(async()=>await page.locator('.library-order-ghost').count()===0);}

try{
    await page.goto(`${base}/studio`,{waitUntil:'domcontentloaded'});await page.locator('.studio-home').waitFor();await open();
    assert.equal(await grip(original[0]).count(),1,'작품 순서를 끌어 바꿀 손잡이가 필요합니다.');
    assert.equal(await grip(original[0]).evaluate(el=>getComputedStyle(el).touchAction),'none');
    await begin(original[0],original[2],'after');await end();
    assert.deepEqual((await order()).slice(0,4),[original[1],original[2],original[0],original[3]]);
    assert(await grip(original[0]).evaluate(el=>el===document.activeElement));assert.equal(writes,0);await reset();
    await begin(original[2],original[0],'before');await end();assert.deepEqual((await order()).slice(0,4),[original[2],original[0],original[1],original[3]]);await reset();
    await grip(original[0]).click();assert.deepEqual(await order(),original);
    await begin(original[0],original[2]);await page.keyboard.press('Escape');await end();assert(await dialog().isVisible());assert.deepEqual(await order(),original);
    await begin(original[0],original[2]);const bounds=await dialog().locator('.library-order-list').boundingBox();await page.mouse.move(bounds.x+bounds.width+30,bounds.y+80);await end();assert.deepEqual(await order(),original);
    await grip(original[0]).focus();await page.keyboard.press('ArrowDown');assert.deepEqual((await order()).slice(0,3),[original[1],original[0],original[2]]);await page.keyboard.press('ArrowUp');assert.deepEqual(await order(),original);
    await row(original[0]).getByRole('button',{name:/아래로$/}).click();await reset();

    for(const sort of ['titleAsc','titleDesc','newest','oldest']){await dialog().getByLabel('자동 정렬 기준').selectOption(sort);await button('자동 정렬').click();assert.deepEqual(await order(),sortPublications(publications,sort).map(p=>p.id));await reset();}

    console.log('PASS mouse both directions, cancel, outside, focus, keyboard and automatic sort');

    await page.setViewportSize({width:360,height:850});await begin(original[0],original[2],'after',true);await end(true);assert.deepEqual((await order()).slice(0,4),[original[1],original[2],original[0],original[3]]);await reset();
    await begin(original[0],original[2],'after',true);await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await until(async()=>await page.locator('.library-order-ghost').count()===0);assert.deepEqual(await order(),original);
    console.log('PASS emulated touch drag and pointer cancellation');

    await page.setViewportSize({width:1280,height:900});
    await grip(original[0]).scrollIntoViewIfNeeded();const from=await grip(original[0]).boundingBox(),list=await dialog().locator('.library-order-list').boundingBox();
    await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(list.x+list.width/2,list.y+list.height-7,{steps:8});
    await until(async()=>await dialog().locator('.library-order-list').evaluate(el=>el.scrollTop)>150);
    const target=await dialog().locator('[data-drop-edge]').getAttribute('data-library-id');await end();assert((await order()).indexOf(original[0])>2);assert(target);await reset();
    console.log('PASS continuous edge scrolling');

    await close();

    for(const width of [1280,360])for(const palette of ['보라','카세트','사이버'])for(const dark of [false,true]){
        await page.setViewportSize({width,height:850});

        if(!await button(`${palette} 테마`).isVisible())await button('사이드바 열기').click();
        await button(`${palette} 테마`).click();

        if((await page.locator('html').getAttribute('data-theme')==='dark')!==dark)await button(dark?'다크 모드로 전환':'라이트 모드로 전환').click();

        if(width===360)await page.locator('.studio-sidebar .sidebar-close button').click();
        await open();await begin(original[0],original[2]);
        assert(await button('서재 순서 저장').isDisabled());

        const marker=await row(original[2]).evaluate(el=>{const s=getComputedStyle(el,'::after');

return {height:s.height,content:s.content,color:s.backgroundColor};});

assert.equal(marker.height,'2px');assert.notEqual(marker.content,'none');
        assert(await page.locator('.library-order-ghost').evaluate(el=>{const r=el.getBoundingClientRect();

return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}));
        assert.equal(await page.getByRole('tooltip').count(),0,'드래그 중 툴팁이 목록을 가리지 않아야 합니다.');
        assert(await dialog().evaluate(el=>el.scrollWidth<=el.clientWidth));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        await page.screenshot({path:resolve(output,`drag-${width}-${palette}-${dark?'dark':'light'}.png`)});await end();assert.deepEqual((await order()).slice(0,3),[original[1],original[2],original[0]]);
        await reset();await close();console.log('PASS layout and drag',width,palette,dark?'dark':'light');
    }

    await page.setViewportSize({width:1280,height:900});await open();await begin(original[0],original[2]);await end();const edited=await order();
    failSave=true;await button('서재 순서 저장').click();await dialog().getByRole('alert').waitFor();assert.deepEqual(await order(),edited);assert.deepEqual(authorItems().map(p=>p.id),original);
    failSave=false;holdSave=true;await button('서재 순서 저장').click();await until(()=>!!releaseSave);assert(await grip(original[0]).isDisabled());assert(await button('자동 정렬').isDisabled());releaseSave();holdSave=false;
    await until(async()=>await button('서재 순서 저장').isDisabled()&&authorItems().map(p=>p.id).join()===edited.join());
    assert.deepEqual(publications.map(p=>({...p,libraryPosition:undefined})).sort((a,b)=>a.id.localeCompare(b.id)),data.works.map(w=>({...w.publications[0],libraryPosition:undefined})).sort((a,b)=>a.id.localeCompare(b.id)));
    await close();assert(await button('서재 순서 편집').evaluate(el=>el===document.activeElement));await page.reload({waitUntil:'domcontentloaded'});await page.locator('.studio-home').waitFor();await open();assert.deepEqual(await order(),edited);
    await begin(edited[0],edited[2]);await end();await close();await open();assert.deepEqual(await order(),edited);await close();
    console.log('PASS save failure, busy lock, metadata preservation, reload and close discard');

    publications=[publications[0]];await open();assert.equal(await rows().count(),1);assert(await grip(publications[0].id).isDisabled());await close();publications=[];await button('서재 순서 편집').click();await dialog().getByText('게시된 작품이 없습니다.',{exact:true}).waitFor();assert(await button('자동 정렬').isDisabled());assert(await button('서재 순서 저장').isDisabled());
    assert.deepEqual(errors,[]);console.log('PASS single/empty boundaries and page errors 0');
}finally{await browser.close();}
