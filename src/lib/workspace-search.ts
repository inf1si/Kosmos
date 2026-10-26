import { type NovelDocument,type RichNode,type Workspace } from './model';
import { propertyText,type CustomProperty } from './custom-properties';
import { referenceTargets,type ReferenceTarget } from './internal-references';

export type TextRange={from:number;to:number};

/** Document fields searched like body text and quoted in the result when the body does not match. */
export type SearchField={label:string;text:string};

export type SearchDocument=ReferenceTarget&{content:RichNode;updatedAt:string;keywords:string;fields:SearchField[];docKind:NovelDocument['kind'];docCategory:string};

export type WorkspaceSearchHit={document:SearchDocument;snippet:string;rank:number};

export type WorkspaceSearchJump={id:string;targetId:string;terms:string[]};

type BodyRun={text:string;from:number};

const runsCache=new WeakMap<RichNode,BodyRun[]>();

const textblocks=new Set(['paragraph','heading','codeBlock']);

const containers=new Set(['doc','blockquote','bulletList','orderedList','listItem','taskList','taskItem','table','tableRow','tableCell','tableHeader']);

const graphemes=new Intl.Segmenter('ko',{granularity:'grapheme'});

export function searchTerms(query:string){return [...new Set(query.slice(0,500).normalize('NFC').trim().split(/\s+/).filter(Boolean))];}

/** Original UTF-16 offsets survive composed/decomposed Korean and adjacent formatting marks. */
export function textRanges(text:string,terms:string[],firstPerTerm=false):TextRange[]{
  const normalized=text.normalize('NFC'),ranges:TextRange[]=[];
  const starts:number[]=[],ends:number[]=[];

  if(normalized!==text)for(const part of graphemes.segment(text))for(let i=0;i<part.segment.normalize('NFC').length;i++){starts.push(part.index);ends.push(part.index+part.segment.length);}

  for(const term of terms){const escaped=term.normalize('NFC').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

    if(!escaped)continue;

    for(const found of normalized.matchAll(new RegExp(escaped,'giu'))){const from=found.index,to=from+found[0].length;
      ranges.push({from:normalized===text?from:starts[from],to:normalized===text?to:ends[to-1]});

if(firstPerTerm)break;}
  }

  const merged:TextRange[]=[];

  for(const range of ranges.sort((a,b)=>a.from-b.from||a.to-b.to)){const last=merged.at(-1);

if(last&&range.from<=last.to)last.to=Math.max(last.to,range.to);else merged.push({...range});}

  return merged;
}

/** ProseMirror positions: text length, atoms one, containers two; doc has no boundary tokens. */
export function bodyRuns(content:RichNode):BodyRun[]{
  const cached=runsCache.get(content);

  if(cached)return cached;
  const runs:BodyRun[]=[];

  function visit(node:RichNode,pos:number):number{
    if(node.type==='text')return node.text?.length||0;

    if(textblocks.has(node.type)){
      let offset=pos+1,text='',start=offset;
      const flush=()=>{if(text)runs.push({text,from:start});text='';};

      for(const child of node.content||[]){if(child.type==='text'){if(!text)start=offset;text+=child.text||'';}else flush();offset+=child.type==='text'?child.text?.length||0:1;}

      flush();

      return offset-pos+1;
    }

    if(!containers.has(node.type))return 1;
    let offset=node.type==='doc'?0:pos+1;

    for(const child of node.content||[])offset+=visit(child,offset);

    return node.type==='doc'?offset:offset-pos+1;
  }

  visit(content,-1);runsCache.set(content,runs);

  return runs;
}

/** Counted only for displayed results; counting every hit doubles the cost of a broad query. */
export function bodyMatchCount(content:RichNode,terms:string[]){return bodyRuns(content).reduce((sum,run)=>sum+textRanges(run.text,terms).length,0);}

export function firstBodyMatch(content:RichNode,terms:string[]):TextRange|null{
  for(const run of bodyRuns(content)){const range=textRanges(run.text,terms,true)[0];

if(range)return {from:run.from+range.from,to:run.from+range.to};}

  return null;
}

