import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { readInterchange } from '../src/lib/interchange';
import { prepareNoteImport } from '../src/lib/personal-notes';
import { resolveNoteNavigation } from '../src/lib/note-navigation';
import { plainText, footnotes, wikiReferences, type RichNode } from '../src/lib/model';
import { seedWorkspace } from '../src/lib/seed';

const png=new Uint8Array([137,80,78,71,13,10,26,10,1,2,3]);

const asFile=(bytes:Blob|Uint8Array|string,name:string)=>new File([bytes instanceof Uint8Array?Uint8Array.from(bytes).buffer:bytes],name);

const fixture=(name:string)=>asFile(readFileSync(new URL(`./fixtures/note-import/${name}`,import.meta.url)),name);

const all=(n:RichNode):RichNode[]=>[n,...(n.content||[]).flatMap(all)];

const types=(n:RichNode)=>all(n).map(v=>v.type);

/** Folder/note titles as an indented outline under the import folder, to compare whole trees at once. */
function outline(state:ReturnType<typeof prepareNoteImport>['state'],rootId:string){
  const nav=resolveNoteNavigation(state),title=(id:string)=>{const n=nav.nodes.find(v=>v.id===id)!;

return n.type==='folder'?`[${n.title}]`:state.notes!.find(v=>v.id===id)!.title;};

  const walk=(id:string,depth:number):string[]=>nav.nodes.filter(n=>n.parentId===id).flatMap(n=>[`${'  '.repeat(depth)}${title(n.id)}`,...walk(n.id,depth+1)]);

  return walk(rootId,0);
}

test('python-docx로 만든 Word 문서의 제목·서식·스타일 목록·정렬·표·이미지를 노트로 가져온다',async()=>{
  const bundle=await readInterchange([fixture('voyage.docx')]),page=bundle.pages[0];
  assert.equal(bundle.pages.length,1);assert.equal(page.title,'항해 구상');assert.equal(bundle.assets.length,1);assert.deepEqual(bundle.warnings,[]);
  const nodes=all(page.content);
  assert(nodes.some(n=>n.type==='heading'&&n.attrs?.level===2&&plainText(n)==='인물'));
  assert(nodes.some(n=>n.marks?.some(m=>m.type==='bold')&&n.text==='굵은 글'));assert(nodes.some(n=>n.marks?.some(m=>m.type==='italic')&&n.text==='기울인 글'));
  assert.equal(plainText(nodes.find(n=>n.type==='bulletList')!),'이서윤 — 항해사\n\n나 — 관측자');assert.equal(plainText(nodes.find(n=>n.type==='orderedList')!),'첫째 할 일\n\n둘째 할 일');
  assert.equal(nodes.find(n=>n.type==='paragraph'&&plainText(n)==='가운데 줄')?.attrs?.textAlign,'center');
  assert.equal(nodes.filter(n=>n.type==='tableCell').map(plainText).join('|'),'항목|값|속도|12노트');
  const prepared=prepareNoteImport(seedWorkspace(),bundle,'Word'),note=prepared.state.notes![0];
  assert(types(note.content).includes('noteImage'));assert.equal(prepared.assets.length,1);assert.equal(prepared.assets[0].blob.type,'image/png');
});

test('Word 각주·외부 링크·삭제 표시·세로 병합 칸과 Word 체크박스를 읽는다',async()=>{
  const w='xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const zip=new JSZip();
  zip.file('word/document.xml',`<?xml version="1.0"?><w:document ${w}><w:body><w:p><w:r><w:t xml:space="preserve">본문 </w:t></w:r><w:hyperlink r:id="rLink"><w:r><w:t>사이트</w:t></w:r></w:hyperlink><w:del><w:r><w:delText>지운 글</w:delText></w:r></w:del><w:r><w:footnoteReference w:id="2"/></w:r></w:p><w:p><w:r><w:t>☒ 끝낸 일</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>병합</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>위</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:p><w:r><w:t>아래</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`);
  zip.file('word/_rels/document.xml.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rLink" Type="hyperlink" Target="https://example.com/a" TargetMode="External"/></Relationships>');
  zip.file('word/footnotes.xml',`<?xml version="1.0"?><w:footnotes ${w}><w:footnote w:type="separator" w:id="0"><w:p/></w:footnote><w:footnote w:id="2"><w:p><w:r><w:t>각주 설명</w:t></w:r></w:p></w:footnote></w:footnotes>`);
  const bundle=await readInterchange([asFile(await zip.generateAsync({type:'uint8array'}),'짧은 글.docx')]),content=bundle.pages[0].content,nodes=all(content);
  assert.equal(bundle.pages[0].title,'짧은 글');assert(!plainText(content).includes('지운 글'));assert.equal(footnotes(content)[0].text,'각주 설명');
  assert(nodes.some(n=>n.text==='사이트'&&n.marks?.some(m=>m.type==='link'&&m.attrs?.href==='https://example.com/a')));
  const cells=nodes.filter(n=>n.type==='tableCell');assert.deepEqual(cells.map(plainText),['병합','위','아래']);assert.equal(cells[0].attrs?.rowspan,2);
  const note=prepareNoteImport(seedWorkspace(),bundle,'Word').state.notes![0];assert.deepEqual(all(note.content).filter(n=>n.type==='taskItem').map(n=>n.attrs?.checked),[true]);
});

