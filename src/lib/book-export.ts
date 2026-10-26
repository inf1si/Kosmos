import JSZip from 'jszip';
import {PDFDocument,PDFName,PDFString,PDFArray,rgb,degrees,pushGraphicsState,popGraphicsState,setCharacterSpacing} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {bookFonts,bookEscape,bookOptionsSchema,bookChapterXhtml,type BookSource,type BookOptions,type BookFormat} from './book-content';
import {layoutBook,type BookLayout,type BookText} from './book-layout';
import {loadSubsetter,subsetFont} from './font-subset';
import type {RichNode} from './model';
import type {TransferDownload} from './interchange';

export type BookFontData={regular:Uint8Array;bold:Uint8Array;license:string;pdf?:{regular:Uint8Array;bold:Uint8Array};fallback?:{regular:Uint8Array;bold:Uint8Array};subsetter?:Uint8Array};

/** Fallback glyphs cut to the characters this book uses, shared by the PDF and the paged HTML. */
export type BookFallback={regular?:Uint8Array;bold?:Uint8Array};

export type PreparedBook={source:BookSource;options:BookOptions;layout:BookLayout;fonts:BookFontData;missingGlyphs:string[];missingPlaces:string[];fallback?:BookFallback};

const fontCache=new Map<BookOptions['font'],Promise<BookFontData>>(),fallbackCache=new Map<BookOptions['font'],Promise<{regular:Uint8Array;bold:Uint8Array}>>();

const fontOptions={subset:false,features:{liga:false,kern:false}};

export function loadBookFonts(font:BookOptions['font']){
  let pending=fontCache.get(font);

  if(!pending){
    pending=(async()=>{
      const names=bookFonts[font],responses=await Promise.all([fetch(`/book-fonts/${names.regular}`),fetch(`/book-fonts/${names.bold}`),fetch('/licenses/fonts.txt')]);

      if(responses.some(response=>!response.ok))throw new Error('책 글꼴을 내려받지 못했습니다. 다시 시도하세요.');
      const [regular,bold,license]=await Promise.all([responses[0].arrayBuffer(),responses[1].arrayBuffer(),responses[2].text()]);

      return {regular:new Uint8Array(regular),bold:new Uint8Array(bold),license};
    })();
    fontCache.set(font,pending);pending.catch(()=>fontCache.delete(font));
  }

  return pending;
}

/** Noto KR glyphs for Hanja, kana, Greek and symbols the book fonts lack. Fetched only when a book needs them. */
function loadFallbackFonts(font:BookOptions['font']){
  let pending=fallbackCache.get(font);

  if(!pending){
    pending=(async()=>{
      const response=await fetch(`/book-fonts/${font}-fallback.zip`);

      if(!response.ok)throw new Error('한자·기호 글꼴을 내려받지 못했습니다. 다시 시도하세요.');
      const zip=await JSZip.loadAsync(await response.arrayBuffer()),name=bookFonts[font].fallbackName,regular=zip.file(`${name}-Regular.ttf`),bold=zip.file(`${name}-Bold.ttf`);

      if(!regular||!bold)throw new Error('한자·기호 글꼴 파일을 확인하세요.');

      return {regular:await regular.async('uint8array'),bold:await bold.async('uint8array')};
    })();
    fallbackCache.set(font,pending);pending.catch(()=>fallbackCache.delete(font));
  }

  return pending;
}

/** Every printed string with the document it comes from, so a missing character can be located. */
function bookTexts(source:BookSource,options:BookOptions){
  const texts:{place:string;text:string}[]=[{place:'책 제목·저자',text:`${options.title}${options.author}`}];

  source.chapters.forEach((chapter,index)=>{
    const place=chapter.title||`${index+1}번째 문서`,parts=[chapter.title,chapter.section];

    function visit(node:RichNode){if(node.text)parts.push(node.text);

if(node.type==='footnote')parts.push(String(node.attrs?.text||''));node.content?.forEach(visit);}

    visit(chapter.content);texts.push({place,text:parts.join('')});
  });

  return texts;
}

