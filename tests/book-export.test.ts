import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import JSZip from 'jszip';
import {PDFDocument,PDFName,PDFArray,PDFDict,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import {XMLValidator} from 'fast-xml-parser';
import {bookFixture} from './fixtures/book-work';
import {bookDocuments,bookChapterXhtml,bookHref,bookFonts,makeBookSource,defaultBookOptions,type BookOptions} from '../src/lib/book-content';
import {prepareBook,exportBook,bookHtml,type BookFontData} from '../src/lib/book-export';
import {wrapBookText,mm} from '../src/lib/book-layout';
import {fromText} from '../src/lib/model';

async function fonts(font:BookOptions['font']='maruburi'):Promise<BookFontData>{const names=bookFonts[font];

return {regular:new Uint8Array(await readFile(`public/book-fonts/${names.regular}`)),bold:new Uint8Array(await readFile(`public/book-fonts/${names.bold}`)),license:await readFile('public/licenses/fonts.txt','utf8'),pdf:{regular:await readFile(font==='maruburi'?'node_modules/@kfonts/maruburi/src/MaruBuri-Regular.ttf':'node_modules/wanted-sans/fonts/ttf/WantedSans-Regular.ttf'),bold:await readFile(font==='maruburi'?'node_modules/@kfonts/maruburi/src/MaruBuri-Bold.ttf':'node_modules/wanted-sans/fonts/ttf/WantedSans-Bold.ttf')}};}

const fixture=bookFixture(),source=makeBookSource(fixture.work,[fixture.second.id,fixture.first.id]),options={...defaultBookOptions,title:'우주 <너머> & 책',author:'합성 작가'};

const prepared=fonts().then(fonts=>prepareBook(source,options,fonts));

// Extraction alone misses malformed font programs: compare the actual embedded bytes to the valid originals.
function assertOriginalPdfFonts(pdf:PDFDocument,fonts:BookFontData){
 const resources=pdf.getPage(0).node.Resources()!.lookup(PDFName.of('Font'),PDFDict),hashes=new Set<string>();

 for(const ref of resources.values()){
  const font=pdf.context.lookup(ref,PDFDict),descendant=font.lookup(PDFName.of('DescendantFonts'),PDFArray).lookup(0,PDFDict),descriptor=descendant.lookup(PDFName.of('FontDescriptor'),PDFDict),stream=descriptor.lookup(PDFName.of('FontFile2'));
  assert(stream instanceof PDFRawStream);
  hashes.add(createHash('sha256').update(decodePDFRawStream(stream).decode()).digest('hex'));
 }

 assert(hashes.has(createHash('sha256').update(fonts.pdf!.regular).digest('hex')));
 assert(hashes.has(createHash('sha256').update(fonts.pdf!.bold).digest('hex')));
}

test('책은 트리 순서로 선택 문서만 복사하며 비공개 참조와 원본 ID를 제거한다',()=>{
  const {work,first,second,memo}=bookFixture(),before=JSON.stringify(work),source=makeBookSource(work,[second.id,first.id]);
  assert.deepEqual(bookDocuments(work).map(d=>d.id),[first.id,second.id,memo.id]);assert.deepEqual(source.chapters.map(c=>c.title),[first.title,second.title]);
  assert.equal(source.chapters[0].notes[0].id,'note-1-1');const xml=bookChapterXhtml(source.chapters[0]);

  for(const secret of ['비공개참조제목','99999999-9999-4999-8999-999999999999','88888888-8888-4888-8888-888888888888','미선택 비밀 원고',first.id])assert(!xml.includes(secret));
  assert(xml.includes('설정 이름'));assert(xml.includes('href="#note-1-1"'));assert(xml.includes('href="#ref-note-1-1"'));assert(xml.includes('&lt;특수&gt; &amp;'));
  assert.equal(JSON.stringify(work),before);assert.throws(()=>makeBookSource(work,[]),/선택/);
});

test('줄바꿈은 한글·긴 영단어·문장부호를 잃지 않고 열 폭 안에 둔다',()=>{
  const metrics={width:(text:string,size:number)=>Array.from(text).length*size};

  for(const text of ['가나다라마바사아자차카타파하. 다음 문장입니다.','The extraordinary spacecraft returned without damage.','A'.repeat(90), '한글(괄호)와 「문장」, 끝.']){
    const lines=wrapBookText([{text}],10,70,metrics,60);
    assert.equal(lines.flat().map(g=>g.text).join('').replace(/\s/g,''),text.replace(/\s/g,''));

    for(const line of lines)assert(line.reduce((sum,g)=>sum+g.width,0)<=70,JSON.stringify(line));
  }
});

for(const orientation of ['portrait','landscape'] as const)for(const columns of [1,2] as const)test(`${orientation} ${columns}단의 쪽·열·목차·각주 위치가 용지 안에 있다`,async()=>{
  const book=await prepareBook(source,{...options,orientation,columns},await fonts());const {layout}=book;
  assert(Math.abs(layout.width-(orientation==='portrait'?148:210)*mm)<.01);assert(layout.pages.length>=4);

  for(const page of layout.pages)for(const command of page.commands){assert(command.x>=0);assert(command.y>=0);

if(command.kind==='text'){assert(command.x+command.width<=layout.width+.1,command.text);assert(command.y<=layout.height,command.text);}}

  assert(layout.anchors['chapter-1']);assert(layout.anchors['note-1-1']);assert(layout.anchors['ref-note-1-1']);
  const text=layout.pages.flatMap(p=>p.commands).filter(c=>c.kind==='text').map(c=>c.text).join('');
  assert(text.includes('마지막'));assert(text.includes('병합한'));assert(text.includes('각주 설명'));
  assert(!text.includes('비공개참조제목'));assert(!text.includes('미선택 비밀'));
});

test('PDF는 한글 글꼴·용지·메타데이터·링크·라이선스 첨부를 갖춘 실제 파일이다',async()=>{
  const book=await prepared,file=await exportBook(book,'pdf'),bytes=new Uint8Array(await file.blob.arrayBuffer()),pdf=await PDFDocument.load(bytes);
  assert.equal(file.blob.type,'application/pdf');assert.equal(new TextDecoder().decode(bytes.slice(0,8)),'%PDF-1.7');assert.equal(pdf.getTitle(),options.title);assert.equal(pdf.getAuthor(),options.author);assert.equal(pdf.getPageCount(),book.layout.pages.length);
  assert(pdf.catalog.has(PDFName.of('Names')));assert(pdf.getPages().some(page=>page.node.lookupMaybe(PDFName.of('Annots'),PDFArray)?.size()));
  assert(pdf.getPage(0).getWidth()>400);assert(bytes.length>20000);assertOriginalPdfFonts(pdf,book.fonts);
});

test('원티드 산스 PDF는 한글 복합 글리프를 원본 TTF로 인코딩한다',async()=>{
 const book=await prepareBook(source,{...options,font:'wanted'},await fonts('wanted')),file=await exportBook(book,'pdf');const pdf=await PDFDocument.load(await file.blob.arrayBuffer());assert(pdf.getPageCount()>0);assertOriginalPdfFonts(pdf,book.fonts);
});

test('단일 HTML은 PDF와 같은 쪽·자체 글꼴·안전한 링크·숨겨진 라이선스를 담는다',async()=>{
  const book=await prepared,file=await exportBook(book,'html'),html=await file.blob.text();
  assert.equal((html.match(/class="page"/g)||[]).length,book.layout.pages.length);assert(html.includes('data:font/woff2;base64,'));assert(html.includes('id="font-licenses"'));assert(html.includes('우주 &lt;너머&gt; &amp; 책'));assert(html.includes('id="chapter-1"'));assert(html.includes('href="#note-1-1"'));assert(!html.includes('<script'));assert(!html.includes('99999999-9999-4999-8999-999999999999'));
  const preview=bookHtml(book,{pages:[2,3],spread:true,preview:true});assert.equal((preview.match(/class="page"/g)||[]).length,2);assert(!preview.includes('<a href='));

  for(const url of ['javascript:alert(1)','data:text/html,bad','https://user:pass@example.com/','https://example.com/\nattack'])assert.equal(bookHref(url),undefined);
  assert.equal(bookHref('https://example.com/path?q=1'),'https://example.com/path?q=1');
});

test('EPUB 3는 첫 무압축 mimetype·올바른 XHTML·목차·spine·원본 글꼴·각주를 담는다',async()=>{
  const file=await exportBook(await prepared,'epub'),bytes=new Uint8Array(await file.blob.arrayBuffer()),zip=await JSZip.loadAsync(bytes),view=new DataView(bytes.buffer);
  assert.equal(view.getUint16(8,true),0);assert.equal(new TextDecoder().decode(bytes.slice(30,38)),'mimetype');assert.equal(await zip.file('mimetype')!.async('string'),'application/epub+zip');

  for(const name of Object.keys(zip.files).filter(name=>/\.(xml|opf|xhtml)$/.test(name)))assert.equal(XMLValidator.validate(await zip.file(name)!.async('string')),true,name);
  const opf=await zip.file('OEBPS/content.opf')!.async('string'),nav=await zip.file('OEBPS/nav.xhtml')!.async('string'),chapter=await zip.file('OEBPS/chapter-1.xhtml')!.async('string');
  assert(opf.includes('reflowable'));assert(opf.indexOf('<itemref idref="chapter-1"')<opf.indexOf('<itemref idref="chapter-2"'));assert(nav.includes('chapter-2.xhtml'));assert(chapter.includes('epub:type="noteref"'));assert(chapter.includes('id="note-1-1"'));assert(chapter.includes('href="#ref-note-1-1"'));
  assert.equal(await zip.file('OEBPS/licenses/fonts.txt')!.async('string'),(await fonts()).license);assert.deepEqual(await zip.file('OEBPS/fonts/MaruBuri-Regular.woff2')!.async('uint8array'),(await fonts()).regular);
  const all=await Promise.all(Object.keys(zip.files).filter(name=>/\.(xml|opf|xhtml|css)$/.test(name)).map(name=>zip.file(name)!.async('string')));assert(!all.join('').includes('비공개참조제목'));
});

test('책 설정은 원고와 독립적이며 긴 제목·제목 없는 장·표지/목차 끄기를 지원한다',async()=>{
  const {work,first}=bookFixture();first.title='';first.content=fromText('제목 없이 쓴 원고');const source=makeBookSource(work,[first.id]);
  const book=await prepareBook(source,{...options,title:'아주 긴 제목 '.repeat(30),author:'긴 저자 '.repeat(15),paper:'a5',orientation:'landscape',columns:2,size:20,margin:30},await fonts('wanted'));

  for(const command of book.layout.pages[0].commands)if(command.kind==='text'){assert(command.y>0&&command.y<book.layout.height);assert(command.x>=0&&command.x+command.width<=book.layout.width+.1);}

  const simple=await prepareBook(source,{...options,cover:false,toc:false,pageNumbers:false},await fonts());assert.equal(simple.layout.pages.length,1);assert(!bookChapterXhtml(source.chapters[0]).includes('제목 없음'));assert(!simple.layout.pages[0].commands.some(c=>c.kind==='text'&&c.text==='목차'));
});

test('지원하지 않는 PDF 문자를 알리고 HTML·EPUB에는 원문을 보존한다',async()=>{
  const {work,first}=bookFixture();first.content=fromText('별빛 🪐 기록');const source=makeBookSource(work,[first.id]),book=await prepareBook(source,options,await fonts());
  assert(book.missingGlyphs.includes('🪐'));await assert.rejects(()=>exportBook(book,'pdf'),/없는 문자/);assert((await (await exportBook(book,'html')).blob.text()).includes('🪐'));
  const epub=await prepareBook(source,options,await fonts(),'epub'),zip=await JSZip.loadAsync(await (await exportBook(epub,'epub')).blob.arrayBuffer());assert((await zip.file('OEBPS/chapter-1.xhtml')!.async('string')).includes('🪐'));
});

test('배포한 책 글꼴은 npm 원본과 바이트가 같고 고지에 두 글꼴이 있다',async()=>{
  const paths={'MaruBuri-Regular.woff2':'@kfonts/maruburi/MaruBuri-Regular.woff2','MaruBuri-Bold.woff2':'@kfonts/maruburi/MaruBuri-Bold.woff2','WantedSans-Regular.woff2':'wanted-sans/fonts/webfonts/static/complete/woff2/WantedSans-Regular.woff2','WantedSans-Bold.woff2':'wanted-sans/fonts/webfonts/static/complete/woff2/WantedSans-Bold.woff2'};

  for(const [name,path] of Object.entries(paths)){const [actual,original]=await Promise.all([readFile(`public/book-fonts/${name}`),readFile(`node_modules/${path}`)]);assert.equal(createHash('sha256').update(actual).digest('hex'),createHash('sha256').update(original).digest('hex'));}
});


test('PDF용 압축 묶음도 원본 TTF와 라이선스 전문을 그대로 제공한다',async()=>{
 for(const font of ['maruburi','wanted'] as const){
  const data=await fonts(font),names=bookFonts[font],zip=await JSZip.loadAsync(await readFile(`public/book-fonts/${font}-pdf.zip`));
  assert.deepEqual(await zip.file(names.regular.replace('.woff2','.ttf'))!.async('uint8array'),new Uint8Array(data.pdf!.regular));
  assert.deepEqual(await zip.file(names.bold.replace('.woff2','.ttf'))!.async('uint8array'),new Uint8Array(data.pdf!.bold));
  assert.equal(await zip.file('fonts.txt')!.async('string'),data.license);
 }
});