test('RTF의 EUC-KR 바이트·유니코드·서식·정렬·각주를 읽고 그림은 알린다',async()=>{
  const hex="\\'c7\\'d1\\'b1\\'db\\'20\\'b9\\'ae\\'b4\\'dc"; // '한글 문단' in EUC-KR
  const rtf=`{\\rtf1\\ansi\\ansicpg949\\deff0{\\fonttbl{\\f0\\fnil\\fcharset129 Gulim;}}{\\*\\generator Riched20;}\\uc1\\pard\\qc\\b ${hex}\\b0\\par\\pard Word \\i italic\\i0  and \\u54620?\\u44544? text{\\super\\chftn}{\\footnote\\pard\\plain{\\super\\chftn} \\u44033?\\u51452? note}.\\line next\\par{\\pict\\pngblip 89504e47}\\par}`;
  const bundle=await readInterchange([asFile(Uint8Array.from(rtf,c=>c.charCodeAt(0)),'메모.rtf')]),content=bundle.pages[0].content,nodes=all(content);
  assert.equal(bundle.pages[0].title,'메모');assert(nodes.some(n=>n.text==='한글 문단'&&n.marks?.some(m=>m.type==='bold')));
  assert.equal(nodes.find(n=>n.type==='paragraph')?.attrs?.textAlign,'center');assert(plainText(content).includes('and 한글 text'));
  assert.equal(footnotes(content)[0].text,'각주 note');assert(types(content).includes('hardBreak'));assert(bundle.warnings.some(w=>w.includes('그림')));
});

test('한글 HWP 5.0 본문 구역을 압축 해제해 문단·줄바꿈을 읽고 표를 알린다',async()=>{
  const bundle=await readInterchange([fixture('memo.hwp')]),text=plainText(bundle.pages[0].content);
  assert.equal(bundle.pages[0].title,'memo');assert(text.startsWith('항해 구상\n\n첫 문단입니다. 줄\n바꿈'));assert(text.includes('표 칸 하나'));
  // Section1 is larger than the 4KB mini-stream cutoff, so it is read through the regular FAT.
  assert(text.includes('둘째 구역 400 '));assert(bundle.warnings.some(w=>w.includes('표')));
});

test('한글 HWP는 암호 문서와 이전 형식을 거절한다',async()=>{
  const bytes=new Uint8Array(readFileSync(new URL('./fixtures/note-import/memo.hwp',import.meta.url)));
  await assert.rejects(readInterchange([asFile(new Uint8Array(600),'옛 문서.hwp')]),/hwpx로 저장/);
  // Flip the password bit of FileHeader's properties (offset 36) inside the compound file.
  const signature=new TextEncoder().encode('HWP Document File'),at=bytes.findIndex((_,i)=>signature.every((b,j)=>bytes[i+j]===b));bytes[at+36]|=2;
  await assert.rejects(readInterchange([asFile(bytes,'잠긴 문서.hwp')]),/암호/);
});