export async function prepareBook(source:BookSource,input:BookOptions,fonts:BookFontData,format:BookFormat='pdf'):Promise<PreparedBook>{
  const options=bookOptionsSchema.parse(input);

  if(format==='epub')return {source,options,fonts,layout:{width:0,height:0,pages:[],anchors:{}},missingGlyphs:[],missingPlaces:[]};
  const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
  const primary=await Promise.all([pdf.embedFont(fonts.regular,fontOptions),pdf.embedFont(fonts.bold,fontOptions)]),sets=primary.map(font=>new Set(font.getCharacterSet())),texts=bookTexts(source,options);
  const lacking=(ch:string)=>!/\s/u.test(ch)&&sets.some(set=>!set.has(ch.codePointAt(0)!));
  const fallbackBytes=texts.some(({text})=>Array.from(text).some(lacking))?fonts.fallback||await loadFallbackFonts(options.font):null;
  const fallback=fallbackBytes?await Promise.all([pdf.embedFont(fallbackBytes.regular,fontOptions),pdf.embedFont(fallbackBytes.bold,fontOptions)]):null,fallbackSets=fallback?.map(font=>new Set(font.getCharacterSet()));
  const cache=new Map<string,number>();

  const layout=layoutBook(source,options,{width:(text,size,strong)=>{
    const key=`${strong}:${size}:${text}`,prior=cache.get(key);

if(prior!==undefined)return prior;
    const weight=strong?1:0,value=bookRuns(text,sets[weight],fallbackSets?.[weight]).reduce((sum,run)=>sum+(run.fallback?fallback![weight]:primary[weight]).widthOfTextAtSize(run.text,size),0);cache.set(key,value);

return value;
  }});

  const missing=new Set<string>(),used=[new Set<number>(),new Set<number>()];

  for(const page of layout.pages)for(const command of page.commands)if(command.kind==='text')for(const ch of command.text){
    const code=ch.codePointAt(0)!,weight=command.bold?1:0;

    if(/\s/u.test(ch)||sets[weight].has(code))continue;

    if(fallbackSets?.[weight].has(code))used[weight].add(code);else missing.add(ch);
  }

  const missingPlaces=[...new Set(texts.flatMap(({place,text})=>Array.from(text).some(ch=>missing.has(ch))?[place]:[]))];
  let cut:BookFallback|undefined;

  if(fallbackBytes&&(used[0].size||used[1].size)){
    const hb=await loadSubsetter(fonts.subsetter);
    cut={regular:used[0].size?subsetFont(hb,fallbackBytes.regular,used[0]):undefined,bold:used[1].size?subsetFont(hb,fallbackBytes.bold,used[1]):undefined};
  }

  return {source,options,layout,fonts,missingGlyphs:[...missing],missingPlaces,fallback:cut};
}

/** Splits text where it changes between the book font and the fallback; characters neither covers measure as "?". */
export function bookRuns(text:string,primary:Set<number>,fallback?:Set<number>){
  const runs:{text:string;fallback:boolean}[]=[];

  for(const ch of text){
    const code=ch.codePointAt(0)!,useFallback=!primary.has(code)&&!!fallback?.has(code),glyph=primary.has(code)||useFallback||/\s/u.test(ch)?ch:'?',last=runs.at(-1);

    if(last&&last.fallback===useFallback)last.text+=glyph;else runs.push({text:glyph,fallback:useFallback});
  }

  return runs;
}

function bytesBase64(bytes:Uint8Array){let text='';

for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));

return btoa(text);}

function fontCss(book:PreparedBook){return `@font-face{font-family:Book;src:url(data:font/woff2;base64,${bytesBase64(book.fonts.regular)}) format('woff2');font-weight:400}@font-face{font-family:Book;src:url(data:font/woff2;base64,${bytesBase64(book.fonts.bold)}) format('woff2');font-weight:700}${(['regular','bold'] as const).map(weight=>book.fallback?.[weight]?`@font-face{font-family:BookFallback;src:url(data:font/ttf;base64,${bytesBase64(book.fallback[weight])}) format('truetype');font-weight:${weight==='bold'?700:400}}`:'').join('')}`;}

