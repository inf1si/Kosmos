import { test } from 'node:test';
import assert from 'node:assert/strict';
import { googleDriveStorage } from '../src/lib/google-drive-backup';
import { uid } from '../src/lib/model';
test('Drive는 OAuth 갱신·자체 폴더·재개 가능 업로드·실제 바이트 읽기를 사용한다',async()=>{
  const calls:{url:string;init:RequestInit}[]=[];const bytes=new Uint8Array([1,2,3]);let fileNum=0;
  const fake=async(input:RequestInfo|URL,init:RequestInit={})=>{const url=String(input);calls.push({url,init});if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'access',scope:'https://www.googleapis.com/auth/drive.file'});if(url.includes('/files?')&&url.includes('q='))return Response.json({files:[]});if(url.includes('uploadType=resumable'))return new Response('',{headers:{location:'https://www.googleapis.com/upload/drive/v3/files?upload_id=session'}});if(init.method==='PUT')return Response.json({id:`file-${++fileNum}`});if(init.method==='POST')return Response.json({id:'folder-id'});if(url.includes('alt=media'))return new Response(bytes);throw new Error(`Unexpected ${url}`);};
  const storage=googleDriveStorage({clientId:'client',clientSecret:'secret',refreshToken:'refresh',authorId:uid(),prefix:'kosmos'},AbortSignal.timeout(5000),fake as typeof fetch);
  await storage.write('kosmos/owner/archive.zip',bytes,'application/zip');assert.deepEqual(await storage.read('kosmos/owner/archive.zip',100),bytes);await storage.write('kosmos/owner/latest.json',bytes,'application/json');
  assert.equal(calls.filter(c=>c.url==='https://oauth2.googleapis.com/token').length,1);assert.equal(calls.filter(c=>String(c.init.body).includes('application/vnd.google-apps.folder')).length,1);assert(calls.every(c=>!['DELETE'].includes(c.init.method||'GET')));assert(calls.every(c=>!c.url.includes('secret')&&!c.url.includes('refresh')));
  const start=calls.find(c=>c.url.includes('uploadType=resumable'))!;const meta=JSON.parse(String(start.init.body));assert.deepEqual(meta.parents,['folder-id']);assert.equal(meta.appProperties.kosmosKey.length,64);assert(!JSON.stringify(calls).includes('/permissions'));
});
test('Drive 저장 실패·위험한 업로드 주소·과도한 다운로드를 거절한다',async()=>{
  const config={clientId:'client',clientSecret:'secret',refreshToken:'refresh',authorId:uid(),prefix:'kosmos'};
  const fake=async(input:RequestInfo|URL,init:RequestInit={})=>{const url=String(input);if(url.includes('/token'))return Response.json({access_token:'access'});if(url.includes('q='))return Response.json({files:[]});if(url.includes('uploadType'))return new Response('',{headers:{location:'https://attacker.example/upload'}});if(init.method==='POST')return Response.json({id:'folder'});throw new Error();};
  await assert.rejects(()=>googleDriveStorage(config,AbortSignal.timeout(5000),fake as typeof fetch).write('archive',new Uint8Array([1]),'application/zip'),/안전/);
  await assert.rejects(()=>googleDriveStorage(config,AbortSignal.timeout(5000),(async()=>new Response('quota',{status:403})) as typeof fetch).write('archive',new Uint8Array([1]),'application/zip'),/갱신/);
  const tooLarge=async(input:RequestInfo|URL)=>String(input).includes('/token')?Response.json({access_token:'access'}):String(input).includes('q=')?Response.json({files:[{id:'file-id'}]}):new Response(new Uint8Array(20));await assert.rejects(()=>googleDriveStorage(config,AbortSignal.timeout(5000),tooLarge as typeof fetch).read('archive',10),/초과/);
});
