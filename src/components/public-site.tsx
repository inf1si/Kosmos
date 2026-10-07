'use client';

import { documentTitle } from '@/lib/model';

import { z } from 'zod';
import { useEffect, useState, type ReactNode, useRef } from 'react';
import Link from 'next/link';
import { List, Settings2, X, Link2 } from 'lucide-react';
import { Publication, RichNode, footnotes, plainText } from '@/lib/model';
import { db } from '@/lib/database';
import { seedWorkspace } from '@/lib/seed';
import { paragraphStyle,cellSpan,tableColumns,inlineFontSize,listStyleType } from '@/lib/manuscript-format';
import { THEME_KEY, preferredPalette } from '@/lib/theme';
import { Popover, type PopoverAnchor } from './primitives';
import { ThemeControls, paletteOptions, useSitePalette, useSiteTheme } from './theme-toggle';
import { manuscriptFonts, fontSizes, validFontSize } from '@/lib/editor-preferences';
import { LIBRARY_SORT_KEY, librarySort, librarySorts, previewPublications, sortPublications, type LibrarySort } from '@/lib/library-order';

function usePublicData(initial:Publication[],localPreview:boolean){
  const [data,setData]=useState(initial);const [loading,setLoading]=useState(localPreview);
  useEffect(()=>{if(!localPreview)return;void db.workspaces.get('preview').then(row=>{const state=row?.data||seedWorkspace();setData(previewPublications(state));}).finally(()=>setLoading(false));},[localPreview]);

return{data,loading};
}

function PublicHeader({children}:{children?:ReactNode}){return <header className="public-header"><Link href="/library" className="public-brand"><span className="public-brand-mark" aria-hidden="true">◌</span>Orbis Tertius</Link><nav>{children}<Link className="studio-link" href="/studio">집필실</Link><ThemeControls/></nav></header>;}

/** A typographic cover: works have no cover art, so the title is set on the brand colour under the ◌ orbit. */
function BookCover({pub}:{pub:Publication}){return <Link className="book-cover" href={`/read/${pub.workId}`} tabIndex={-1} aria-hidden="true"><svg width="170" height="170" viewBox="0 0 170 170"><circle cx="85" cy="85" r="70" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="1.5 7" strokeLinecap="round"/><circle cx="85" cy="85" r="44" fill="none" stroke="currentColor" strokeOpacity=".5"/></svg><span className="book-cover-series">ORBIS TERTIUS</span><span><strong>{pub.title}</strong><small>소설</small></span></Link>;}