export function bookPageSvg(book:PreparedBook,index:number,interactive=true){
  const page=book.layout.pages[index];

if(!page)return '';

  const contents=page.commands.map(command=>{
    if(command.kind==='line')return `<line x1="${command.x}" y1="${command.y}" x2="${command.x2}" y2="${command.y2}" stroke="black" stroke-width="${command.width}"/>`;

    if(command.kind==='rect')return `<rect x="${command.x}" y="${command.y}" width="${command.width}" height="${command.height}" fill="${command.fill?'#eee':'white'}" stroke="black" stroke-width="0.5"/>`;
    const decorations=[command.underline||command.href?'underline':'',command.strike?'line-through':''].filter(Boolean).join(' '),length=command.width>0?` textLength="${command.width}" lengthAdjust="spacingAndGlyphs"`:'';
    const text=`${command.highlight?`<rect x="${command.x}" y="${command.y-command.size*.9}" width="${command.width}" height="${command.size*1.1}" fill="#eee"/>`:''}<text x="${command.x}" y="${command.y}" font-size="${command.size}" font-weight="${command.bold?700:400}"${command.italic?' font-style="italic"':''}${decorations?` text-decoration="${decorations}"`:''}${length} xml:space="preserve">${bookEscape(command.text)}</text>`;

    return interactive&&command.href?`<a href="${bookEscape(command.href)}"${command.href.startsWith('#')?'':' target="_blank" rel="noopener noreferrer"'}>${text}</a>`:text;
  }).join('');

  const anchors=interactive?page.anchors.map(anchor=>`<rect id="${anchor.id}" x="${anchor.x}" y="${anchor.y}" width="1" height="1" fill="none"/>`).join(''):'';

  return `<section class="page" id="book-page-${index+1}" aria-label="${index+1}쪽"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${book.layout.width} ${book.layout.height}" role="group" aria-label="${index+1}쪽">${anchors}${contents}</svg></section>`;
}

export function bookHtml(book:PreparedBook,{pages=book.layout.pages.map((_,i)=>i),spread=false,preview=false}:{pages?:number[];spread?:boolean;preview?:boolean}={}){
  const {width,height}=book.layout,title=bookEscape(book.options.title),across=spread&&width<=height,stacked=spread&&!across&&pages.length>1;
  // Portrait spreads sit side by side with page 1 alone on the right; landscape spreads stack so they stay legible.
  const fit=across?`calc((100vh - 8px) * ${width/height*2} + 16px)`:stacked?`calc((100vh - 24px) * ${width/(height*2)})`:`calc((100vh - 8px) * ${width/height})`;

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; base-uri 'none'; form-action 'none'"/><title>${title}</title><style>${fontCss(book)}*{box-sizing:border-box}body{margin:0;padding:${preview?4:20}px;background:${preview?'transparent':'#ddd'};font-family:Book,BookFallback,${bookFonts[book.options.font].fallback}}.pages{display:grid;grid-template-columns:repeat(${across?2:1},minmax(0,${width}px));justify-content:center;gap:16px;${preview?`width:min(100%,${fit});margin:auto;`:''}}${across&&pages[0]===0?'.page:first-child{grid-column:2}':''}.page{background:white;max-width:${width}px;width:100%;break-after:page}.page:last-child{break-after:auto}svg{display:block;width:100%;height:auto;color:black;fill:black;font-family:Book,BookFallback,${bookFonts[book.options.font].fallback};font-kerning:none;font-variant-ligatures:none}a{color:inherit}${preview?'':'@media(max-width:600px){body{padding:4px}.pages{grid-template-columns:minmax(0,1fr)}}'}@media print{@page{size:${width}pt ${height}pt;margin:0}body{padding:0;background:white}.pages{display:block}.page{width:${width}pt;height:${height}pt;max-width:none}}</style></head><body><main class="pages" aria-label="${title}">${pages.map(index=>bookPageSvg(book,index,!preview)).join('')}</main><pre hidden id="font-licenses">${bookEscape(book.fonts.license)}</pre></body></html>`;
}

const pdfFontCache=new Map<BookOptions['font'],Promise<{regular:Uint8Array;bold:Uint8Array}>>();

async function loadPdfFonts(font:BookOptions['font']){
  let pending=pdfFontCache.get(font);

  if(!pending){
    pending=(async()=>{
      const response=await fetch(`/book-fonts/${font}-pdf.zip`);

      if(!response.ok)throw new Error('PDF 글꼴을 내려받지 못했습니다. 다시 시도하세요.');
      const zip=await JSZip.loadAsync(await response.arrayBuffer()),names=bookFonts[font];
      const regular=zip.file(names.regular.replace('.woff2','.ttf')),bold=zip.file(names.bold.replace('.woff2','.ttf'));

      if(!regular||!bold)throw new Error('PDF 글꼴 파일을 확인하세요.');

      return {regular:await regular.async('uint8array'),bold:await bold.async('uint8array')};
    })();
    pdfFontCache.set(font,pending);pending.catch(()=>pdfFontCache.delete(font));
  }

  return pending;
}

