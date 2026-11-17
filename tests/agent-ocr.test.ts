import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument,StandardFonts } from 'pdf-lib';
import { uid,plainText } from '../src/lib/model';
import { transcribeType } from '../src/lib/agent-transcribe';
import { pdfParts } from '../src/lib/pdf-transcribe';
import { readInterchange } from '../src/lib/interchange';
import { writingAgentTools } from '../src/lib/agent-tools';

async function samplePdf(pages:number){
  const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica);

  for(let i=0;i<pages;i++)doc.addPage([300,400]).drawText(`page ${i+1}`,{x:40,y:300,size:18,font});

  return doc.save();
}

test('글자 읽기는 파일의 첫 바이트로 PDF와 이미지 형식을 가린다',()=>{
  assert.equal(transcribeType(new TextEncoder().encode('%PDF-1.7\n')),'application/pdf');
  assert.equal(transcribeType(Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0])),'image/png');
  assert.equal(transcribeType(Uint8Array.from([0xff,0xd8,0xff,0xe0])),'image/jpeg');
  assert.equal(transcribeType(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ')),'image/webp');
  assert.equal(transcribeType(new TextEncoder().encode('<html>%PDF-')),null);
});

test('PDF는 몇 쪽씩 나뉘고, 크기를 넘는 묶음은 반씩 줄인다',async()=>{
  const bytes=await samplePdf(9),parts=await pdfParts(bytes,'자료.pdf');
  assert.deepEqual(parts.map(p=>[p.from,p.to]),[[1,4],[5,8],[9,9]]);

  for(const part of parts)assert.equal((await PDFDocument.load(part.bytes)).getPageCount(),part.to-part.from+1);
  // Under a limit only single pages meet, each four-page part is halved until it fits, and the pages stay in order.
  const limit=Math.max(...(await pdfParts(bytes,'자료.pdf',1)).map(p=>p.bytes.length)),halved=await pdfParts(bytes,'자료.pdf',4,limit);
  assert(halved.length>parts.length);assert(halved.every(p=>p.bytes.length<=limit));
  assert.deepEqual(halved.flatMap(p=>Array.from({length:p.to-p.from+1},(_,i)=>p.from+i)),Array.from({length:9},(_,i)=>i+1));
  await assert.rejects(pdfParts(bytes,'자료.pdf',4,10),/1쪽이 너무 커서/);
  await assert.rejects(pdfParts(new TextEncoder().encode('%PDF-broken'),'깨진.pdf'),/깨진\.pdf: PDF 파일을 열지 못했습니다/);
});

test('노트 가져오기는 PDF를 읽은 글로 노트 하나를 만들고, 읽는 방법이 없으면 건너뛴다',async()=>{
  const pdf=new File([Uint8Array.from(await samplePdf(2)).buffer],'관측 기록.pdf'),seen:string[]=[];

  const bundle=await readInterchange([pdf,new File(['다른 메모'],'메모.txt')],{pdf:async(bytes,name)=>{seen.push(name);assert.equal(transcribeType(bytes),'application/pdf');

return {text:'첫 쪽 글.\n\n둘째 쪽 글.',warnings:['관측 기록.pdf 1–2쪽: 글이 길어 일부만 옮겼습니다.']};}});

  assert.deepEqual(seen,['관측 기록.pdf']);
  const page=bundle.pages.find(p=>p.key==='관측 기록.pdf')!;
  assert.equal(page.title,'관측 기록');assert.equal(page.kind,'memo');
  assert.equal(page.content.content?.length,2);assert.equal(plainText(page.content).replace(/\s+/g,' ').trim(),'첫 쪽 글. 둘째 쪽 글.');
  assert(bundle.warnings.some(w=>w.includes('일부만 옮겼습니다')));

  const without=await readInterchange([pdf,new File(['다른 메모'],'메모.txt')]);
  assert.deepEqual(without.pages.map(p=>p.key),['메모.txt']);assert(without.warnings.some(w=>w.startsWith('관측 기록.pdf: 지원하지 않는 파일')));
});

test('에이전트는 Gemini 연결이 있을 때만 첨부 이미지를 읽는 도구를 받는다',()=>{
  assert('readImage' in writingAgentTools(uid(),'wf','discuss',false,false,true));
  assert(!('readImage' in writingAgentTools(uid(),'wf','discuss',false,false)));
});
