/**
 * RTF → plain HTML for the shared importer (TextEdit, WordPad, Word, Scrivener's content.rtf). Paragraphs, alignment,
 * bold/italic/underline/strike, super/subscript, line breaks and footnotes are kept; pictures and objects are dropped.
 */
type RtfResult={html:string;warnings:string[]};

export function rtfToHtml(bytes:Uint8Array,label:string):RtfResult{
  if(!/^\{\\rtf/.test(String.fromCharCode(...bytes.subarray(0,5))))throw new Error(`${label}: RTF 파일이 아닙니다.`);
  const warnings:string[]=[],warn=(m:string)=>{if(!warnings.includes(m))warnings.push(m);};

  const codepages=new Map([[949,'euc-kr'],[932,'shift_jis'],[936,'gbk'],[950,'big5'],[1250,'windows-1250'],[1251,'windows-1251'],[1252,'windows-1252'],[10000,'macintosh']]);
  let decoder=new TextDecoder('windows-1252');

  type Format={b:boolean;i:boolean;u:boolean;s:boolean;sup:boolean;sub:boolean};

  type State=Format&{skip:boolean;uc:number;note:boolean};

  const plain=():Format=>({b:false,i:false,u:false,s:false,sup:false,sub:false});
  let state:State={...plain(),skip:false,uc:1,note:false};const stack:State[]=[];
  const out:string[]=[];let segments:{text:string;f:Format}[]=[],align='',bytesPending:number[]=[],skipChars=0;
  // Footnote text is collected in its own buffer and becomes an inline note when its group closes.
  const notes:{segments:typeof segments;depth:number}[]=[];
  const esc=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const flushBytes=()=>{if(!bytesPending.length)return;const t=decoder.decode(Uint8Array.from(bytesPending));bytesPending=[];push(t);};

  function push(t:string){if(state.skip||!t)return;const target=state.note&&notes.length?notes.at(-1)!.segments:segments;const f:Format={b:state.b,i:state.i,u:state.u,s:state.s,sup:state.sup,sub:state.sub},last=target.at(-1);

if(last&&JSON.stringify(last.f)===JSON.stringify(f))last.text+=t;else target.push({text:t,f});}

  const render=(list:typeof segments)=>list.map(({text,f})=>{let h=esc(text).replace(/\n/g,'<br>');

for(const [tag,on]of [['strong',f.b],['em',f.i],['u',f.u],['s',f.s],['sup',f.sup],['sub',f.sub]] as const)if(on)h=`<${tag}>${h}</${tag}>`;

return h;}).join('');

  function paragraph(){flushBytes();

if(state.note&&notes.length){push(' ');

return;}

out.push(`<p${align?` style="text-align:${align}"`:''}>${render(segments)}</p>`);segments=[];}

  const skipDest=new Set(['fonttbl','colortbl','stylesheet','info','header','headerl','headerr','headerf','footer','footerl','footerr','footerf','fldinst','listtable','listoverridetable','revtbl','rsidtbl','generator','xmlnstbl','themedata','colorschememapping','latentstyles','datastore','pgdsctbl','filetbl','mmathPr','object','nonshppict','bkmkstart','bkmkend']);
  const chars=new Map([['emdash','—'],['endash','–'],['bullet','•'],['lquote','‘'],['rquote','’'],['ldblquote','“'],['rdblquote','”'],['emspace',' '],['enspace',' '],['qmspace',' ']]);
  let i=0,groupStart=false,steps=0;const n=bytes.length;

  while(i<n){
    if(++steps>20_000_000)throw new Error(`${label}: 문서가 너무 복잡합니다.`);
    const c=bytes[i];

    if(c===0x7b){flushBytes();stack.push({...state});

if(stack.length>200)throw new Error(`${label}: 문서의 중첩이 너무 깊습니다.`);groupStart=true;i++;continue;}

    if(c===0x7d){flushBytes();

if(notes.length&&notes.at(-1)!.depth===stack.length){const note=notes.pop()!,text=note.segments.map(s=>s.text).join('').replace(/\s+/g,' ').trim();state=stack.pop()||state;

if(text)push(`\u0000${text}\u0000`);}else state=stack.pop()||state;groupStart=false;i++;continue;}

    if(c===0x5c){
      const next=bytes[i+1];

      if(next===0x27){const hex=String.fromCharCode(bytes[i+2],bytes[i+3]);i+=4;

if(skipChars>0){skipChars--;continue;}

if(!state.skip)bytesPending.push(parseInt(hex,16));groupStart=false;continue;}

      if(next===0x2a){state.skip=true;i+=2;groupStart=false;continue;}

      if(next!==undefined&&!/[a-zA-Z]/.test(String.fromCharCode(next))){
        i+=2;groupStart=false;const sym=String.fromCharCode(next);

        if(skipChars>0){skipChars--;continue;}

        if(sym==='\\'||sym==='{'||sym==='}'){flushBytes();push(sym);}else if(sym==='~'){flushBytes();push(' ');}else if(sym==='_'){flushBytes();push('-');}else if(sym==='\n'||sym==='\r')paragraph();
        continue;
      }

      let j=i+1;

while(j<n&&/[a-zA-Z]/.test(String.fromCharCode(bytes[j])))j++;const word=String.fromCharCode(...bytes.subarray(i+1,j));
      let k=j;

if(bytes[k]===0x2d||(bytes[k]>=0x30&&bytes[k]<=0x39)){k++;

while(k<n&&bytes[k]>=0x30&&bytes[k]<=0x39)k++;}

      const param=k>j?Number(String.fromCharCode(...bytes.subarray(j,k))):undefined;

if(bytes[k]===0x20)k++;i=k;
      const first=groupStart;groupStart=false;

      if(first&&skipDest.has(word)){state.skip=true;continue;}

      if(word==='pict'){warn(`${label}: RTF 안의 그림은 가져오지 않습니다. 원본 파일을 보관하세요.`);state.skip=true;continue;}

      if(word==='footnote'&&!state.skip){flushBytes();notes.push({segments:[],depth:stack.length});state.note=true;continue;}

      if(state.skip&&word!=='par')continue;
      const on=param!==0;

      switch(word){
        case 'ansicpg':{const name=codepages.get(param||0);

if(name)try{decoder=new TextDecoder(name);}catch{/* keep previous */}

break;}

        case 'uc':state.uc=Math.max(0,param||0);break;
        case 'u':{flushBytes();let code=param||0;

if(code<0)code+=65536;push(String.fromCharCode(code));skipChars=state.uc;break;}

        case 'par':case 'sect':case 'page':if(!state.skip)paragraph();break;
        case 'pard':align='';break;
        case 'line':flushBytes();push('\n');break;
        case 'tab':flushBytes();push(' ');break;
        case 'cell':flushBytes();push(' ');break;
        case 'row':paragraph();break;
        case 'qc':align='center';break;case 'qr':align='right';break;case 'qj':align='justify';break;case 'ql':align='';break;
        case 'plain':flushBytes();Object.assign(state,plain());break;
        case 'b':flushBytes();state.b=on;break;case 'i':flushBytes();state.i=on;break;
        case 'ul':flushBytes();state.u=on;break;case 'ulnone':flushBytes();state.u=false;break;
        case 'strike':case 'striked':flushBytes();state.s=on;break;
        case 'super':flushBytes();state.sup=true;state.sub=false;break;case 'sub':flushBytes();state.sub=true;state.sup=false;break;case 'nosupersub':flushBytes();state.sup=state.sub=false;break;
        default:{const char=chars.get(word);

if(char){flushBytes();push(char);}}
      }

      continue;
    }

    if(c===0x0d||c===0x0a){i++;continue;}

    groupStart=false;

    if(skipChars>0){skipChars--;i++;continue;}

    if(!state.skip){if(c<0x80){flushBytes();push(String.fromCharCode(c));}else bytesPending.push(c);}

    i++;
  }

  flushBytes();

if(segments.some(s=>s.text.trim()))paragraph();
  // Notes were stored inline between NUL marks so they keep their position; turn them into the importer's note span.
  const html=out.join('').replace(/\u0000([^\u0000]*)\u0000/g,(_,t:string)=>`<span data-kosmos-note="${t}"></span>`);

  return {html,warnings};
}