async function pdfFile(book:PreparedBook){
  if(book.missingGlyphs.length)throw new Error(`PDF 글꼴에 없는 문자: ${book.missingGlyphs.slice(0,12).join(' ')} (${book.missingPlaces.slice(0,3).join(', ')}${book.missingPlaces.length>3?` 외 ${book.missingPlaces.length-3}곳`:''}). HTML 또는 EPUB으로 저장할 수 있습니다.`);
  const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);pdf.setTitle(book.options.title);

if(book.options.author)pdf.setAuthor(book.options.author);pdf.setCreator('Orbis Tertius');pdf.catalog.set(PDFName.of('Lang'),PDFString.of('ko-KR'));
  // The subset encoder corrupts composite glyphs in these fonts. Embed the unmodified TTF programs.
  const fonts=book.fonts.pdf||await loadPdfFonts(book.options.font);
  const [regular,bold]=await Promise.all([pdf.embedFont(fonts.regular,fontOptions),pdf.embedFont(fonts.bold,fontOptions)]),sets=[regular,bold].map(font=>new Set(font.getCharacterSet()));
  const fallback=await Promise.all([book.fallback?.regular&&pdf.embedFont(book.fallback.regular,fontOptions),book.fallback?.bold&&pdf.embedFont(book.fallback.bold,fontOptions)]),fallbackSets=fallback.map(font=>font?new Set(font.getCharacterSet()):undefined);
  const pages=book.layout.pages.map(()=>pdf.addPage([book.layout.width,book.layout.height])),ink=rgb(0,0,0),soft=rgb(.94,.94,.94);

  function link(command:BookText,pageIndex:number){
    if(!command.href)return;
    const page=pages[pageIndex],anchor=command.href.startsWith('#')?book.layout.anchors[command.href.slice(1)]:null;
    const target=anchor?{Dest:[pages[anchor.page].ref,PDFName.of('XYZ'),anchor.x,book.layout.height-anchor.y,null]}:command.href.startsWith('#')?null:{A:{Type:'Action',S:'URI',URI:PDFString.of(command.href)}};

    if(!target)return;
    const annotation=pdf.context.obj({Type:'Annot',Subtype:'Link',Rect:[command.x,book.layout.height-command.y-command.size*.25,command.x+command.width,book.layout.height-command.y+command.size],Border:[0,0,0],...target});
    const ref=pdf.context.register(annotation),existing=page.node.lookupMaybe(PDFName.of('Annots'),PDFArray);

    if(existing)existing.push(ref);else page.node.set(PDFName.of('Annots'),pdf.context.obj([ref]));
  }

  for(let i=0;i<pages.length;i++){
    const page=pages[i],height=book.layout.height;

    for(const command of book.layout.pages[i].commands){
      if(command.kind==='line'){page.drawLine({start:{x:command.x,y:height-command.y},end:{x:command.x2,y:height-command.y2},thickness:command.width,color:ink});continue;}

      if(command.kind==='rect'){page.drawRectangle({x:command.x,y:height-command.y-command.height,width:command.width,height:command.height,color:command.fill?soft:rgb(1,1,1),borderColor:ink,borderWidth:.5});continue;}

      if(command.highlight)page.drawRectangle({x:command.x,y:height-command.y-command.size*.2,width:command.width,height:command.size*1.1,color:soft});
      page.pushOperators(pushGraphicsState(),setCharacterSpacing(command.tracking));
      const weight=command.bold?1:0;let at=command.x;

      // Hanja and symbols switch to the cut fallback font mid-line; widths match the layout measurement.
      for(const run of bookRuns(command.text,sets[weight],fallbackSets[weight])){
        const font=run.fallback?fallback[weight]!:command.bold?bold:regular;
        page.drawText(run.text,{x:at,y:height-command.y,size:command.size,font,color:ink,xSkew:degrees(command.italic?10:0)});at+=font.widthOfTextAtSize(run.text,command.size)+command.tracking*Array.from(run.text).length;
      }

      page.pushOperators(popGraphicsState());

      if(command.underline||command.href)page.drawLine({start:{x:command.x,y:height-command.y-1},end:{x:command.x+command.width,y:height-command.y-1},thickness:.5,color:ink});

      if(command.strike)page.drawLine({start:{x:command.x,y:height-command.y+command.size*.3},end:{x:command.x+command.width,y:height-command.y+command.size*.3},thickness:.5,color:ink});
      link(command,i);
    }

    if(i%16===0)await new Promise(resolve=>setTimeout(resolve,0));
  }

  await pdf.attach(new TextEncoder().encode(book.fonts.license),'font-licenses.txt',{mimeType:'text/plain',description:'글꼴 저작권 및 라이선스'});

  return pdf.save();
}

