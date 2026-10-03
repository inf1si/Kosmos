'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Archive, ArrowDown, ArrowLeftRight, ArrowUp, CassetteTape, ChevronLeft, ChevronRight, ChevronsUpDown, Clock3, Cloud, Columns2, FileText, Globe2, HardDrive, LayoutGrid, Link2, Lock, Maximize2, MoreHorizontal, Network, NotebookPen, PanelLeft, PanelRight, Paperclip, Plus, Save, Search, Send, Settings2, SlidersHorizontal, Sparkles, StickyNote, User, X } from 'lucide-react';
import { useStudio } from './studio-provider';
import { TooltipProvider, IconButton, Modal } from './primitives';
import { RichEditor } from './rich-editor';
import { PlotBoard } from './plot-board';
import { DocumentGraph } from './document-graph';
import { DocumentTree } from './document-tree';
import { WikiIcon } from './studio-icons';
import { ThemeControls } from './theme-toggle';
import { StudioDialogs } from './studio-dialogs';
import { AIChat } from './ai-chat';
import { EditableCombobox } from './editable-combobox';
import { useDrawerFocus } from './use-drawer-focus';
import { NovelDocument, Work, newDocument, statuses, wikiReferences } from '@/lib/model';
import { countChars } from '@/lib/outline';
import { childrenOf, insertDocument, moveNavigation, resolveNavigation, siblingDestination } from '@/lib/document-navigation';
import { cloudConfigured, cloud } from '@/lib/cloud';
import { db } from '@/lib/database';

const BOARD='board';
const GRAPH='graph';
type Reference='links'|'files'|'ai';
const kinds={scene:'원고',wiki:'설정집',memo:'메모 · 리서치'} as const;
// Below this width the sidebar floats over the editor and closes after a document opens.
const narrow=()=>window.matchMedia('(max-width: 900px)').matches;
const modal=(detail:string)=>window.dispatchEvent(new CustomEvent('studio-modal',{detail}));

/** Closes a popover on a click outside it or Escape, returning focus to its toggle. */
function useDismiss(open:boolean,setOpen:(open:boolean)=>void){
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!open)return;const down=(e:PointerEvent)=>{if(!ref.current?.contains(e.target as Node))setOpen(false);};const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);ref.current?.querySelector<HTMLElement>('[aria-expanded]')?.focus();}};document.addEventListener('pointerdown',down);document.addEventListener('keydown',key);return()=>{document.removeEventListener('pointerdown',down);document.removeEventListener('keydown',key);};},[open,setOpen]);
  return ref;
}