export function Library({initial,localPreview,error}:{initial:Publication[];localPreview:boolean;error?:string}){
  const {data,loading}=usePublicData(initial,localPreview);
  const [sort,setSort]=useState<LibrarySort>('author');
  useEffect(()=>{try{setSort(librarySort(localStorage.getItem(LIBRARY_SORT_KEY)));}catch{}},[]);
  const ordered=sortPublications(data,sort);
  const latest=data.length?new Date(Math.max(...data.map(p=>new Date(p.publishedAt).getTime()))).toLocaleDateString('ko-KR'):'';

  return <div className="public-site"><PublicHeader/><main className="library"><div className="library-heading"><h1>수록 작품</h1>{!loading&&<span>{data.length}편</span>}{latest&&<small>마지막 공개 {latest}</small>}</div>{localPreview&&<div className="preview-label">기기 내 미리보기 · 예시 작품을 포함합니다</div>}{error&&<p role="alert">{error}</p>}
    <div className="library-sort"><label>정렬<select aria-label="서재 정렬" value={sort} onChange={e=>{const next=librarySort(e.target.value);setSort(next);

try{localStorage.setItem(LIBRARY_SORT_KEY,next);}catch{}}}>{Object.entries(librarySorts).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div>
    {loading?<p className="muted">서재를 여는 중입니다.</p>:data.length?<div className="book-list">{ordered.map((p,i)=><article className="book-entry" key={p.id}><BookCover pub={p}/><div className="book-info"><span className="book-category">{String(i+1).padStart(2,'0')} · 소설 · {p.scenes.length}개 장면</span><Link href={`/read/${p.workId}`}><h2>{p.title}</h2></Link><p className="book-subtitle">{p.subtitle}</p><p className="book-description">{p.description}</p><div className="book-actions"><Link className="book-read" href={`/read/${p.workId}`}>작품 읽기<span aria-hidden="true">→</span></Link><Link className="book-wiki" href={`/wiki/${p.workId}`}>설정집</Link><span>{new Date(p.publishedAt).toLocaleDateString('ko-KR')}</span></div></div><div className="book-excerpt"><span>본문 미리보기</span><p>{plainText(p.scenes[0].content).split('\n\n').find(text=>text.trim())?.replace(/\s+/g,' ').trim()}</p></div></article>)}</div>:<div className="empty-library"><h2>아직 공개한 작품이 없습니다.</h2><p>첫 작품이 준비되면 이곳에서 읽을 수 있습니다.</p></div>}
    <footer className="public-footer">Orbis Tertius</footer></main></div>;
}

function NoteLink({id,text,index}:{id:string;text:string;index:number}){
  const [open,setOpen]=useState(false);

  return <span className="note-anchor" onMouseEnter={()=>setOpen(true)} onMouseLeave={()=>setOpen(false)}><a id={`ref-${id}`} href={`#note-${id}`} className="note-number" aria-label={`각주 ${index}: ${text}`} onFocus={()=>setOpen(true)} onBlur={()=>setOpen(false)}>{index}</a>{open&&<span className="note-popover" role="tooltip"><strong>각주 {index}</strong>{text}</span>}</span>;
}

export function RichReader({content,publication,onWiki}:{content:RichNode;publication:Publication;onWiki:(id:string,link:HTMLElement)=>void}){
  const notes=publication.scenes.flatMap(scene=>footnotes(scene.content));

  function node(n:RichNode,key:string):ReactNode{
    if(n.type==='text'){
      let text:ReactNode=n.text;

      for(const m of n.marks||[]){
        if(m.type==='bold')text=<strong>{text}</strong>;else if(m.type==='italic')text=<em>{text}</em>;else if(m.type==='underline')text=<u>{text}</u>;else if(m.type==='strike')text=<s>{text}</s>;else if(m.type==='code')text=<code>{text}</code>;else if(m.type==='superscript')text=<sup>{text}</sup>;else if(m.type==='subscript')text=<sub>{text}</sub>;else if(m.type==='highlight')text=<mark>{text}</mark>;
        // The author picks sizes against the 18px manuscript; the reader's own size choice scales them the same way.
        else if(m.type==='fontSize'){const size=inlineFontSize(m.attrs?.size);

if(size)text=<span style={{fontSize:`${+(size/18).toFixed(4)}em`}}>{text}</span>;}
        else if(m.type==='wikiLink'){const target=String(m.attrs?.targetId||'');const setting=publication.wiki.find(w=>w.id===target);

if(setting)text=<button className="reader-wiki-link" title={setting.summary} aria-haspopup="dialog" onClick={e=>onWiki(target,e.currentTarget)}>{text}</button>;}
        else if(m.type==='link'){const href=String(m.attrs?.href||'');

if(/^https?:\/\//i.test(href))text=<a href={href} target="_blank" rel="noopener noreferrer">{text}</a>;}
      }

      return <span key={key}>{text}</span>;
    }

    if(n.type==='footnote'){const id=String(n.attrs?.noteId||key);const index=notes.findIndex(note=>note.id===id)+1;

return <NoteLink key={key} id={id} index={index} text={String(n.attrs?.text||'')}/>;}

    const children=n.content?.map((c,i)=>node(c,`${key}.${i}`));const blockId=z.string().safeParse(n.attrs?.blockId),id=blockId.success?blockId.data:undefined;
    const style=paragraphStyle(n.attrs);

    if(n.type==='paragraph')return <p key={key} id={id} style={style}>{children}</p>;

    if(n.type==='heading'){const level=Number(n.attrs?.level);

return level===1?<h2 key={key} id={id} style={style}>{children}</h2>:level===3?<h4 key={key} id={id} style={style}>{children}</h4>:<h3 key={key} id={id} style={style}>{children}</h3>;}

    if(n.type==='table'){const widths=tableColumns(n.content?.[0]);

return <div className="reader-table" key={key}><table aria-label="본문 표" style={{minWidth:widths.reduce<number>((sum,w)=>sum+(w??60),0)}}><colgroup>{widths.map((w,i)=><col key={i} style={{width:w}}/>)}</colgroup><tbody>{children}</tbody></table></div>;}

    if(n.type==='tableRow')return <tr key={key}>{children}</tr>;

    if(n.type==='tableHeader')return <th key={key} colSpan={cellSpan(n.attrs?.colspan)} rowSpan={cellSpan(n.attrs?.rowspan)}>{children}</th>;

    if(n.type==='tableCell')return <td key={key} colSpan={cellSpan(n.attrs?.colspan)} rowSpan={cellSpan(n.attrs?.rowspan)}>{children}</td>;

    if(n.type==='blockquote')return <blockquote key={key}>{children}</blockquote>;

    if(n.type==='bulletList')return <ul key={key} style={{listStyleType:listStyleType(n)}}>{children}</ul>;

    if(n.type==='orderedList')return <ol key={key} start={Number(n.attrs?.start)>1?Number(n.attrs?.start):undefined} style={{listStyleType:listStyleType(n)}}>{children}</ol>;

    if(n.type==='listItem')return <li key={key}>{children}</li>;

    if(n.type==='hardBreak')return <br key={key}/>;

    if(n.type==='horizontalRule')return <hr key={key}/>;

    if(n.type==='codeBlock')return <pre key={key}><code>{children}</code></pre>;

    return <span key={key}>{children}</span>;
  }

  return <>{content.content?.map((n,i)=>node(n,String(i)))}</>;
}

export function Reader({workId,initial,localPreview,fontClassName=''}:{workId:string;initial:Publication[];localPreview:boolean;fontClassName?:string}){
  const {data,loading}=usePublicData(initial,localPreview);const pub=data.find(p=>p.workId===workId);
  const [settings,setSettings]=useState(false);const [toc,setToc]=useState(false);const [wikiId,setWikiId]=useState<string|null>(null);const wikiAnchor:PopoverAnchor=useRef(null);
  const [font,setFont]=useState('gowun');const [size,setSize]=useState(19);const [sizeDraft,setSizeDraft]=useState('19');const [width,setWidth]=useState(680);const [theme,setTheme]=useSiteTheme();const [palette,setPalette]=useSitePalette();const [progress,setProgress]=useState(0);
  const restored=useRef(false);
  const [preferencesLoaded,setPreferencesLoaded]=useState(false);
  // The reader's old 밝게/어둡게 preference carries over once, until the site-wide toggle saves its own choice.
  useEffect(()=>{try{const prefs=JSON.parse(localStorage.getItem('orbit-reader-prefs')||'null');

if(prefs){const storedFont=manuscriptFonts.find(item=>item.id===prefs.font);

if(storedFont)setFont(storedFont.id);else if(prefs.font==='sans')setFont('ibm-plex');

if(validFontSize(prefs.size))setSize(prefs.size);

if([580,680,780].includes(prefs.width))setWidth(prefs.width);

if(prefs.theme==='night'&&!localStorage.getItem(THEME_KEY))setTheme('dark');}}catch{}

setPreferencesLoaded(true);},[]);
  useEffect(()=>{if(!preferencesLoaded)return;

try{localStorage.setItem('orbit-reader-prefs',JSON.stringify({font,size,width}));}catch{}},[font,size,width,preferencesLoaded]);
  useEffect(()=>setSizeDraft(String(size)),[size]);

  function commitSize(){const value=Number(sizeDraft);

    if(sizeDraft.trim()&&validFontSize(value))setSize(value);else setSizeDraft(String(size));
  }

  useEffect(()=>{
    if(!pub)return;
    const key=`orbit-reading:${workId}`;let timer:ReturnType<typeof setTimeout>|undefined;

    if(!restored.current){restored.current=true;

try{const saved=JSON.parse(localStorage.getItem(key)||'null');

if(saved?.blockId)requestAnimationFrame(()=>{const el=document.getElementById(saved.blockId);

if(el)window.scrollTo(0,el.getBoundingClientRect().top+window.scrollY-Number(saved.offset||90));});}catch{}}

    const scroll=()=>{const max=document.documentElement.scrollHeight-window.innerHeight;setProgress(max>0?Math.round(window.scrollY/max*100):0);

if(timer)clearTimeout(timer);timer=setTimeout(()=>{const blocks=[...document.querySelectorAll<HTMLElement>('.reading-body p[id]')];const current=blocks.find(el=>el.getBoundingClientRect().top>=-120)||blocks.at(-1);

if(current)try{localStorage.setItem(key,JSON.stringify({blockId:current.id,offset:current.getBoundingClientRect().top,publicationId:pub.id}));}catch{}},300);};

    window.addEventListener('scroll',scroll,{passive:true});

return()=>{window.removeEventListener('scroll',scroll);

if(timer)clearTimeout(timer);};
  },[pub,workId]);

  if(loading)return <div className="public-site"><PublicHeader/><p className="public-loading">작품을 여는 중입니다.</p></div>;

  if(!pub)return <div className="public-site"><PublicHeader/><div className="public-loading"><h1>아직 공개되지 않은 작품입니다.</h1><Link href="/library">서재로 돌아가기</Link></div></div>;
  const selectedFont=manuscriptFonts.find(item=>item.id===font)||manuscriptFonts[0];
  const sizes=fontSizes.includes(size)?fontSizes:[...fontSizes,size].sort((a,b)=>a-b);
  const wiki=pub.wiki.find(w=>w.id===wikiId);const notes=pub.scenes.flatMap(scene=>footnotes(scene.content)).filter((n,i,a)=>a.findIndex(x=>x.id===n.id)===i);

  return <div className={`public-site reader ${fontClassName}`} style={/* SAFETY: React forwards CSS custom properties whose values here are strings or numbers. */ {'--reading-size':`${size}px`,'--reading-width':`${width}px`,'--reading-font':selectedFont.family} as React.CSSProperties}><PublicHeader><Link href={`/wiki/${workId}`}>설정집</Link></PublicHeader>
    <div className="reading-controls"><button onClick={()=>setToc(v=>!v)}><List size={17}/>목차</button><span>{pub.title}</span><Popover open={settings} onOpenChange={next=>{setSettings(next);

if(!next)setSizeDraft(String(size));}} align="end" width={340} title="읽기 설정" trigger={<button><Settings2 size={17}/>읽기 설정</button>}><div className="reading-preferences"><label className="reading-font">글꼴<select value={font} onChange={e=>setFont(e.target.value)}>{manuscriptFonts.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>글자 크기<select value={size} onChange={e=>setSize(Number(e.target.value))}>{sizes.map(value=><option key={value} value={value}>{value}px</option>)}</select></label><label>크기 직접 입력 (px)<input type="number" inputMode="decimal" min={10} max={72} step={0.5} value={sizeDraft} title="10–72px · 0.5px 단위" onChange={e=>setSizeDraft(e.target.value)} onBlur={commitSize} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();commitSize();e.currentTarget.blur();}}}/></label><label>본문 폭<select value={width} onChange={e=>setWidth(Number(e.target.value))}><option value={580}>좁게</option><option value={680}>기본</option><option value={780}>넓게</option></select></label><label>배경<select value={theme} onChange={e=>setTheme(e.target.value==='dark'?'dark':'light')}><option value="light">밝게</option><option value="dark">어둡게</option></select></label><label>테마<select value={palette} onChange={e=>setPalette(preferredPalette(e.target.value))}>{paletteOptions.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div></Popover></div>
    <div className="reading-progress" style={{width:`${progress}%`}}/>
    {toc&&<aside className="reading-toc"><div><h2>목차</h2><button aria-label="목차 닫기" onClick={()=>setToc(false)}><X size={18}/></button></div>{pub.scenes.map(scene=><a key={scene.id} href={`#scene-${scene.id}`} onClick={()=>setToc(false)}>{documentTitle(scene)}</a>)}</aside>}
    <main className="reading-page"><header className="reading-title"><span>소설</span><h1>{pub.title}</h1><p>{pub.subtitle}</p></header>{pub.scenes.map(scene=><section key={scene.id} className="reading-scene" id={`scene-${scene.id}`}><div className="reading-scene-title"><span>{scene.chapter}</span><h2>{documentTitle(scene)}</h2></div><div className="reading-body"><RichReader content={scene.content} publication={pub} onWiki={(id,link)=>{wikiAnchor.current=link;setWikiId(id);}}/></div></section>)}
      {notes.length>0&&<section className="reading-notes"><h2>주석</h2><ol>{notes.map((note,i)=><li id={`note-${note.id}`} key={note.id}><a href={`#ref-${note.id}`} aria-label={`각주 ${i+1} 본문으로 돌아가기`}>{i+1}</a><p>{note.text}</p></li>)}</ol></section>}
      <footer className="reading-end"><span>여기까지 공개되었습니다.</span><div><Link href="/library">작품 목록</Link><Link href={`/wiki/${workId}`}>설정집 읽기</Link></div><small>공개 판본 · {new Date(pub.publishedAt).toLocaleDateString('ko-KR')}</small></footer>
    </main>
    
    <Popover open={!!wiki} onOpenChange={open=>{if(!open)setWikiId(null);}} anchor={wikiAnchor} width={320} className="wiki-card" title={wiki?.title||'설정'} onReturnFocus={()=>wikiAnchor.current instanceof HTMLElement&&wikiAnchor.current.focus()}>{wiki&&<><span className="wiki-category">{wiki.category}</span><p className="wiki-summary">{wiki.summary}</p><Link className="button" href={`/wiki/${workId}?doc=${wiki.id}`}>설정 문서 열기</Link></>}</Popover>
  </div>;
}

export function Wiki({workId,initial,localPreview,initialDoc}:{workId:string;initial:Publication[];localPreview:boolean;initialDoc?:string}){
  const {data,loading}=usePublicData(initial,localPreview);const pub=data.find(p=>p.workId===workId);
  const [active,setActive]=useState(initialDoc||'');const [query,setQuery]=useState('');

  if(loading)return <div className="public-site"><PublicHeader/><p className="public-loading">설정집을 여는 중입니다.</p></div>;

  if(!pub)return <div className="public-site"><PublicHeader/><div className="public-loading">공개 설정집이 없습니다.</div></div>;
  const docs=pub.wiki.filter(d=>`${documentTitle(d)} ${d.summary}`.includes(query));const doc=pub.wiki.find(d=>d.id===active)||docs[0];
  const appearances=doc?pub.scenes.filter(scene=>JSON.stringify(scene.content).includes(doc.id)):[];

  return <div className="public-site"><PublicHeader><Link href={`/read/${workId}`}>작품 읽기</Link></PublicHeader><main className="wiki-page"><header className="wiki-heading"><h1>{pub.title} <span>설정집</span></h1><p>공개 설정 {pub.wiki.length}개</p></header><div className="wiki-layout"><aside className="wiki-nav"><input aria-label="설정집 검색" value={query} onChange={e=>setQuery(e.target.value)} placeholder="설정집에서 찾기"/>{[...new Set(docs.map(d=>d.category))].map(category=><section key={category}><h2>{category}</h2>{docs.filter(d=>d.category===category).map(d=><button key={d.id} className={doc?.id===d.id?'active':''} onClick={()=>{setActive(d.id);history.replaceState(null,'',`?doc=${d.id}`);}}>{documentTitle(d)}</button>)}</section>)}</aside><article className="wiki-document">{doc?<><span className="wiki-category">{doc.category}</span><h2>{documentTitle(doc)}</h2><div className="wiki-meta">{pub.title}의 공개 설정</div><p className="wiki-summary">{doc.summary}</p><section className="wiki-appearances"><h3><Link2 size={17}/>작품에서 등장하는 곳</h3>{appearances.map(scene=><Link href={`/read/${workId}#scene-${scene.id}`} key={scene.id}>{documentTitle(scene)}</Link>)}</section></>:<p className="muted">공개된 설정 문서가 없습니다.</p>}</article></div></main></div>;
}