function fields(values:[string,string][],properties:CustomProperty[]=[]):SearchField[]{
  const pairs:[string,string][]=[...values,...properties.flatMap(p=>p.type==='checkbox'?[]:[[p.name,propertyText(p)] satisfies [string,string]])];

  return pairs.flatMap(([label,text])=>text.trim()?[{label,text}]:[]);
}

export function searchDocuments(state:Workspace):SearchDocument[]{
  const details=new Map<string,{updatedAt:string;tags:readonly string[];fields:SearchField[];docKind:NovelDocument['kind'];docCategory:string}>([...state.works.flatMap(work=>work.documents.map(doc=>[doc.id,{updatedAt:doc.updatedAt,tags:[],fields:fields([['요약',doc.summary],['시점 인물',doc.pov],['작중 시간',doc.storyTime]],doc.customProperties),docKind:doc.kind,docCategory:doc.category}] as const)),...(state.notes||[]).map(note=>[note.id,{updatedAt:note.updatedAt,tags:note.tags,fields:fields([],note.customProperties),docKind:'memo',docCategory:''}] as const)]);

  return referenceTargets(state).flatMap(target=>{const detail=details.get(target.targetId);

return target.content&&detail?[{...target,content:target.content,updatedAt:detail.updatedAt,fields:detail.fields,docKind:detail.docKind,docCategory:detail.docCategory,keywords:[target.path,target.category,detail.docCategory,...detail.tags].join(' ')}]:[];});
}

function excerpt(text:string,terms:string[]){
  const value=text.normalize('NFC'),match=textRanges(value,terms)[0],anchor=match?.from||0;
  let from=Math.max(0,anchor-45),to=Math.min(value.length,Math.max(anchor+125,(match?.to||0)+25));

  if(/[\uDC00-\uDFFF]/.test(value.charAt(from)))from--;

  if(/[\uDC00-\uDFFF]/.test(value.charAt(to)))to++;

  return `${from?'…':''}${value.slice(from,to).trim()}${to<value.length?'…':''}`;
}

export function searchWorkspace(documents:SearchDocument[],query:string,scope:string,currentWorkId:string):WorkspaceSearchHit[]{
  const terms=searchTerms(query);

  if(!terms.length)return [];
  const phrase=query.normalize('NFC').trim(),hits:WorkspaceSearchHit[]=[];

  for(const document of documents){
    if(scope==='notes'&&document.kind!=='note'||scope==='current'&&document.workId!==currentWorkId||!['all','notes','current'].includes(scope)&&document.workId!==scope)continue;
    const runs=bodyRuns(document.content),titleHits:boolean[]=[],bodyHits:boolean[]=[];
    let matches=true;

    for(const term of terms){
      const title=textRanges(document.label,[term],true).length>0,body=!title&&(runs.some(run=>textRanges(run.text,[term],true).length>0)||document.fields.some(field=>textRanges(field.text,[term],true).length>0));
      titleHits.push(title);bodyHits.push(body);

      if(!title&&!body&&!textRanges(document.keywords,[term],true).length){matches=false;break;}
    }

    if(!matches)continue;
    const titlePhrase=textRanges(document.label,[phrase])[0],exact=titlePhrase?.from===0&&titlePhrase.to===document.label.length;
    const rank=exact?0:titlePhrase?1:titleHits.every(Boolean)?2:titleHits.some(Boolean)?3:bodyHits.some(Boolean)?4:5;
    const matched=runs.find(run=>textRanges(run.text,terms,true).length),field=!matched&&document.fields.find(field=>textRanges(field.text,terms,true).length);
    const snippet=matched?excerpt(matched.text,terms):field?`${field.label} · ${excerpt(field.text,terms)}`:runs[0]?excerpt(runs[0].text,terms):'';
    hits.push({document,rank,snippet});
  }

  return hits.sort((a,b)=>a.rank-b.rank||b.document.updatedAt.localeCompare(a.document.updatedAt)||a.document.targetId.localeCompare(b.document.targetId));
}