export function Studio(){
  const s=useStudio();const [workId,setWorkId]=useState('');const [current,setCurrent]=useState('');const [lastDoc,setLastDoc]=useState('');const [tabs,setTabs]=useState<string[]>([]);
  const [back,setBack]=useState<string[]>([]);const [forward,setForward]=useState<string[]>([]);const [splitId,setSplitId]=useState<string|null>(null);const [splitWidth,setSplitWidth]=useState(50);
  const [focus,setFocus]=useState(false);const [sidebar,setSidebar]=useState(true);const [reference,setReference]=useState<Reference|null>(null);const [properties,setProperties]=useState(false);
  const [query,setQuery]=useState('');const [searching,setSearching]=useState(false);
  const [workMenu,setWorkMenu]=useState(false);const [moreMenu,setMoreMenu]=useState(false);const [workSettings,setWorkSettings]=useState(false);
  const [compact,setCompact]=useState(false);const sidebarRef=useRef<HTMLElement>(null);const referenceRef=useRef<HTMLElement>(null);
  const closeSidebar=useCallback(()=>setSidebar(false),[]);const closeReference=useCallback(()=>setReference(null),[]);
  useDrawerFocus(compact&&sidebar&&!focus&&!s.loading,sidebarRef,closeSidebar,'sidebar-toggle');
  useDrawerFocus(compact&&!!reference&&!focus&&!s.loading,referenceRef,closeReference,'reference-toggle');
  const workMenuRef=useDismiss(workMenu,setWorkMenu);const moreMenuRef=useDismiss(moreMenu,setMoreMenu);
  function openSearch(){setReference(null);setFocus(false);setSidebar(true);setSearching(true);setTimeout(()=>document.getElementById('workspace-search')?.focus(),30);}
  useEffect(()=>{const media=window.matchMedia('(max-width: 900px)');setCompact(media.matches);if(media.matches)setSidebar(false);const resize=()=>{setCompact(media.matches);if(media.matches)setSidebar(false);};media.addEventListener('change',resize);return()=>media.removeEventListener('change',resize);},[]);
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&(e.code==='KeyK'||e.key.toLowerCase()==='k')){e.preventDefault();openSearch();}};window.addEventListener('keydown',onKey,true);return()=>window.removeEventListener('keydown',onKey,true);},[]);
  useEffect(()=>{const list=document.querySelector('.tab-list');if(!list)return;const reveal=()=>list.querySelector('.doc-tab.active')?.scrollIntoView({block:'nearest',inline:'nearest'});const observer=new ResizeObserver(reveal);observer.observe(list);reveal();return()=>observer.disconnect();},[current,compact,s.loading]);
  if(s.loading)return <div className="loading-screen"><NotebookPen size={28}/><p>집필실을 여는 중입니다.</p></div>;
  if(!s.canUse)return <Login/>;
  if(!s.state)return <div className="loading-screen">원고를 불러오지 못했습니다. {s.error}</div>;
  const work=s.state.works.find(w=>w.id===workId)||s.state.works[0];const docs=work.documents;
  const onBoard=current===BOARD,onGraph=current===GRAPH,onOverview=onBoard||onGraph;
  const active=docs.find(d=>d.id===(onOverview?lastDoc:current))||docs.find(d=>d.id===lastDoc)||docs.find(d=>d.kind==='scene')||docs[0];
  const view=onGraph?GRAPH:onBoard?BOARD:active.id;
  const openTabs=[...new Set([...(tabs.length?tabs:[view]),view])].filter(id=>id===BOARD||id===GRAPH||docs.some(d=>d.id===id));
  const split=onOverview?undefined:docs.find(d=>d.id===splitId&&d.id!==active.id);
  const scenes=docs.filter(d=>d.kind==='scene');const wiki=docs.filter(d=>d.kind==='wiki');
  const references=new Map(docs.map(d=>[d.id,wikiReferences(d.content)]));const appearances:Record<string,number>={};for(const ids of references.values())for(const id of ids)appearances[id]=(appearances[id]||0)+1;
  const linked=(references.get(active.id)||[]).map(id=>docs.find(d=>d.id===id)).filter((d):d is NovelDocument=>!!d);const backlinks=docs.filter(d=>d.id!==active.id&&references.get(d.id)?.includes(active.id));
  const navigation=resolveNavigation(work),placement=navigation.nodes.find(n=>n.id===active.id);
  const siblings=placement?childrenOf(navigation,placement.parentId,placement.sectionId).map(n=>n.id):[];const position=siblings.indexOf(active.id);
  const showSidebar=sidebar&&!focus;const readonly=!!s.conflict;const total=scenes.reduce((n,d)=>n+countChars(d),0);
  function show(id:string){setCurrent(id);if(id!==BOARD&&id!==GRAPH)setLastDoc(id);else setReference(null);setTabs(t=>[...new Set([...(t.length?t:[view]),id])]);setProperties(false);if(narrow())setSidebar(false);}
  function go(id:string){if(id===view)return;setBack(b=>[...b,view].slice(-50));setForward([]);show(id);}
  function goBack(){const previous=back.at(-1);if(!previous)return;setBack(b=>b.slice(0,-1));setForward(f=>[view,...f]);show(previous);}
  function goForward(){const next=forward[0];if(!next)return;setForward(f=>f.slice(1));setBack(b=>[...b,view]);show(next);}
  function closeTab(id:string){const remaining=openTabs.filter(v=>v!==id);setTabs(remaining);if(id===view){const next=remaining.at(-1)!;show(next);setTabs(remaining);}}
  function openDoc(id:string,beside=false){if(beside&&!onOverview){setSplitId(id===active.id?null:id);return;}if(id===splitId)setSplitId(active.id);go(id);}
  function switchWork(id:string){setWorkId(id);setCurrent('');setLastDoc('');setTabs([]);setBack([]);setForward([]);setSplitId(null);setProperties(false);setWorkMenu(false);}
  function patchDoc(id:string,patch:Partial<NovelDocument>){s.update(state=>({...state,works:state.works.map(w=>w.id===work.id?{...w,documents:w.documents.map(d=>d.id===id?{...d,...patch,updatedAt:new Date().toISOString()}:d)}:w)}));}
  function patchWork(patch:{title?:string;subtitle?:string;description?:string}){s.update(state=>({...state,works:state.works.map(w=>w.id===work.id?{...w,...patch}:w)}));}
  function organizeWork(fn:(latest:Work)=>Work){s.update(state=>({...state,works:state.works.map(w=>w.id===work.id?fn(w):w)}));}
  // A new scene joins the part it belongs to: the given one, the open scene's, or the last.
  function createDoc(kind:NovelDocument['kind'],chapter?:string,open=true){
    const d=newDocument(kind,kind==='scene'?'새 장면':kind==='wiki'?'새 설정':'새 메모');if(kind==='scene')d.chapter=chapter??(active.kind==='scene'?active.chapter:scenes.at(-1)?.chapter??'제1부');
    organizeWork(w=>{const nav=resolveNavigation(w),neighbor=w.documents.findLast(item=>item.kind===kind&&(kind!=='scene'||item.chapter===d.chapter)),node=nav.nodes.find(n=>n.id===neighbor?.id);return insertDocument(w,d,node?{sectionId:node.sectionId,parentId:node.parentId}:undefined);});if(open)openDoc(d.id);
  }
  function moveDoc(direction:number){if(readonly)return;organizeWork(w=>{const to=siblingDestination(w,active.id,direction);return to?moveNavigation(w,active.id,to):w;});}
  async function downloadAsset(id:string){try{const meta=s.state!.assets.find(a=>a.id===id)!;let blob=(await db.assets.get([s.namespace,id]))?.blob;if(!blob&&cloudConfigured){const result=await cloud().storage.from('private-assets').download(`${s.user}/${id}`);if(result.error)throw result.error;blob=result.data||undefined;}if(!blob)throw new Error('첨부를 찾지 못했습니다.');const href=URL.createObjectURL(blob);const a=document.createElement('a');a.href=href;a.download=meta.name;a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);}catch(e){alert(e instanceof Error?e.message:'첨부를 열지 못했습니다.');}}
  return <TooltipProvider><div className={`studio ${focus?'focus-mode':''}`}>
    {showSidebar&&<div className="sidebar-backdrop" aria-hidden="true" onClick={()=>setSidebar(false)}/>}
    {showSidebar&&<aside className="studio-sidebar" aria-label="작품 탐색" ref={sidebarRef} role={compact?'dialog':undefined} aria-modal={compact||undefined}>
      <div className="sidebar-close"><IconButton label="작품 탐색 닫기" data-drawer-close onClick={closeSidebar}><X size={17}/></IconButton></div>
      <Link className="studio-brand" href="/"><span aria-hidden="true">◌</span>Orbis Tertius</Link><span className="studio-stripes" aria-hidden="true"/>
      <div className="work-switcher" ref={workMenuRef}>
        <button type="button" className="work-card" title="작품 전환" aria-expanded={workMenu} aria-controls="work-menu" onClick={()=>setWorkMenu(v=>!v)}><span className="work-cover" aria-hidden="true">◌</span><span><strong>{work.title}</strong><small>{work.form} · 장면 {scenes.length} · {total.toLocaleString()}자</small></span><ChevronsUpDown size={15}/><span className="work-side" aria-hidden="true">SIDE {String.fromCharCode(65+s.state.works.indexOf(work)%26)}<CassetteTape size={14}/></span><span className="work-tag" aria-hidden="true">ORB-{String(s.state.works.indexOf(work)+1).padStart(2,'0')}</span></button>
        {workMenu&&<div id="work-menu" className="popover-menu work-menu">{s.state.works.map(w=><button type="button" key={w.id} aria-current={w.id===work.id||undefined} onClick={()=>switchWork(w.id)}><span>{w.title}</span><small>{w.form}</small></button>)}<span className="menu-divider"/><button type="button" onClick={()=>{setWorkMenu(false);modal('new-work');}}><Plus size={15}/>새 작품</button><button type="button" onClick={()=>{setWorkMenu(false);setWorkSettings(true);}}><Settings2 size={15}/>작품 정보 편집</button></div>}
      </div>
      <nav className="studio-tools" aria-label="작업 도구">
        {searching||query?<div className="sidebar-search"><Search size={15}/><input id="workspace-search" aria-label="작품 내 검색" placeholder="제목과 본문에서 찾기" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'){setQuery('');setSearching(false);}}}/><IconButton label="검색 닫기" onClick={()=>{setQuery('');setSearching(false);}}><X size={14}/></IconButton></div>
          :<button type="button" className="nav-item" onClick={openSearch}><Search size={16}/><span>검색</span><kbd>Ctrl K</kbd></button>}
        <button type="button" className="nav-item" aria-pressed={onBoard} onClick={()=>go(BOARD)}><LayoutGrid size={16}/><span>플롯보드</span></button>
        <button type="button" className="nav-item" aria-pressed={onGraph} onClick={()=>go(GRAPH)}><Network size={16}/><span>문서 그래프</span></button>
        <button type="button" className="nav-item" onClick={()=>modal('backup')}><Archive size={16}/><span>백업과 복구</span></button>
        <button type="button" className="nav-item" onClick={()=>modal('interchange')}><ArrowLeftRight size={16}/><span>가져오기 · 내보내기</span></button>
      </nav>
      <div className="sidebar-scroll">
        <DocumentTree key={`${work.id}-${s.epoch}`} work={work} query={query} activeId={view} readonly={readonly} onOpen={openDoc} onChange={organizeWork}/>
      </div>
      <footer className="sidebar-footer"><div><span className={`save-state ${s.error||s.conflict?'is-error':''}`} aria-live="polite">{cloudConfigured?<Cloud size={14}/>:<HardDrive size={14}/>}<span>{s.status}</span></span><Link className="icon-button" href="/library" aria-label="공개 서재" title="공개 서재"><Globe2 size={16}/></Link><IconButton label="작품 정보" onClick={()=>setWorkSettings(true)}><Settings2 size={16}/></IconButton></div><ThemeControls/></footer>
    </aside>}
    <main className="studio-panel">
      <div className="panel-tabs">
        <IconButton id="sidebar-toggle" label={showSidebar?'사이드바 닫기':'사이드바 열기'} aria-pressed={showSidebar} onClick={()=>{if(compact)setReference(null);if(focus){setFocus(false);setSidebar(true);}else setSidebar(v=>!v);}}><PanelLeft size={16}/></IconButton>
        <IconButton label="뒤로" className="icon-button history-button" disabled={!back.length} onClick={goBack}><ChevronLeft size={16}/></IconButton>
        <IconButton label="앞으로" className="icon-button history-button" disabled={!forward.length} onClick={goForward}><ChevronRight size={16}/></IconButton>
        <div className="tab-list" role="tablist" aria-label="열린 문서">{openTabs.map(id=>{const d=docs.find(x=>x.id===id);const title=d?.title||(id===GRAPH?'문서 그래프':'플롯보드');return <div className={`doc-tab ${id===view?'active':''}`} key={id}>{d?<DocIcon doc={d}/>:id===GRAPH?<Network size={14}/>:<LayoutGrid size={14}/>}<button type="button" role="tab" aria-selected={id===view} onClick={()=>go(id)}>{title}</button>{openTabs.length>1&&<button type="button" className="tab-close" aria-label={`${title} 탭 닫기`} onClick={()=>closeTab(id)}><X size={12}/></button>}</div>;})}</div>
        <span className="tab-spacer"/>
        <IconButton label="옆에 열기" aria-pressed={!!split} disabled={onOverview} onClick={()=>setSplitId(split?null:(wiki.find(d=>d.id!==active.id)||docs.find(d=>d.id!==active.id))?.id||null)}><Columns2 size={16}/></IconButton>
        <IconButton id="reference-toggle" label="참고 패널" aria-pressed={!!reference&&!focus} disabled={onOverview} onClick={()=>{setFocus(false);setReference(r=>r&&!focus?null:'links');}}><PanelRight size={16}/></IconButton>
        <div className="menu-anchor" ref={moreMenuRef}><IconButton label="더 보기" aria-expanded={moreMenu} aria-controls="more-menu" onClick={()=>setMoreMenu(v=>!v)}><MoreHorizontal size={16}/></IconButton>
          {moreMenu&&<div id="more-menu" className="popover-menu more-menu">
            <button type="button" aria-pressed={focus} onClick={()=>{setMoreMenu(false);setFocus(v=>!v);}}><Maximize2 size={15}/>{focus?'집중 모드 끝내기':'집중 모드'}</button>
            <button type="button" disabled={readonly||onOverview||position<=0} onClick={()=>moveDoc(-1)}><ArrowUp size={15}/>문서 위로 옮기기</button>
            <button type="button" disabled={readonly||onOverview||position>=siblings.length-1} onClick={()=>moveDoc(1)}><ArrowDown size={15}/>문서 아래로 옮기기</button>
            <button type="button" onClick={()=>{setMoreMenu(false);void s.snapshot(`${active.title} · 수동 저장`).catch(e=>alert(e.message));}}><Save size={15}/>복구 지점 만들기</button>
            <span className="menu-divider"/>
            <button type="button" onClick={()=>{setMoreMenu(false);setWorkSettings(true);}}><Settings2 size={15}/>작품 정보 편집</button>
            <button type="button" onClick={()=>{setMoreMenu(false);modal('new-work');}}><Plus size={15}/>새 작품</button>
          </div>}
        </div>
        <button type="button" className="primary publish-button" onClick={()=>modal('publish')}><Send size={14}/>게시 준비</button>
      </div>
      {s.error&&<button type="button" className="studio-error" title="닫기" onClick={s.clearError}><span>{s.error}</span><X size={14}/></button>}
      {onGraph?<DocumentGraph key={work.id} documents={docs} initialDocumentId={active.id} onOpen={id=>openDoc(id)}/>
      :onBoard?<PlotBoard documents={docs} onOpen={id=>openDoc(id)} onCreate={chapter=>createDoc('scene',chapter,false)}/>
      :<div className="editor-row"><div className={`editor-panes ${split?'is-split':''}`} style={{'--split-percent':`${splitWidth}%`} as React.CSSProperties}>
        <RichEditor key={`${active.id}-${s.epoch}`} doc={active} onChange={content=>patchDoc(active.id,{content})} wiki={wiki} onWikiClick={id=>openDoc(id,true)} readonly={readonly} appearances={appearances}
          heading={<DocHead doc={active} wiki={wiki} linked={linked.length} backlinks={backlinks.length} attachments={active.assetIds.length} readonly={readonly} open={properties} onToggle={()=>setProperties(v=>!v)} onPatch={patch=>patchDoc(active.id,patch)} onOpenBeside={id=>openDoc(id,true)} onReference={setReference}/>}
          toolbarEnd={<><span className="char-count"><span className="tape-counter" aria-hidden="true">{String(countChars(active)).padStart(5,'0')}</span><span className="count-number">{countChars(active).toLocaleString()}</span>자<span className="count-suffix"> · 공백 제외</span></span>{!showSidebar&&<span className="toolbar-status">{s.status}</span>}<span className="toolbar-divider"/><button type="button" className="toolbar-text-button" aria-pressed={reference==='ai'&&!focus} onClick={()=>{setFocus(false);setReference(r=>r==='ai'&&!focus?null:'ai');}}><Sparkles size={15}/>AI 대화</button></>}/>
        {split&&<><div className="split-divider resize-handle" role="separator" aria-label="분할 편집 폭" aria-orientation="vertical" aria-valuenow={splitWidth} aria-valuemin={30} aria-valuemax={70} tabIndex={0} onPointerDown={e=>e.currentTarget.setPointerCapture(e.pointerId)} onPointerMove={e=>{if(e.buttons){const rect=e.currentTarget.parentElement!.getBoundingClientRect();setSplitWidth(Math.max(30,Math.min(70,(e.clientX-rect.left)/rect.width*100)));}}} onKeyDown={e=>{if(e.key==='ArrowLeft')setSplitWidth(v=>Math.max(30,v-2));if(e.key==='ArrowRight')setSplitWidth(v=>Math.min(70,v+2));}}/><div className="split-pane"><div className="split-heading"><span>참고 · {split.title}</span><IconButton label="분할 닫기" onClick={()=>setSplitId(null)}><X size={15}/></IconButton></div><RichEditor key={`${split.id}-${s.epoch}`} doc={split} onChange={content=>patchDoc(split.id,{content})} wiki={wiki} onWikiClick={id=>openDoc(id,true)} readonly={readonly} appearances={appearances}/></div></>}
      </div>
      {reference&&!focus&&<><div className="reference-backdrop" aria-hidden="true" onClick={closeReference}/><aside ref={referenceRef} className={`reference-panel ${reference==='ai'?'is-chat':''}`} aria-label="참고 패널" role={compact?'dialog':undefined} aria-modal={compact||undefined}><div className="reference-tabs" role="tablist" aria-label="참고 자료">{(['links','files','ai'] as const).map(p=><button type="button" role="tab" key={p} aria-selected={reference===p} onClick={()=>setReference(p)}>{p==='links'?'연결':p==='files'?'첨부':'AI 대화'}</button>)}<IconButton label="참고 패널 닫기" data-drawer-close onClick={closeReference}><X size={15}/></IconButton></div><div className="reference-content">
        {reference==='links'?<><h3>연결된 설정</h3>{linked.length?linked.map(d=><button type="button" className="reference-card" key={d.id} onClick={()=>openDoc(d.id,true)}><WikiIcon category={d.category}/><span><strong>{d.title}</strong><small>{d.category||'설정'} · 옆에서 열기</small></span></button>):<p className="muted">본문에 연결한 설정이 없습니다.</p>}<h3>이 문서를 참조하는 문서</h3>{backlinks.length?backlinks.map(d=><button type="button" className="reference-card" key={d.id} onClick={()=>openDoc(d.id)}><DocIcon doc={d}/><span><strong>{d.title}</strong><small>{kinds[d.kind]}</small></span></button>):<p className="muted">아직 참조가 없습니다.</p>}</>
        :reference==='files'?<><h3>첨부 자료</h3>{active.assetIds.length?<div className="asset-list">{active.assetIds.map(id=><button type="button" key={id} onClick={()=>void downloadAsset(id)}><Paperclip size={14}/>{s.state!.assets.find(a=>a.id===id)?.name}</button>)}</div>:<p className="muted">이 문서에 첨부한 이미지가 없습니다.</p>}<label className="asset-upload">이미지 첨부<input aria-label="이미지 첨부" type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const file=e.target.files?.[0];if(file)void s.addAsset(work.id,active.id,file).catch(error=>alert(error.message));e.target.value='';}}/></label></>
        :<AIChat key={`${s.namespace}-${work.id}-${active.id}`} workId={work.id} doc={active} onOpen={id=>openDoc(id,true)}/>}
      </div></aside></>}
      </div>}
    </main>
    <StudioDialogs workId={work.id}/><Modal open={workSettings} onClose={()=>setWorkSettings(false)} title="작품 정보"><div className="form-grid"><label>작품명<input value={work.title} onChange={e=>{if(e.target.value)patchWork({title:e.target.value});}}/></label><label>부제<input value={work.subtitle} onChange={e=>patchWork({subtitle:e.target.value})}/></label><label>작품 소개<textarea rows={4} value={work.description} onChange={e=>patchWork({description:e.target.value})}/></label></div></Modal>
  </div></TooltipProvider>;
}