test('한글 HWPX의 문단·줄바꿈·표 병합·그림을 읽는다',async()=>{
  const ns='xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core"';
  const zip=new JSZip();zip.file('mimetype','application/hwp+zip');
  zip.file('Contents/section0.xml',`<?xml version="1.0" encoding="UTF-8"?><hs:sec ${ns}><hp:p><hp:run><hp:secPr/><hp:t>첫 줄<hp:lineBreak/>둘째 줄</hp:t></hp:run></hp:p><hp:p><hp:run><hp:tbl><hp:tr><hp:tc><hp:subList><hp:p><hp:run><hp:t>넓은 칸</hp:t></hp:run></hp:p></hp:subList><hp:cellSpan colSpan="2" rowSpan="1"/></hp:tc></hp:tr></hp:tbl></hp:run></hp:p><hp:p><hp:run><hp:pic><hc:img binaryItemIDRef="image1"/></hp:pic></hp:run></hp:p></hs:sec>`);
  zip.file('Contents/section1.xml',`<?xml version="1.0" encoding="UTF-8"?><hs:sec ${ns}><hp:p><hp:run><hp:t>다음 구역</hp:t></hp:run></hp:p></hs:sec>`);
  zip.file('BinData/image1.png',png);
  const bundle=await readInterchange([asFile(await zip.generateAsync({type:'uint8array'}),'설정.hwpx')]),content=bundle.pages[0].content,nodes=all(content);
  assert.equal(bundle.pages[0].title,'설정');assert(types(content).includes('hardBreak'));assert.equal(nodes.find(n=>n.type==='tableCell')?.attrs?.colspan,2);
  assert(plainText(content).endsWith('다음 구역'));assert.equal(bundle.assets.length,1);
  assert(types(prepareNoteImport(seedWorkspace(),bundle,'한글').state.notes![0].content).includes('noteImage'));
});

test('EPUB은 목차 순서의 장마다 노트가 되고 장 사이 링크와 그림을 유지한다',async()=>{
  const bundle=await readInterchange([fixture('sea.epub')]);
  assert.deepEqual(bundle.pages.map(p=>p.title),['1장 출항','2장 폭풍']);assert.equal(bundle.assets.length,1);
  const prepared=prepareNoteImport(seedWorkspace(),bundle,'바다의 책'),[first,second]=prepared.state.notes!;
  assert.deepEqual(wikiReferences(first.content),[second.id]);assert(types(first.content).includes('noteImage'));
  assert.deepEqual(outline(prepared.state,prepared.folderId),['1장 출항','2장 폭풍']);
});

test('스크리브너 프로젝트는 바인더 순서·하위 문서·시놉시스를 유지하고 휴지통을 건너뛴다',async()=>{
  const zip=new JSZip(),root='소설.scriv/';
  const item=(id:string,title:string,type='Text',children='')=>`<BinderItem UUID="${id}" Type="${type}"><Title>${title}</Title>${children?`<Children>${children}</Children>`:''}</BinderItem>`;
  zip.file(`${root}소설.scrivx`,`<?xml version="1.0" encoding="UTF-8"?><ScrivenerProject><Binder>${item('D','원고','DraftFolder',item('C1','1장','Folder',item('S1','출항')+item('S2','폭풍')))}${item('R','자료','ResearchFolder',item('P','지도','Image'))}${item('T','휴지통','TrashFolder',item('X','버린 장면'))}</Binder></ScrivenerProject>`);
  const rtf=(text:string)=>`{\\rtf1\\ansi\\uc1 ${[...text].map(c=>c.charCodeAt(0)>127?`\\u${c.charCodeAt(0)}?`:c).join('')}\\par}`;
  zip.file(`${root}Files/Data/S1/content.rtf`,rtf('배가 떠났다.'));zip.file(`${root}Files/Data/S1/synopsis.txt`,'출항 요약');zip.file(`${root}Files/Data/S2/content.rtf`,rtf('바람이 분다.'));
  zip.file(`${root}Files/Data/X/content.rtf`,rtf('버린 글'));zip.file(`${root}Files/Data/P/content.png`,png);zip.file(`${root}Files/search.indexes`,'<x/>');
  const bundle=await readInterchange([asFile(await zip.generateAsync({type:'uint8array'}),'소설.zip')]);
  assert.deepEqual(bundle.pages.map(p=>p.title),['원고','1장','출항','폭풍','자료','지도']);assert(!bundle.warnings.some(w=>w.includes('search.indexes')));
  const prepared=prepareNoteImport(seedWorkspace(),bundle,'소설');
  assert.deepEqual(outline(prepared.state,prepared.folderId),['원고','  1장','    출항','    폭풍','자료','  지도']);
  const scene=prepared.state.notes!.find(n=>n.title==='출항')!;assert.equal(plainText(scene.content),'출항 요약\n\n배가 떠났다.');assert(!prepared.state.notes!.some(n=>n.title==='버린 장면'));
  assert(types(prepared.state.notes!.find(n=>n.title==='지도')!.content).includes('noteImage'));
});

