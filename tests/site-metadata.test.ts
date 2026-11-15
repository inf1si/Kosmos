import assert from 'node:assert/strict';
import test from 'node:test';
import { seedWorkspace } from '../src/lib/seed';
import { libraryDescription, metaDescription, pageMetadata, plainMarkdown, searchIndexable, siteRobots, siteUrl, sitemapEntries, wikiDescription, workDescription } from '../src/lib/site-metadata';
import { countedPath, signedInBrowser } from '../src/lib/visit-scope';

const publication=()=>structuredClone(seedWorkspace().works[0]!.publications[0]!);

test('site address prefers the configured one, then the production domain', () => {
  assert.equal(siteUrl({NEXT_PUBLIC_SITE_URL:'https://example.org/path',VERCEL_PROJECT_PRODUCTION_URL:'a.vercel.app'}),'https://example.org');
  assert.equal(siteUrl({VERCEL_ENV:'production',VERCEL_PROJECT_PRODUCTION_URL:'a.vercel.app',VERCEL_URL:'a-123.vercel.app'}),'https://a.vercel.app');
  assert.equal(siteUrl({VERCEL_ENV:'preview',VERCEL_PROJECT_PRODUCTION_URL:'a.vercel.app',VERCEL_URL:'a-123.vercel.app'}),'https://a-123.vercel.app');
  assert.equal(siteUrl({NEXT_PUBLIC_SITE_URL:'not a url'}),'http://localhost:3210');
});

test('only the production deployment is open to search engines', () => {
  assert.equal(searchIndexable({VERCEL_ENV:'production',NODE_ENV:'production'}),true);
  assert.equal(searchIndexable({VERCEL_ENV:'preview',NODE_ENV:'production'}),false);
  assert.equal(searchIndexable({NODE_ENV:'development'}),false);
  assert.equal(searchIndexable({NODE_ENV:'production'}),true);
});

test('descriptions are one line within the limit', () => {
  assert.equal(metaDescription('  첫 줄\n\n둘째 줄  '),'첫 줄 둘째 줄');
  assert.equal(metaDescription(''),'');

  const long=metaDescription('가나다라 '.repeat(60));

  assert.ok(long.length<=150&&long.endsWith('…')&&!long.includes('  '));
  assert.equal(metaDescription('가'.repeat(200)).length,150);
  assert.equal(plainMarkdown('# 소개\n\n**굵은** 글과 [링크](https://example.com) ![그림](a.png)\n- 항목'),'소개\n\n굵은 글과 링크  \n항목');
});

test('a work is described by its description, then subtitle, then opening paragraphs', () => {
  const pub=publication();

  assert.equal(workDescription({...pub,description:'작품 소개',subtitle:'부제'}),'작품 소개');
  assert.equal(workDescription({...pub,description:' ',subtitle:'부제'}),'부제');

  const opening=workDescription({...pub,description:'',subtitle:''});

  assert.ok(opening.length>20&&opening.length<=150);
  assert.equal(workDescription({...pub,description:'',subtitle:'',scenes:[]}),'');
});

test('library and wiki descriptions list titles', () => {
  const pub=publication();

  assert.equal(libraryDescription([{...pub,title:'하나'},{...pub,title:'둘'}],'작가'),'작가의 서재. 「하나」 「둘」');
  assert.equal(libraryDescription([{...pub,title:'하나'}],''),'「하나」');
  assert.ok(libraryDescription([],'').length>0);
  assert.ok(wikiDescription({...pub,title:'하나'}).startsWith('「하나」 설정집. '));
});

test('page metadata carries its own canonical address and preview', () => {
  const reading=pageMetadata({title:'하나',description:'소개',path:'/read/x',article:{publishedTime:'2026-05-01T00:00:00.000Z',author:'작가'}});

  assert.deepEqual(reading.alternates,{canonical:'/read/x'});
  assert.equal(reading.robots,undefined);
  assert.deepEqual(reading.openGraph,{title:'하나',description:'소개',url:'/read/x',siteName:'Orbis Tertius',locale:'ko_KR',type:'article',publishedTime:'2026-05-01T00:00:00.000Z',authors:['작가']});
  assert.deepEqual(siteRobots({VERCEL_ENV:'preview'}),{index:false,follow:false});
  assert.deepEqual(siteRobots({VERCEL_ENV:'production'}),{index:true,follow:true});

  const library=pageMetadata({title:'서재',description:'소개',path:'/library'});

  assert.deepEqual(library.openGraph?.images,[{url:'/opengraph-image',width:1200,height:630,alt:'Orbis Tertius'}]);
  assert.deepEqual(pageMetadata({description:'소개',path:'/wiki/x',index:false}).robots,{index:false,follow:false});
});

test('sitemap lists public pages, each work and only wikis that have entries', () => {
  const pub=publication(),first={...pub,workId:'30000000-0000-4000-8000-000000000001',publishedAt:'2026-05-01T03:00:00.000Z'},second={...pub,workId:'30000000-0000-4000-8000-000000000002',publishedAt:'not a date',wiki:[]};
  const entries=sitemapEntries([first,second],'https://example.org');

  assert.deepEqual(entries.map(entry=>entry.url),['https://example.org/','https://example.org/library','https://example.org/about',`https://example.org/read/${first.workId}`,...(first.wiki.length?[`https://example.org/wiki/${first.workId}`]:[]),`https://example.org/read/${second.workId}`]);
  assert.deepEqual(entries[1]!.lastModified,new Date('2026-05-01T03:00:00.000Z'));
  assert.equal(entries[entries.length-1]!.lastModified,undefined);
  assert.ok(!entries.some(entry=>/studio|privacy|api/.test(entry.url)));
});

test('visits are counted on public pages from browsers without a studio sign-in', () => {
  for(const path of ['/','/library','/read/x','/wiki/x','/about','/privacy','/studious'])assert.equal(countedPath(path),true,path);

  for(const path of ['/studio','/studio/x','/auth/callback','/api/books'])assert.equal(countedPath(path),false,path);

  const storage=(keys:string[])=>()=>({length:keys.length,key:(index:number)=>keys[index]??null});

  assert.equal(signedInBrowser(storage(['kosmos-theme','sb-abcdefgh-auth-token'])),true);
  assert.equal(signedInBrowser(storage(['kosmos-theme','sb-abcdefgh-auth-token-code-verifier'])),false);
  assert.equal(signedInBrowser(()=>{throw new Error('blocked');}),false);
});