function DocIcon({doc}:{doc:NovelDocument}){return doc.kind==='wiki'?<WikiIcon category={doc.category} size={14}/>:doc.kind==='memo'?<StickyNote size={14}/>:<FileText size={14}/>;}

/** The title is committed while typing but never left empty; Enter moves into the manuscript. */
function TitleInput({value,disabled,onCommit}:{value:string;disabled:boolean;onCommit:(title:string)=>void}){
  const [draft,setDraft]=useState(value);
  return <input className="doc-title" aria-label="문서 제목" maxLength={300} value={draft} disabled={disabled} onChange={e=>{setDraft(e.target.value);if(e.target.value.trim())onCommit(e.target.value);}} onBlur={()=>{if(!draft.trim())setDraft(value);}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.closest('.editor-scroll')?.querySelector<HTMLElement>('.manuscript')?.focus();}}}/>;
}

/** Title, property chips and the property form above the manuscript. */
function DocHead({doc,wiki,linked,backlinks,attachments,readonly,open,onToggle,onPatch,onOpenBeside,onReference}:{doc:NovelDocument;wiki:NovelDocument[];linked:number;backlinks:number;attachments:number;readonly:boolean;open:boolean;onToggle:()=>void;onPatch:(patch:Partial<NovelDocument>)=>void;onOpenBeside:(id:string)=>void;onReference:(panel:Reference)=>void}){
  const person=doc.pov.trim()?wiki.find(w=>w.title.trim()===doc.pov.trim()):undefined;const shared=doc.isPublic&&!!doc.publicSummary.trim();
  return <div className="doc-head">
    <span className="doc-kicker">{doc.kind==='scene'?doc.chapter||'부 미지정':doc.kind==='wiki'?doc.category||'설정':kinds.memo}</span>
    <TitleInput key={doc.id} value={doc.title} disabled={readonly} onCommit={title=>onPatch({title})}/>
    <div className="doc-chips">
      <label className="chip chip-status"><i className={`status-dot ${doc.status}`} aria-hidden="true"/><select aria-label="진행 상태" value={doc.status} disabled={readonly} onChange={e=>onPatch({status:e.target.value as NovelDocument['status']})}>{Object.entries(statuses).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      {doc.kind==='scene'&&doc.pov.trim()&&(person?<button type="button" className="chip soft" title={`${person.title} 설정을 옆에서 엽니다`} onClick={()=>onOpenBeside(person.id)}><User size={13}/>{doc.pov} 시점</button>:<button type="button" className="chip" onClick={onToggle}><User size={13}/>{doc.pov} 시점</button>)}
      {doc.kind==='scene'&&doc.storyTime.trim()&&<button type="button" className="chip" onClick={onToggle}><Clock3 size={13}/>{doc.storyTime}</button>}
      {doc.kind==='wiki'&&<button type="button" className="chip" onClick={onToggle}>{shared?<Globe2 size={13}/>:<Lock size={13}/>}{shared?'독자 공개':doc.isPublic?'공개 설명 없음':'비공개'}</button>}
      {linked>0&&<button type="button" className="chip" onClick={()=>onReference('links')}><Link2 size={13}/>설정 {linked}</button>}
      {doc.kind==='wiki'&&<button type="button" className="chip" onClick={()=>onReference('links')}><FileText size={13}/>등장 {backlinks}곳</button>}
      {attachments>0&&<button type="button" className="chip" onClick={()=>onReference('files')}><Paperclip size={13}/>첨부 {attachments}</button>}
      {doc.kind!=='memo'&&<button type="button" className="chip ghost" aria-expanded={open} aria-controls="doc-properties" onClick={onToggle}>{open?<X size={13}/>:<SlidersHorizontal size={13}/>}속성</button>}
    </div>
    {open&&doc.kind!=='memo'&&<div className="doc-props" id="doc-properties">{doc.kind==='scene'?<>
      <label>부 · 장 (발행 구분)<input value={doc.chapter} disabled={readonly} placeholder="예: 제1부 · 남겨진 시간" onChange={e=>onPatch({chapter:e.target.value})}/></label>
      <EditableCombobox label="시점 인물" value={doc.pov} options={wiki.filter(w=>w.category.trim()==='인물').map(w=>w.title)} disabled={readonly} onChange={pov=>onPatch({pov})}/>
      <label>작중 시간<input value={doc.storyTime} disabled={readonly} placeholder="예: 귀환일 · 08:40" onChange={e=>onPatch({storyTime:e.target.value})}/></label>
      <label className="wide">장면 요약<textarea rows={3} value={doc.summary} disabled={readonly} onChange={e=>onPatch({summary:e.target.value})}/></label>
      <p className="field-help wide">부·장은 독서 화면의 구분입니다. 집필실 폴더와 별도로 관리합니다.</p>
    </>:<>
      <EditableCombobox label="분류" value={doc.category} options={wiki.map(w=>w.category)} disabled={readonly} onChange={category=>onPatch({category})}/>
      <label className="check-label"><input type="checkbox" checked={doc.isPublic} disabled={readonly} onChange={e=>onPatch({isPublic:e.target.checked})}/>독자용 설명 공개</label>
      <label className="wide">독자용 설명<textarea rows={4} value={doc.publicSummary} disabled={readonly} onChange={e=>onPatch({publicSummary:e.target.value})}/></label>
      <p className="field-help wide">집필용 본문과 별도로 게시됩니다. 설명이 비어 있으면 공개하지 않습니다.</p>
    </>}</div>}
    {doc.kind==='scene'&&!open&&doc.summary.trim()&&<p className="doc-summary">요약 · {doc.summary}</p>}
    <div className="doc-divider"/>
  </div>;
}

function Login(){
  const s=useStudio();const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  return <div className="login-screen"><span className="login-mark" aria-hidden="true">◌</span><h1>Orbis Tertius 집필실</h1>{cloudConfigured?<form onSubmit={async e=>{e.preventDefault();setBusy(true);try{await s.login(email,password);}catch(e){setError(e instanceof Error?e.message:'로그인 실패');}finally{setBusy(false);}}}><label>이메일<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>비밀번호<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="primary" disabled={busy}>집필실 열기</button>{error&&<p role="alert">{error}</p>}</form>:<p>작가용 클라우드 연결을 설정한 뒤 이용할 수 있습니다.</p>}<Link href="/library">공개 서재</Link></div>;
}