test('Notion의 ZIP 속 ZIP과 하위 페이지 폴더를 노트 계층으로, 페이지 링크를 노트 링크로 옮긴다',async()=>{
  const part=new JSZip(),id='abcdefabcdefabcdefabcdefabcdefab',id2='0123456789abcdef0123456789abcdef';
  part.file(`세계관 ${id}.md`,`# 세계관\n\n[항구 도시](<세계관 ${id}/항구 ${id2}.md>)를 본다.`);part.file(`세계관 ${id}/항구 ${id2}.md`,'# 항구\n\n짠 바람.');part.file('자료/표 abcdefabcdefabcdefabcdefabcdefab.csv','이름,값\n바람,세다');
  const outer=new JSZip();outer.file('Export-1234-Part-1.zip',await part.generateAsync({type:'uint8array'}));
  const bundle=await readInterchange([asFile(await outer.generateAsync({type:'uint8array'}),'Export-1234.zip')]);
  const prepared=prepareNoteImport(seedWorkspace(),bundle,'Notion');
  assert.deepEqual(outline(prepared.state,prepared.folderId),['세계관','  항구','[자료]','  표']);
  const world=prepared.state.notes!.find(n=>n.title==='세계관')!,port=prepared.state.notes!.find(n=>n.title==='항구')!;assert.deepEqual(wikiReferences(world.content),[port.id]);
});

test('Obsidian 보관함의 [[링크]]·별칭·![[그림]]과 코드 안 괄호를 구분한다',async()=>{
  const zip=new JSZip();
  zip.file('보관함/.obsidian/app.json','{}');zip.file('보관함/인물/이서윤.md','항해사.');zip.file('보관함/첨부/별.png',png);
  zip.file('보관함/구상.md','[[이서윤]]과 [[인물/이서윤#과거|그녀]]. [[없는 노트]]\n\n![[별.png]]\n\n`[[코드]]`\n\n```\n[[블록]]\n```');
  const bundle=await readInterchange([asFile(await zip.generateAsync({type:'uint8array'}),'보관함.zip')]);
  assert.equal(bundle.pages.length,2);assert.equal(bundle.assets.length,1);assert(bundle.warnings.some(w=>w.includes('없는 노트')));
  const prepared=prepareNoteImport(seedWorkspace(),bundle,'보관함'),idea=prepared.state.notes!.find(n=>n.title==='구상')!,person=prepared.state.notes!.find(n=>n.title==='이서윤')!;
  assert.deepEqual(outline(prepared.state,prepared.folderId),['[인물]','  이서윤','구상']);
  const linked=all(idea.content).filter(n=>n.marks?.some(m=>m.type==='wikiLink'));assert.deepEqual(linked.map(n=>n.text),['이서윤','그녀']);assert.deepEqual(wikiReferences(idea.content),[person.id]);
  assert(types(idea.content).includes('noteImage'));const text=plainText(idea.content);assert(text.includes('[[코드]]'));assert(text.includes('[[블록]]'));assert(text.includes('없는 노트'));
});

test('여러 ENEX 파일은 노트북별 폴더로, EUC-KR TXT는 경고와 함께 읽는다',async()=>{
  const enex=(title:string)=>`<?xml version="1.0"?><en-export><note><title>${title}</title><content><![CDATA[<en-note><div>${title} 본문</div></en-note>]]></content></note></en-export>`;
  const euckr=Uint8Array.from([0xc7,0xd1,0xb1,0xdb]);// '한글'
  const bundle=await readInterchange([asFile(enex('항구'),'여행.enex'),asFile(enex('고래'),'바다.enex'),asFile(euckr,'옛 메모.txt')]);
  assert.equal(plainText(bundle.pages.find(p=>p.title==='옛 메모')!.content),'한글');assert(bundle.warnings.some(w=>w.includes('EUC-KR')));
  const prepared=prepareNoteImport(seedWorkspace(),bundle,'에버노트');
  assert.deepEqual(outline(prepared.state,prepared.folderId),['[여행]','  항구','[바다]','  고래','옛 메모']);
});
