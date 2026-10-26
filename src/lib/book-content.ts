import {z} from 'zod';
import {plainText,uid,type RichNode,type Work} from './model';
import {navigationOrder,resolveNavigation} from './document-navigation';
import {withoutInternalReferences} from './internal-reference-node';
import {inlineFontSize,paragraphCss,listStyleType,cellSpan} from './manuscript-format';

export const bookOptionsSchema=z.object({
  title:z.string().trim().min(1,'제목을 입력하세요.').max(300),author:z.string().trim().max(100),
  paper:z.enum(['a5','trade','a4']),orientation:z.enum(['portrait','landscape']),columns:z.union([z.literal(1),z.literal(2)]),
  font:z.enum(['maruburi','wanted']),size:z.number({error:'글자 크기를 입력하세요.'}).min(8,'글자 크기는 8–20pt로 입력하세요.').max(20,'글자 크기는 8–20pt로 입력하세요.'),lineHeight:z.number().min(1.2).max(2.4),margin:z.number({error:'여백을 입력하세요.'}).min(10,'여백은 10–30mm로 입력하세요.').max(30,'여백은 10–30mm로 입력하세요.'),
  cover:z.boolean(),toc:z.boolean(),pageNumbers:z.boolean(),align:z.enum(['left','justify']),
});

export type BookOptions=z.infer<typeof bookOptionsSchema>;

export type BookFormat='pdf'|'epub'|'html';

export const bookFonts={maruburi:{label:'마루부리',regular:'MaruBuri-Regular.woff2',bold:'MaruBuri-Bold.woff2',fallback:'serif',fallbackName:'NotoSerifKR'},wanted:{label:'원티드 산스',regular:'WantedSans-Regular.woff2',bold:'WantedSans-Bold.woff2',fallback:'sans-serif',fallbackName:'NotoSansKR'}};

export const bookPapers={a5:{label:'A5 · 148 × 210mm',width:148,height:210},trade:{label:'신국판 · 152 × 225mm',width:152,height:225},a4:{label:'A4 · 210 × 297mm',width:210,height:297}};

export const defaultBookOptions:BookOptions={title:'',author:'',paper:'a5',orientation:'portrait',columns:1,font:'maruburi',size:11,lineHeight:1.7,margin:18,cover:true,toc:true,pageNumbers:true,align:'justify'};

export type BookNote={id:string;index:number;text:string};

/** sectionStart marks the first chapter of a run with the same section, where the section title is printed. */
export type BookChapter={id:string;title:string;section:string;sectionStart?:boolean;content:RichNode;notes:BookNote[]};

export type BookSource={id:string;chapters:BookChapter[]};

export type BookSpan={text:string;bold?:boolean;italic?:boolean;underline?:boolean;strike?:boolean;highlight?:boolean;scale?:number;shift?:number;href?:string;anchor?:string};

/** Page indexes shown together: page 1 (index 0) is a right-hand page alone, then 2–3, 4–5… as in a bound book. */
export function bookSpread(page:number,count:number){const start=page===0?0:page%2?page:page-1;

return start===0?[0]:[start,...start+1<count?[start+1]:[]];}

export const bookEscape=(text:string)=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

export function bookHref(value:string){
  if(/[\u0000-\u0020\u007f]/.test(value))return undefined;

  try{const url=new URL(value);

return ['http:','https:','mailto:'].includes(url.protocol)&&!url.username&&!url.password?url.href:undefined;}catch{return undefined;}
}

export function bookDocuments(work:Work){const ids=navigationOrder(resolveNavigation(work)),byId=new Map(work.documents.map(doc=>[doc.id,doc]));

return ids.flatMap(id=>{const doc=byId.get(id);

return doc?[doc]:[];});}

export function makeBookSource(work:Work,selected:string[]):BookSource{
  const ids=new Set(selected),documents=bookDocuments(work).filter(doc=>ids.has(doc.id));

  if(!documents.length)throw new Error('책에 넣을 문서를 선택하세요.');

  if(documents.length>500||documents.reduce((sum,doc)=>sum+plainText(doc.content).length,0)>2000000)throw new Error('원고를 나누어서 내보내세요.');

  const chapters=documents.map((doc,index):BookChapter=>{
    const content=withoutInternalReferences(doc.content),notes:BookNote[]=[];

    function visit(node:RichNode){
      if(node.type==='footnote'){const note={id:`note-${index+1}-${notes.length+1}`,index:notes.length+1,text:String(node.attrs?.text||'')};notes.push(note);node.attrs={noteId:note.id,index:note.index,text:note.text};}

      node.content?.forEach(visit);
    }

    visit(content);

    return {id:`chapter-${index+1}`,title:doc.title.trim(),section:doc.chapter.trim(),content,notes};
  });

  chapters.forEach((chapter,index)=>{chapter.sectionStart=!!chapter.section&&chapter.section!==chapters[index-1]?.section;});

  return {id:uid(),chapters};
}

