import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { XMLValidator } from 'fast-xml-parser';
import SparkMD5 from 'spark-md5';
import { readInterchange, prepareImport, exportInterchange, parseCsv } from '../src/lib/interchange';
import { seedWorkspace } from '../src/lib/seed';
import { uid, plainText, footnotes, wikiReferences, type RichNode } from '../src/lib/model';

const png=new Uint8Array([137,80,78,71,13,10,26,10,1,2,3]);
const asFile=(bytes:Blob|Uint8Array|string,name:string)=>new File([bytes instanceof Uint8Array?Uint8Array.from(bytes).buffer:bytes],name);
function allNodes(n:RichNode):RichNode[]{return[n,...(n.content||[]).flatMap(allNodes)];}

test('Notion 하위 페이지 ZIP의 서식·상대 링크·이미지와 CSV 행을 가져온다',async()=>{
  const zip=new JSZip();zip.file('연작/첫 장 abcdefabcdefabcdefabcdefabcdefab.md','# 첫 장\n\n**안녕** *세계*. [엔진](<설정/엔진.md>)\n\n![관측](<자료/별.png>)\n\n> 인용문\n\n- 목록 하나\n- 목록 둘\n\n문장[^1]\n\n[^1]: 각주 설명');zip.file('연작/설정/엔진.md','# 엔진\n\n관성 엔진 설정.');zip.file('연작/자료/별.png',png);zip.file('인물.csv','이름,설명\r\n"이서윤","첫 줄\n둘째 줄"\r\n"나","쉼표, 인용 ""하나"""');zip.file('첨부.pdf','unsupported');
  const bundle=await readInterchange([asFile(await zip.generateAsync({type:'blob'}),'Notion.zip')]);assert.equal(bundle.pages.length,3);assert.equal(bundle.assets.length,1);assert(bundle.warnings.some(w=>w.includes('첨부.pdf')));assert(bundle.warnings.some(w=>w.includes('관계')));
  const original=seedWorkspace(),before=JSON.stringify(original);const prepared=prepareImport(original,bundle,bundle.pages.map(p=>({key:p.key,title:p.title,kind:p.title==='엔진'?'wiki':'scene'})),{title:'가져온 작품',form:'장편'});
  assert.equal(JSON.stringify(original),before);assert.equal(prepared.state.works.length,original.works.length+1);const work=prepared.state.works.at(-1)!;const doc=work.documents[0];assert.equal(doc.title,'첫 장');assert(allNodes(doc.content).some(n=>n.marks?.some(m=>m.type==='bold')));assert.equal(footnotes(doc.content)[0].text,'각주 설명');assert.deepEqual(wikiReferences(doc.content),[work.documents[1].id]);assert.equal(doc.assetIds.length,1);assert(work.documents.every(d=>!d.isPublic));assert.equal(work.activePublicationId,null);assert(plainText(work.documents[2].content).includes('첫 줄\n둘째 줄'));
});

test('Evernote ENEX의 CDATA·태그·MD5 이미지·체크박스를 읽고 미지원 첨부를 알린다',async()=>{
  const hash=SparkMD5.ArrayBuffer.hash(png.buffer),data=Buffer.from(png).toString('base64');
  const xml=`<?xml version="1.0"?><!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd"><en-export><note><title>항해 &amp; 기록</title><content><![CDATA[<?xml version="1.0"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note><div><span style="font-weight: bold">기록</span><br/><en-todo checked="true"/>관측 완료</div><en-media type="image/png" hash="${hash}"/></en-note>]]></content><tag>kosmos:wiki</tag><tag>항해</tag><resource><data encoding="base64">${data}</data><mime>image/png</mime><resource-attributes><file-name>별.png</file-name></resource-attributes></resource><resource><data encoding="base64">AAAA</data><mime>application/pdf</mime><resource-attributes><file-name>자료.pdf</file-name></resource-attributes></resource></note></en-export>`;
  const bundle=await readInterchange([asFile(xml,'항해.enex')]);assert.equal(bundle.pages[0].title,'항해 & 기록');assert.equal(bundle.pages[0].kind,'wiki');assert(bundle.pages[0].summary.includes('항해'));assert(plainText(bundle.pages[0].content).includes('☑ 관측 완료'));assert(allNodes(bundle.pages[0].content).some(n=>n.marks?.some(m=>m.type==='bold')));assert.equal(bundle.assets.length,1);assert.deepEqual(new Uint8Array(await bundle.assets[0].blob.arrayBuffer()),png);assert(bundle.warnings.some(w=>w.includes('자료.pdf')));
});

