'use client';
import { useEffect, useState, type ReactNode, useRef } from 'react';
import Link from 'next/link';
import { BookOpen, List, Settings2, X, Link2 } from 'lucide-react';
import { Publication, RichNode, footnotes, plainText } from '@/lib/model';
import { db } from '@/lib/database';
import { seedWorkspace } from '@/lib/seed';
import { Modal } from './primitives';

function usePublicData(initial:Publication[],localPreview:boolean){
  const [data,setData]=useState(initial);const [loading,setLoading]=useState(localPreview);
  useEffect(()=>{if(!localPreview)return;void db.workspaces.get('preview').then(row=>{const state=row?.data||seedWorkspace();setData(state.works.flatMap(w=>w.publications.filter(p=>p.id===w.activePublicationId)));}).finally(()=>setLoading(false));},[localPreview]);return{data,loading};
}
function PublicHeader({children}:{children?:ReactNode}){return <header className="public-header"><Link href="/library" className="public-brand"><BookOpen size={20}/>Orbis Tertius</Link><nav>{children}<Link className="studio-link" href="/studio">집필실</Link></nav></header>;}
export function Library({initial,localPreview,error}:{initial:Publication[];localPreview:boolean;error?:string}){
  const {data,loading}=usePublicData(initial,localPreview);
  return <div className="public-site"><PublicHeader/><main className="library"><div className="library-intro"><span className="eyebrow">FICTION & WORLDS</span><h1>쓰여진 시간들.</h1><p>소설과 그 곁의 세계를 모아둔 서재.</p></div>{localPreview&&<div className="preview-label">기기 내 미리보기 · 예시 작품을 포함합니다</div>}{error&&<p role="alert">{error}</p>}
    {loading?<p className="muted">서재를 여는 중입니다.</p>:data.length?<div className="book-list">{data.map((p,i)=><article className="book-entry" key={p.id}><div className="book-number">{String(i+1).padStart(2,'0')}</div><div className="book-info"><span className="book-category">소설 · {p.scenes.length}개 장면</span><Link href={`/read/${p.workId}`}><h2>{p.title}</h2></Link><p className="book-subtitle">{p.subtitle}</p><p className="book-description">{p.description}</p><div className="book-actions"><Link href={`/read/${p.workId}`}>작품 읽기</Link><Link href={`/wiki/${p.workId}`}>설정집</Link><span>{new Date(p.publishedAt).toLocaleDateString('ko-KR')}</span></div></div><div className="book-excerpt"><span>첫 문장</span><p>{plainText(p.scenes[0].content).split('\n')[0]}</p></div></article>)}</div>:<div className="empty-library"><h2>아직 공개한 작품이 없습니다.</h2><p>첫 작품이 준비되면 이곳에서 읽을 수 있습니다.</p></div>}
    <footer className="public-footer">Orbis Tertius</footer></main></div>;
}
function NoteLink({id,text,index}:{id:string;text:string;index:number}){
  const [open,setOpen]=useState(false);
  return <span className="note-anchor" onMouseEnter={()=>setOpen(true)} onMouseLeave={()=>setOpen(false)}><a id={`ref-${id}`} href={`#note-${id}`} className="note-number" aria-label={`각주 ${index}: ${text}`} onFocus={()=>setOpen(true)} onBlur={()=>setOpen(false)}>{index}</a>{open&&<span className="note-popover" role="tooltip"><strong>각주 {index}</strong>{text}</span>}</span>;
}
export function RichReader({content,publication,onWiki}:{content:RichNode;publication:Publication;onWiki:(id:string)=>void}){
  const notes=publication.scenes.flatMap(scene=>footnotes(scene.content));
  function node(n:RichNode,key:string):ReactNode{
    if(n.type==='text'){
      let text:ReactNode=n.text;
      for(const m of n.marks||[]){
        if(m.type==='bold')text=<strong>{text}</strong>;else if(m.type==='italic')text=<em>{text}</em>;else if(m.type==='underline')text=<u>{text}</u>;else if(m.type==='strike')text=<s>{text}</s>;else if(m.type==='code')text=<code>{text}</code>;
        else if(m.type==='wikiLink'){const target=String(m.attrs?.targetId||'');const setting=publication.wiki.find(w=>w.id===target);if(setting)text=<button className="reader-wiki-link" title={setting.summary} onClick={()=>onWiki(target)}>{text}</button>;}
        else if(m.type==='link'){const href=String(m.attrs?.href||'');if(/^https?:\/\//i.test(href))text=<a href={href} target="_blank" rel="noopener noreferrer">{text}</a>;}
      }
      return <span key={key}>{text}</span>;
    }
    if(n.type==='footnote'){const id=String(n.attrs?.noteId||key);const index=notes.findIndex(note=>note.id===id)+1;return <NoteLink key={key} id={id} index={index} text={String(n.attrs?.text||'')}/>;}
    const children=n.content?.map((c,i)=>node(c,`${key}.${i}`));const id=typeof n.attrs?.blockId==='string'?n.attrs.blockId:undefined;
    const align=['left','center','right','justify'].includes(String(n.attrs?.textAlign))?n.attrs?.textAlign as React.CSSProperties['textAlign']:undefined;
    if(n.type==='paragraph')return <p key={key} id={id} style={{textAlign:align}}>{children}</p>;
    if(n.type==='heading')return <h3 key={key} id={id}>{children}</h3>;
    if(n.type==='blockquote')return <blockquote key={key}>{children}</blockquote>;
    if(n.type==='bulletList')return <ul key={key}>{children}</ul>;
    if(n.type==='orderedList')return <ol key={key}>{children}</ol>;
    if(n.type==='listItem')return <li key={key}>{children}</li>;
    if(n.type==='hardBreak')return <br key={key}/>;
    if(n.type==='horizontalRule')return <hr key={key}/>;
    if(n.type==='codeBlock')return <pre key={key}><code>{children}</code></pre>;
    return <span key={key}>{children}</span>;
  }
  return <>{content.content?.map((n,i)=>node(n,String(i)))}</>;
}
export function Reader({workId,initial,localPreview}:{workId:string;initial:Publication[];localPreview:boolean}){
  const {data,loading}=usePublicData(initial,localPreview);const pub=data.find(p=>p.workId===workId);
  const [settings,setSettings]=useState(false);const [toc,setToc]=useState(false);const [wikiId,setWikiId]=useState<string|null>(null);
  const [font,setFont]=useState('serif');const [size,setSize]=useState(19);const [width,setWidth]=useState(680);const [theme,setTheme]=useState('paper');const [progress,setProgress]=useState(0);
  const restored=useRef(false);
  useEffect(()=>{try{const prefs=JSON.parse(localStorage.getItem('orbit-reader-prefs')||'null');if(prefs){if(['serif','sans'].includes(prefs.font))setFont(prefs.font);if([17,19,21,23].includes(prefs.size))setSize(prefs.size);if([580,680,780].includes(prefs.width))setWidth(prefs.width);if(['paper','night'].includes(prefs.theme))setTheme(prefs.theme);}}catch{}},[]);
  useEffect(()=>{try{localStorage.setItem('orbit-reader-prefs',JSON.stringify({font,size,width,theme}));}catch{}},[font,size,width,theme]);
  useEffect(()=>{
    if(!pub)return;
    const key=`orbit-reading:${workId}`;let timer:ReturnType<typeof setTimeout>|undefined;
    if(!restored.current){restored.current=true;try{const saved=JSON.parse(localStorage.getItem(key)||'null');if(saved?.blockId)requestAnimationFrame(()=>{const el=document.getElementById(saved.blockId);if(el)window.scrollTo(0,el.getBoundingClientRect().top+window.scrollY-Number(saved.offset||90));});}catch{}}
    const scroll=()=>{const max=document.documentElement.scrollHeight-window.innerHeight;setProgress(max>0?Math.round(window.scrollY/max*100):0);if(timer)clearTimeout(timer);timer=setTimeout(()=>{const blocks=[...document.querySelectorAll<HTMLElement>('.reading-body p[id]')];const current=blocks.find(el=>el.getBoundingClientRect().top>=-120)||blocks.at(-1);if(current)try{localStorage.setItem(key,JSON.stringify({blockId:current.id,offset:current.getBoundingClientRect().top,publicationId:pub.id}));}catch{}},300);};
    window.addEventListener('scroll',scroll,{passive:true});return()=>{window.removeEventListener('scroll',scroll);if(timer)clearTimeout(timer);};
  },[pub,workId]);
  if(loading)return <div className="public-site"><PublicHeader/><p className="public-loading">작품을 여는 중입니다.</p></div>;
  if(!pub)return <div className="public-site"><PublicHeader/><div className="public-loading"><h1>아직 공개되지 않은 작품입니다.</h1><Link href="/library">서재로 돌아가기</Link></div></div>;
  const wiki=pub.wiki.find(w=>w.id===wikiId);const notes=pub.scenes.flatMap(scene=>footnotes(scene.content)).filter((n,i,a)=>a.findIndex(x=>x.id===n.id)===i);
  return <div className={`public-site reader theme-${theme}`} style={{'--reading-size':`${size}px`,'--reading-width':`${width}px`} as React.CSSProperties}><PublicHeader><Link href={`/wiki/${workId}`}>설정집</Link></PublicHeader>
    <div className="reading-controls"><button onClick={()=>setToc(v=>!v)}><List size={17}/>목차</button><span>{pub.title}</span><button onClick={()=>setSettings(true)}><Settings2 size={17}/>읽기 설정</button></div>
    <div className="reading-progress" style={{width:`${progress}%`}}/>
    {toc&&<aside className="reading-toc"><div><h2>목차</h2><button aria-label="목차 닫기" onClick={()=>setToc(false)}><X size={18}/></button></div>{pub.scenes.map(scene=><a key={scene.id} href={`#scene-${scene.id}`} onClick={()=>setToc(false)}>{scene.title}</a>)}</aside>}
    <main className={`reading-page reading-${font}`}><header className="reading-title"><span>소설</span><h1>{pub.title}</h1><p>{pub.subtitle}</p></header>{pub.scenes.map(scene=><section key={scene.id} className="reading-scene" id={`scene-${scene.id}`}><div className="reading-scene-title"><span>{scene.chapter}</span><h2>{scene.title}</h2></div><div className="reading-body"><RichReader content={scene.content} publication={pub} onWiki={setWikiId}/></div></section>)}
      {notes.length>0&&<section className="reading-notes"><h2>주석</h2><ol>{notes.map((note,i)=><li id={`note-${note.id}`} key={note.id}><a href={`#ref-${note.id}`} aria-label={`각주 ${i+1} 본문으로 돌아가기`}>{i+1}</a><p>{note.text}</p></li>)}</ol></section>}
      <footer className="reading-end"><span>여기까지 공개되었습니다.</span><div><Link href="/library">작품 목록</Link><Link href={`/wiki/${workId}`}>설정집 읽기</Link></div><small>공개 판본 · {new Date(pub.publishedAt).toLocaleDateString('ko-KR')}</small></footer>
    </main>
    <Modal open={settings} onClose={()=>setSettings(false)} title="읽기 설정"><div className="reading-preferences"><label>글꼴<select value={font} onChange={e=>setFont(e.target.value)}><option value="serif">명조</option><option value="sans">고딕</option></select></label><label>글자 크기<select value={size} onChange={e=>setSize(Number(e.target.value))}>{[17,19,21,23].map(v=><option key={v}>{v}</option>)}</select></label><label>본문 폭<select value={width} onChange={e=>setWidth(Number(e.target.value))}><option value={580}>좁게</option><option value={680}>기본</option><option value={780}>넓게</option></select></label><label>배경<select value={theme} onChange={e=>setTheme(e.target.value)}><option value="paper">밝게</option><option value="night">어둡게</option></select></label></div></Modal>
    <Modal open={!!wiki} onClose={()=>setWikiId(null)} title={wiki?.title||'설정'}>{wiki&&<><span className="wiki-category">{wiki.category}</span><p className="wiki-summary">{wiki.summary}</p><Link className="button" href={`/wiki/${workId}?doc=${wiki.id}`}>설정 문서 열기</Link></>}</Modal>
  </div>;
}
export function Wiki({workId,initial,localPreview,initialDoc}:{workId:string;initial:Publication[];localPreview:boolean;initialDoc?:string}){
  const {data,loading}=usePublicData(initial,localPreview);const pub=data.find(p=>p.workId===workId);
  const [active,setActive]=useState(initialDoc||'');const [query,setQuery]=useState('');
  if(loading)return <div className="public-loading">설정집을 여는 중입니다.</div>;
  if(!pub)return <div className="public-site"><PublicHeader/><div className="public-loading">공개 설정집이 없습니다.</div></div>;
  const docs=pub.wiki.filter(d=>`${d.title} ${d.summary}`.includes(query));const doc=pub.wiki.find(d=>d.id===active)||docs[0];
  const appearances=doc?pub.scenes.filter(scene=>JSON.stringify(scene.content).includes(doc.id)):[];
  return <div className="public-site"><PublicHeader><Link href={`/read/${workId}`}>작품 읽기</Link></PublicHeader><main className="wiki-page"><header className="wiki-heading"><span className="eyebrow">WORLD BIBLE</span><h1>{pub.title} <span>설정집</span></h1><p>공개한 작품의 인물과 세계에 관한 기록.</p></header><div className="wiki-layout"><aside className="wiki-nav"><input aria-label="설정집 검색" value={query} onChange={e=>setQuery(e.target.value)} placeholder="설정집에서 찾기"/>{[...new Set(docs.map(d=>d.category))].map(category=><section key={category}><h2>{category}</h2>{docs.filter(d=>d.category===category).map(d=><button key={d.id} className={doc?.id===d.id?'active':''} onClick={()=>{setActive(d.id);history.replaceState(null,'',`?doc=${d.id}`);}}>{d.title}</button>)}</section>)}</aside><article className="wiki-document">{doc?<><span className="wiki-category">{doc.category}</span><h2>{doc.title}</h2><div className="wiki-meta">{pub.title}의 공개 설정</div><p className="wiki-summary">{doc.summary}</p><section className="wiki-appearances"><h3><Link2 size={17}/>작품에서 등장하는 곳</h3>{appearances.map(scene=><Link href={`/read/${workId}#scene-${scene.id}`} key={scene.id}>{scene.title}</Link>)}</section></>:<p className="muted">공개된 설정 문서가 없습니다.</p>}</article></div></main></div>;
}