const xhtml=(title:string,body:string)=>`<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="ko" xml:lang="ko"><head><meta charset="utf-8"/><title>${bookEscape(title)}</title><link rel="stylesheet" type="text/css" href="book.css"/></head><body>${body}</body></html>`;

/** Chapters under a section nest beneath it; the section links to its first chapter. */
function navItems(source:BookSource){
  return source.chapters.map((chapter,index)=>{
    const item=`<li><a href="${chapter.id}.xhtml">${bookEscape(chapter.title||String(index+1))}</a></li>`,next=source.chapters[index+1];

    if(!chapter.section)return item;
    const open=chapter.sectionStart?`<li><a href="${chapter.id}.xhtml">${bookEscape(chapter.section)}</a><ol>`:'',close=next?.section===chapter.section&&!next.sectionStart?'':'</ol></li>';

    return open+item+close;
  }).join('');
}

async function epubFile(book:PreparedBook){
  const zip=new JSZip(),{source,options}=book,names=bookFonts[options.font];
  zip.file('mimetype','application/epub+zip',{compression:'STORE'});
  zip.file('META-INF/container.xml','<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file(`OEBPS/fonts/${names.regular}`,book.fonts.regular);zip.file(`OEBPS/fonts/${names.bold}`,book.fonts.bold);zip.file('OEBPS/licenses/fonts.txt',book.fonts.license);
  zip.file('OEBPS/book.css',`@font-face{font-family:Book;src:url('fonts/${names.regular}');font-weight:400}@font-face{font-family:Book;src:url('fonts/${names.bold}');font-weight:700}body{font-family:Book,${names.fallback};line-height:${options.lineHeight};text-align:${options.align};margin:5%}p{margin:0 0 .65em;text-indent:1em}h1,h2,h3,.section{text-align:left;text-indent:0}h1{margin:1em 0 1.5em}.section{font-size:.9em}a{color:inherit}sup{font-size:.7em}table{width:100%;border-collapse:collapse}td,th{border:1px solid;padding:.3em;vertical-align:top}th,mark{background:#eee}pre{white-space:pre-wrap}blockquote{margin-left:1em}aside p{text-indent:0}.cover{text-align:center;padding-top:25%}.cover h1{text-align:center}.cover p{text-indent:0}`);
  const toc=`<nav epub:type="toc" id="toc"><h1>목차</h1><ol>${navItems(source)}</ol></nav>`;
  zip.file('OEBPS/nav.xhtml',xhtml('목차',toc));

  if(options.cover)zip.file('OEBPS/cover.xhtml',xhtml(options.title,`<section class="cover" epub:type="cover"><h1>${bookEscape(options.title)}</h1>${options.author?`<p>${bookEscape(options.author)}</p>`:''}</section>`));

  for(const chapter of source.chapters)zip.file(`OEBPS/${chapter.id}.xhtml`,xhtml(chapter.title||options.title,bookChapterXhtml(chapter)));
  zip.file('OEBPS/content.opf',`<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="3.0" xml:lang="ko"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:uuid:${source.id}</dc:identifier><dc:title>${bookEscape(options.title)}</dc:title>${options.author?`<dc:creator>${bookEscape(options.author)}</dc:creator>`:''}<dc:language>ko</dc:language><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/,'Z')}</meta><meta property="rendition:layout">reflowable</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="book.css" media-type="text/css"/><item id="regular" href="fonts/${names.regular}" media-type="font/woff2"/><item id="bold" href="fonts/${names.bold}" media-type="font/woff2"/><item id="license" href="licenses/fonts.txt" media-type="text/plain"/>${options.cover?'<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>':''}${source.chapters.map(chapter=>`<item id="${chapter.id}" href="${chapter.id}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${options.cover?'<itemref idref="cover"/>':''}${options.toc?'<itemref idref="nav"/>':''}${source.chapters.map(chapter=>`<itemref idref="${chapter.id}"/>`).join('')}</spine></package>`);

  return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}

export async function exportBook(book:PreparedBook,format:BookFormat):Promise<TransferDownload>{
  const filename=book.options.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/,'').slice(0,100)||'책';

  if(format==='html')return {name:`${filename}.html`,blob:new Blob([bookHtml(book)],{type:'text/html;charset=utf-8'})};
  const bytes=format==='pdf'?await pdfFile(book):await epubFile(book);

  return {name:`${filename}.${format}`,blob:new Blob([new Uint8Array(bytes)],{type:format==='pdf'?'application/pdf':'application/epub+zip'})};
}