for(const format of ['markdown','html'] as const)test(`${format} 교환 묶음을 다시 읽으면 각주·설정 링크·중복 제목·첨부를 보존한다`,async()=>{
  const state=seedWorkspace(),work=state.works[0];const imageId=uid();const blob=new Blob([png],{type:'image/png'});state.assets.push({id:imageId,workId:work.id,name:'자료.png',type:'image/png',size:png.length});work.documents[0].assetIds.push(imageId);work.documents[1].title=work.documents[0].title;
  const exported=await exportInterchange(work,work.documents.map(d=>d.id),state.assets,[{id:imageId,blob}],format);const bundle=await readInterchange([asFile(exported.blob,exported.name)]);assert.equal(bundle.pages.length,work.documents.length);assert.equal(bundle.assets.length,1);
  const prepared=prepareImport(state,bundle,bundle.pages.map(p=>({key:p.key,title:p.title,kind:p.kind})),{title:'다시 가져옴',form:'중편'});const copied=prepared.state.works.at(-1)!;assert.equal(footnotes(copied.documents[0].content)[0].text,footnotes(work.documents[0].content)[0].text);assert.equal(wikiReferences(copied.documents[0].content).length,wikiReferences(work.documents[0].content).length);assert(copied.documents.every(d=>!d.isPublic));assert.equal(copied.documents[0].assetIds.length,1);assert(copied.documents[0].id!==work.documents[0].id);
});

test('ENEX 내보내기는 선택 문서·태그·첨부 바이트를 전달하며 공개 판본을 포함하지 않는다',async()=>{
  const state=seedWorkspace(),work=state.works[0],id=uid(),blob=new Blob([png],{type:'image/png'});state.assets.push({id,workId:work.id,name:'별.png',type:'image/png',size:png.length});work.documents[0].assetIds.push(id);
  const out=await exportInterchange(work,[work.documents[0].id],state.assets,[{id,blob}],'enex'),xml=await out.blob.text();assert.equal(XMLValidator.validate(xml),true);assert(!xml.includes('activePublicationId'));assert(!xml.includes(work.documents[1].title));const bundle=await readInterchange([asFile(out.blob,out.name)]);assert.equal(bundle.pages.length,1);assert.equal(bundle.pages[0].kind,'scene');assert.equal(bundle.assets.length,1);assert.deepEqual(new Uint8Array(await bundle.assets[0].blob.arrayBuffer()),png);assert(plainText(bundle.pages[0].content).includes('각주'));
});

test('HTML은 실행 코드·추적 이미지·위험 링크를 제거하고 표를 보존하며 암호화 내용을 알린다',async()=>{
  const html='<html><head><script>비밀 실행</script></head><body><p onclick="bad()"><a href="javascript:alert(1)">표시</a><strong>굵게</strong><img src="https://tracker.example/image.png" alt="외부 이미지"></p><script>위험한 본문</script><iframe src="file:///secret">금지</iframe><en-crypt>암호화 원문</en-crypt><table><tr><th>열</th><td>값</td></tr></table></body></html>';
  const bundle=await readInterchange([asFile(html,'악성.html')]),serialized=JSON.stringify(bundle.pages[0].content);assert(!serialized.includes('javascript:'));assert(!serialized.includes('onclick'));assert(!serialized.includes('위험한 본문'));assert(!serialized.includes('암호화 원문'));assert(serialized.includes('굵게'));assert(bundle.warnings.some(w=>w.includes('암호화')));assert(allNodes(bundle.pages[0].content).some(n=>n.type==='tableHeader'));assert.equal(bundle.assets.length,0);
});

test('XML 엔티티·손상 XML·ZIP 경로 이탈·과도한 압축 해제·누락 첨부·잘못된 인코딩을 거절한다',async()=>{
  await assert.rejects(()=>readInterchange([asFile('<!DOCTYPE en-export [<!ENTITY attack SYSTEM "file:///secret">]><en-export/>','bad.enex')]),/엔티티/);
  await assert.rejects(()=>readInterchange([asFile('<en-export><note></en-export>','bad.enex')]),/XML/);
  const traversal=new JSZip();traversal.file('../escape.md','escape');await assert.rejects(()=>traversal.generateAsync({type:'blob'}).then(b=>readInterchange([asFile(b,'escape.zip')])),/경로/);
  const zip=new JSZip();zip.file('note.md','ok');const bomb=await zip.generateAsync({type:'uint8array',compression:'DEFLATE'});for(let i=0;i<bomb.length-28;i++)if(bomb[i]===80&&bomb[i+1]===75&&bomb[i+2]===1&&bomb[i+3]===2){new DataView(bomb.buffer).setUint32(i+24,101*1024*1024,true);break;}await assert.rejects(()=>readInterchange([asFile(bomb,'bomb.zip')]),/100MB/);
  await assert.rejects(()=>readInterchange([asFile(new Uint8Array([255,254,0]),'wrong.txt')]),/UTF-8/);
  const state=seedWorkspace();state.works[0].documents[0].assetIds.push(uid());await assert.rejects(()=>exportInterchange(state.works[0],[state.works[0].documents[0].id],[],[],'markdown'),/첨부/);
});

test('CSV의 인용 쉼표·줄바꿈·이스케이프를 읽고 닫히지 않은 따옴표를 거절한다',()=>{
  assert.deepEqual(parseCsv('이름,설명\r\n나,"쉼표, 줄\n인용 ""안녕"""'),[['이름','설명'],['나','쉼표, 줄\n인용 "안녕"']]);assert.throws(()=>parseCsv('a,"oops'),/따옴표/);
});