export function bookSpans(node:RichNode):BookSpan[]{
  if(node.type==='text'){
    const span:BookSpan={text:node.text||''};

    for(const mark of node.marks||[]){
      if(mark.type==='bold')span.bold=true;

      if(mark.type==='italic')span.italic=true;

      if(mark.type==='underline')span.underline=true;

      if(mark.type==='strike')span.strike=true;

      if(mark.type==='highlight')span.highlight=true;

      if(mark.type==='superscript'){span.scale=.7;span.shift=.35;}

      if(mark.type==='subscript'){span.scale=.7;span.shift=-.2;}

      if(mark.type==='fontSize'){const size=inlineFontSize(mark.attrs?.size);

if(size)span.scale=size/18;}

      if(mark.type==='link')span.href=bookHref(String(mark.attrs?.href||''));
    }

    return [span];
  }

  if(node.type==='footnote')return [{text:`[${node.attrs?.index}]`,scale:.7,shift:.35,href:`#${node.attrs?.noteId}`,anchor:`ref-${node.attrs?.noteId}`}];

  if(node.type==='hardBreak')return [{text:'\n'}];

  return (node.content||[]).flatMap(bookSpans);
}

/** XHTML is shared by the EPUB chapters; no private IDs or arbitrary HTML/CSS enter it. */
export function bookChapterXhtml(chapter:BookChapter){
  function render(node:RichNode):string{
    if(node.type==='text'){
      let text=bookEscape(node.text||'');

      for(const mark of node.marks||[]){
        const tag=new Map([['bold','strong'],['italic','em'],['underline','u'],['strike','s'],['highlight','mark'],['code','code'],['superscript','sup'],['subscript','sub']]).get(mark.type);

        if(tag)text=`<${tag}>${text}</${tag}>`;

        if(mark.type==='fontSize'){const size=inlineFontSize(mark.attrs?.size);

if(size)text=`<span style="font-size:${+(size/18*100).toFixed(2)}%">${text}</span>`;}

        if(mark.type==='link'){const href=bookHref(String(mark.attrs?.href||''));

if(href)text=`<a href="${bookEscape(href)}">${text}</a>`;}
      }

      return text;
    }

    if(node.type==='footnote')return `<sup><a epub:type="noteref" id="ref-${node.attrs?.noteId}" href="#${node.attrs?.noteId}">[${node.attrs?.index}]</a></sup>`;

    if(node.type==='hardBreak')return '<br />';

    if(node.type==='horizontalRule')return '<hr />';
    const content=(node.content||[]).map(render).join(''),style=paragraphCss(node.attrs),attrs=style?` style="${bookEscape(style)}"`:'';

    if(node.type==='heading'){const level=Math.max(1,Math.min(6,Number(node.attrs?.level)||2));

return `<h${level}${attrs}>${content}</h${level}>`;}

    if(node.type==='paragraph')return `<p${attrs}>${content||'<br />'}</p>`;

    if(node.type==='table')return `<table><tbody>${content}</tbody></table>`;

    if(node.type==='tableCell'||node.type==='tableHeader'){const tag=node.type==='tableHeader'?'th':'td';

return `<${tag} colspan="${cellSpan(node.attrs?.colspan)}" rowspan="${cellSpan(node.attrs?.rowspan)}">${content}</${tag}>`;}

    if(node.type==='orderedList'||node.type==='bulletList'){const tag=node.type==='orderedList'?'ol':'ul',style=listStyleType(node);

return `<${tag}${style?` style="list-style-type:${style}"`:''}${tag==='ol'?` start="${Math.max(1,Number(node.attrs?.start)||1)}"`:''}>${content}</${tag}>`;}

    const tag=new Map([['blockquote','blockquote'],['listItem','li'],['codeBlock','pre'],['tableRow','tr']]).get(node.type);

    return tag?`<${tag}>${content}</${tag}>`:content;
  }

  const notes=chapter.notes.length?`<section epub:type="endnotes"><h2>각주</h2>${chapter.notes.map(note=>`<aside epub:type="footnote" id="${note.id}"><p><a href="#ref-${note.id}">[${note.index}]</a> ${bookEscape(note.text).replace(/\n/g,'<br />')}</p></aside>`).join('')}</section>`:'';

  return `${chapter.sectionStart?`<p class="section">${bookEscape(chapter.section)}</p>`:''}${chapter.title?`<h1>${bookEscape(chapter.title)}</h1>`:''}${render(chapter.content)}${notes}`;
}

const BOOK_PRESET_KEY='kosmos-book-export';

const bookPresetSchema=z.object({options:bookOptionsSchema.partial(),format:z.enum(['pdf','epub','html']).optional(),ids:z.array(z.string().max(100)).max(1000).optional()});

/** Last book settings per work, kept on this device only. Title, author and selection are kept only when changed from their defaults. */
export type BookPreset=z.infer<typeof bookPresetSchema>;

const bookPresetsSchema=z.record(z.string().max(100),bookPresetSchema);

function bookPresets():Record<string,BookPreset>{
  try{const parsed=bookPresetsSchema.safeParse(JSON.parse(localStorage.getItem(BOOK_PRESET_KEY)||'{}'));

return parsed.success?parsed.data:{};}catch{return {};}
}

export function readBookPreset(workId:string):BookPreset|null{return bookPresets()[workId]??null;}

export function saveBookPreset(workId:string,preset:BookPreset){
  const all=bookPresets();delete all[workId];

  try{localStorage.setItem(BOOK_PRESET_KEY,JSON.stringify(Object.fromEntries([...Object.entries(all).slice(-49),[workId,preset]])));}catch{/* The next export starts from the defaults. */}
}
