'use client';
import { Fragment, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ArrowDown, ArrowUp, BookPlus, ChevronDown, ChevronRight, Columns2, FileText, Folder, FolderPlus, GripVertical, MoreHorizontal, Pencil, Plus, StickyNote, Trash2, Undo2 } from 'lucide-react';
import { type NovelDocument, type Work, statuses, plainText, uid } from '@/lib/model';
import { applyNavigation, createNavigationDocument, descendantsOf, insertFolder, moveNavigation, navigationSnapshot, resolveNavigation, restoreNavigation, siblingDestination, type DocumentDestination, type NavigationNode, type NavigationSnapshot } from '@/lib/document-navigation';
import { IconButton, Popover } from './primitives';
import { WikiIcon } from './studio-icons';
import styles from './document-tree.module.css';

type FormState = {type:'move';id:string}|{type:'folder';to:DocumentDestination}|{type:'document';to:DocumentDestination;kind:NovelDocument['kind']}|{type:'section'};
type Target = {id:string;section?:boolean};
type MenuEntry = {key:string;label:string;icon:ReactNode;disabled?:boolean;title?:string;divider?:boolean;run:()=>void};
type Drop = {id:string;edge:'before'|'inside'|'after';to:DocumentDestination;error?:string};
type Drag = {id:string;startX:number;startY:number;x:number;y:number;active:boolean;drop?:Drop};
const labels={scene:'원고',wiki:'설정 문서',memo:'메모 · 리서치'};
const menuClose=(keep:{current:boolean})=>(e:Event)=>{if(keep.current){e.preventDefault();keep.current=false;}};

type NoteView={matchingIds:string[];eligibleIds:string[];filtered:boolean;onNew:(to:DocumentDestination)=>void;onFolderWork?:(folderId:string,at:HTMLElement|null)=>void};
export function DocumentTree({work,query,activeId,readonly:isReadonly,onOpen,onChange,onTrash,noteView}:{work:Work;query:string;activeId:string;readonly:boolean;onOpen:(id:string,beside?:boolean)=>void;onChange:(fn:(work:Work)=>Work)=>void;onTrash?:(id:string)=>Promise<void>;noteView?:NoteView}){
  const noun=noteView?'노트':'문서',filtered=noteView?noteView.filtered:!!query.trim();
  const nav=useMemo(()=>resolveNavigation(work),[work]);const root=useRef<HTMLDivElement>(null);
  const [closed,setClosed]=useState<Set<string>>(new Set());const [dialog,setDialog]=useState<FormState|null>(null);
  const anchor=useRef<HTMLElement|null>(null),returnFocus=useRef<HTMLElement|null>(null),keepMenuFocus=useRef(false);
  const [menuFor,setMenuFor]=useState<string|null>(null);const [renaming,setRenaming]=useState<Target|null>(null);
  const [name,setName]=useState('');const [kind,setKind]=useState<NovelDocument['kind']>('memo');
  const [destination,setDestination]=useState('');const [place,setPlace]=useState('last');
  const [error,setError]=useState('');const [undo,setUndo]=useState<NavigationSnapshot|null>(null);
  const [movingToTrash,setMovingToTrash]=useState(false);const readonly=isReadonly||movingToTrash;
  const [drag,setDrag]=useState<Drag|null>(null);const dragRef=useRef<Drag|null>(null);const suppressClick=useRef<{id:string;until:number}|null>(null);
  const documents=new Map(work.documents.map(d=>[d.id,d])),nodes=new Map(nav.nodes.map(n=>[n.id,n]));
  const branches=new Map<string,NavigationNode[]>();for(const n of nav.nodes){const key=`${n.sectionId}/${n.parentId||''}`;branches.set(key,[...(branches.get(key)||[]),n]);}
  const childNodes=(parentId:string|null,sectionId:string)=>branches.get(`${sectionId}/${parentId||''}`)||[];
  const title=(n:NavigationNode)=>n.type==='folder'?n.title:documents.get(n.id)?.title||'문서';
  const targetTitle=(t:Target)=>(t.section?nav.sections.find(s=>s.id===t.id)?.title:nodes.get(t.id)?title(nodes.get(t.id)!):'')||'';
  const eligible=noteView?new Set(noteView.eligibleIds):null;
  const matching=new Set(noteView?noteView.matchingIds:work.documents.filter(d=>!query.trim()||`${d.title} ${plainText(d.content)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map(d=>d.id));
  if(query.trim())for(const n of nav.nodes)if(n.type==='folder'&&(noteView?query.trim().toLocaleLowerCase().split(/\s+/).every(word=>n.title.toLocaleLowerCase().includes(word)):n.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))){matching.add(n.id);for(const id of descendantsOf(nav,n.id))if(!eligible||eligible.has(id))matching.add(id);}
  const visible=new Set(matching);for(const id of matching){let parent=nodes.get(id)?.parentId;while(parent){visible.add(parent);parent=nodes.get(parent)?.parentId;}}
  const show=(n:NavigationNode)=>!filtered||visible.has(n.id);
  function mutate(fn:(latest:Work)=>Work,remember=true){
    if(readonly)return false;try{onChange(latest=>{const next=fn(latest);if(remember)setUndo(navigationSnapshot(latest));return next;});setError('');return true;}catch(e){setError(e instanceof Error?e.message:'문서 정리를 바꾸지 못했습니다.');return false;}
  }
  const rowOf=(t:Target)=>root.current?.querySelector<HTMLElement>(t.section?`[data-navigation-section="${t.id}"]`:`[data-navigation-row="${t.id}"]`)||null;
  const menuButtonOf=(t:Target)=>rowOf(t)?.querySelector<HTMLElement>('[data-row-menu]')||null;
  /** 폼은 해당 행이나 버튼 옆 팝오버로 연다. 닫으면 back으로 초점을 돌린다. */
  function openForm(next:FormState,at:HTMLElement|null,back:HTMLElement|null=at){
    anchor.current=at;returnFocus.current=back;setError('');setName('');setRenaming(null);
    if(next.type==='section')setKind('memo');if(next.type==='document')setKind(next.kind);
    if(next.type==='move'){const n=nodes.get(next.id)!;setDestination(n.parentId?`node:${n.parentId}`:`section:${n.sectionId}`);setPlace('last');}
    setDialog(next);
  }
  /** 메뉴 항목에서 폼·이름 변경을 열 때는 메뉴가 닫히고 초점이 정리된 다음에 연다. */
  function afterMenu(fn:()=>void){keepMenuFocus.current=true;window.setTimeout(fn,0);}
  function startRename(t:Target){setDialog(null);setError('');setName(targetTitle(t));setRenaming(t);}
  function finishRename(save:boolean){
    const t=renaming;if(!t)return;const value=name.trim();
    if(save&&!value){setError('이름을 입력하세요.');return;}
    setRenaming(null);setError('');
    if(save&&value!==targetTitle(t))mutate(latest=>{const next=resolveNavigation(latest);if(t.section)next.sections=next.sections.map(s=>s.id===t.id?{...s,title:value}:s);else next.nodes=next.nodes.map(n=>n.id===t.id&&n.type==='folder'?{...n,title:value}:n);return applyNavigation(latest,next);});
    window.setTimeout(()=>menuButtonOf(t)?.focus(),0);
  }
  function toggle(id:string){setClosed(v=>{const next=new Set(v);if(next.has(id))next.delete(id);else next.add(id);return next;});}
  function expand(id:string|null){if(id)setClosed(v=>{const next=new Set(v);next.delete(id);return next;});}
  async function moveToTrash(node:NavigationNode){
    if(readonly||!onTrash)return;setMovingToTrash(true);setError('');
    try{await onTrash(node.id);setUndo(null);window.setTimeout(()=>root.current?.querySelector<HTMLElement>(noteView?'[aria-label="최상위 폴더 추가"]':'[aria-label="대분류 추가"]')?.focus(),0);}
    catch(error){setError(error instanceof Error?error.message:`${noun}를 휴지통으로 옮기지 못했습니다.`);menuButtonOf({id:node.id})?.focus();}
    finally{setMovingToTrash(false);}
  }
  function detectDrop(id:string,x:number,y:number):Drop|undefined {
    const element=document.elementFromPoint(x,y)?.closest<HTMLElement>('[data-navigation-row],[data-navigation-section]');if(!element||!root.current?.contains(element))return;
    let targetId:string,edge:Drop['edge'],to:DocumentDestination;
    if(element.dataset.navigationSection){targetId=element.dataset.navigationSection;edge='inside';to={sectionId:targetId,parentId:null};}
    else {targetId=element.dataset.navigationRow!;const n=nodes.get(targetId);if(!n)return;const rect=element.getBoundingClientRect(),fraction=(y-rect.top)/rect.height;edge=fraction<.25?'before':fraction>.75?'after':'inside';
      const siblings=childNodes(n.parentId,n.sectionId),index=siblings.findIndex(s=>s.id===n.id);
      to=edge==='inside'?{sectionId:n.sectionId,parentId:n.id}:{sectionId:n.sectionId,parentId:n.parentId,beforeId:edge==='before'?n.id:siblings[index+1]?.id};
    }
    let error:string|undefined;try{moveNavigation(work,id,to);}catch(e){error=e instanceof Error?e.message:'이 위치로 옮길 수 없습니다.';}return {id:targetId,edge,to,error};
  }
  function pointerMove(e:PointerEvent<HTMLButtonElement>){
    const previous=dragRef.current;if(!previous)return;const active=previous.active||Math.hypot(e.clientX-previous.startX,e.clientY-previous.startY)>6;
    const next={...previous,x:e.clientX,y:e.clientY,active,drop:active?detectDrop(previous.id,e.clientX,e.clientY):undefined};dragRef.current=next;setDrag(next);
    if(active){const scroller=root.current?.closest<HTMLElement>('.sidebar-scroll');if(scroller){const r=scroller.getBoundingClientRect();if(e.clientY<r.top+28)scroller.scrollTop-=16;else if(e.clientY>r.bottom-28)scroller.scrollTop+=16;}}
  }
  function finishDrag(cancel=false){
    const current=dragRef.current;dragRef.current=null;setDrag(null);if(!current?.active)return;suppressClick.current={id:current.id,until:Date.now()+500};
    if(cancel)return;if(current.drop?.error){setError(current.drop.error);return;}
    if(current.drop){const drop=current.drop;mutate(latest=>moveNavigation(latest,current.id,drop.to));expand(drop.to.parentId);expand(`section:${drop.to.sectionId}`);}
  }
  function destinationFromValue(value:string):DocumentDestination {
    if(value.startsWith('section:'))return {sectionId:value.slice(8),parentId:null};const parent=nodes.get(value.slice(5));if(!parent)throw new Error('이동할 위치를 선택하세요.');return {sectionId:parent.sectionId,parentId:parent.id};
  }
  const moveNode=dialog?.type==='move'?nodes.get(dialog.id):undefined,excluded=moveNode?descendantsOf(nav,moveNode.id):new Set<string>();
  const targets:{value:string;label:string}[]=[];
  const collect=(sectionId:string,parentId:string|null,trail:string)=>{for(const n of childNodes(parentId,sectionId)){if(excluded.has(n.id))continue;const path=`${trail} / ${title(n)}`;targets.push({value:`node:${n.id}`,label:`${n.type==='folder'?'폴더':noun} · ${path}`});collect(sectionId,n.id,path);}};
  if(moveNode)for(const section of nav.sections){targets.push({value:`section:${section.id}`,label:noteView?'노트 · 최상위':section.title});collect(section.id,null,section.title);}
  let moveTo:DocumentDestination|undefined;try{if(moveNode&&destination)moveTo=destinationFromValue(destination);}catch{}
  const moveSiblings=moveTo?childNodes(moveTo.parentId,moveTo.sectionId).filter(n=>!excluded.has(n.id)):[];
  function menuEntries(t:Target):MenuEntry[]{
    const node=t.section?undefined:nodes.get(t.id),section=t.section?nav.sections.find(s=>s.id===t.id):undefined;if(!node&&!section)return [];
    const to:DocumentDestination=node?{sectionId:node.sectionId,parentId:node.id}:{sectionId:section!.id,parentId:null};
    const defaultKind=node?.type==='document'?documents.get(node.id)!.kind:nav.sections.find(s=>s.id===to.sectionId)?.defaultKind||'memo';
    const form=(next:FormState)=>()=>afterMenu(()=>openForm(next,rowOf(t),menuButtonOf(t)));
    const entries:MenuEntry[]=[
      {key:'document',label:node?`하위 ${noun} 추가`:`${noun} 추가`,icon:<Plus size={15}/>,disabled:readonly,run:noteView?()=>afterMenu(()=>{expand(to.parentId);noteView.onNew(to);}):form({type:'document',to,kind:defaultKind})},
      {key:'folder',label:node?'하위 폴더 추가':'폴더 추가',icon:<FolderPlus size={15}/>,disabled:readonly,run:form({type:'folder',to})},
    ];
    if(node){
      if(node.type==='document'&&!noteView)entries.push({key:'beside',label:'옆에서 열기',icon:<Columns2 size={15}/>,run:()=>onOpen(node.id,true)});
      entries.push({key:'move',label:'이동 · 순서 변경',icon:<GripVertical size={15}/>,disabled:readonly,divider:true,run:form({type:'move',id:node.id})});
      for(const direction of [-1,1] as const)entries.push({key:`order${direction}`,label:direction<0?'위로 옮기기':'아래로 옮기기',icon:direction<0?<ArrowUp size={15}/>:<ArrowDown size={15}/>,disabled:readonly||!siblingDestination(work,node.id,direction),run:()=>{mutate(latest=>{const next=siblingDestination(latest,node.id,direction);return next?moveNavigation(latest,node.id,next):latest;});}});
    }
    if(node?.type==='folder'&&noteView?.onFolderWork){const open=noteView.onFolderWork;entries.push({key:'folder-work',label:'새 작품으로 만들기',icon:<BookPlus size={15}/>,disabled:readonly||!childNodes(node.id,node.sectionId).length,run:()=>afterMenu(()=>open(node.id,rowOf(t)))});}
    if(section||node?.type==='folder')entries.push({key:'rename',label:'이름 변경',icon:<Pencil size={15}/>,disabled:readonly,divider:!!section,run:()=>afterMenu(()=>startRename(t))});
    if(section){const index=nav.sections.findIndex(s=>s.id===section.id);for(const direction of [-1,1] as const)entries.push({key:`section${direction}`,label:direction<0?'대분류 위로':'대분류 아래로',icon:direction<0?<ArrowUp size={15}/>:<ArrowDown size={15}/>,disabled:readonly||index+direction<0||index+direction>=nav.sections.length,run:()=>{mutate(latest=>{const next=resolveNavigation(latest),i=next.sections.findIndex(s=>s.id===section.id);[next.sections[i],next.sections[i+direction]]=[next.sections[i+direction],next.sections[i]];return applyNavigation(latest,next);});}});}
    if(node?.type==='document'&&onTrash)entries.push({key:'trash-document',label:'휴지통으로 이동',title:!noteView&&work.documents.length<=1?'마지막 문서는 유지해야 합니다':undefined,icon:<Trash2 size={15}/>,disabled:readonly||!noteView&&work.documents.length<=1,divider:true,run:()=>afterMenu(()=>void moveToTrash(node))});
    if(node?.type==='folder'&&!childNodes(node.id,node.sectionId).length||section&&!['scene','wiki','memo'].includes(section.id)&&!nav.nodes.some(n=>n.sectionId===section.id))entries.push({key:'delete',label:`빈 ${section?'대분류':'폴더'} 삭제`,icon:<Trash2 size={15}/>,disabled:readonly,divider:true,run:()=>{mutate(latest=>{const next=resolveNavigation(latest);if(section)next.sections=next.sections.filter(s=>s.id!==section.id);else next.nodes=next.nodes.filter(n=>n.id!==node!.id);return applyNavigation(latest,next);});}});
    return entries;
  }
  const renderEntries=(t:Target,Item:typeof DropdownMenu.Item,Separator:typeof DropdownMenu.Separator)=>menuEntries(t).map(e=><Fragment key={e.key}>{e.divider&&<Separator className="menu-separator"/>}<Item className="menu-item" disabled={e.disabled} title={e.title} onSelect={e.run}>{e.icon}{e.label}</Item></Fragment>);
  const menuKey=(t:Target)=>`${t.section?'section':'node'}:${t.id}`,menuOpen=(t:Target)=>menuFor===`menu:${menuKey(t)}`||menuFor===`context:${menuKey(t)}`;
  /** 행 오른쪽 … 버튼과 우클릭이 같은 항목을 연다. */
  const rowMenu=(t:Target,label:string)=><DropdownMenu.Root modal={false} open={menuFor===`menu:${menuKey(t)}`} onOpenChange={open=>setMenuFor(open?`menu:${menuKey(t)}`:null)}>
    <DropdownMenu.Trigger asChild><button type="button" className={`icon-button ${styles.rowMenu}`} aria-label={label} title={label} data-row-menu=""><MoreHorizontal size={15}/></button></DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content className="menu" align="start" sideOffset={4} collisionPadding={12} onCloseAutoFocus={menuClose(keepMenuFocus)}>{renderEntries(t,DropdownMenu.Item,DropdownMenu.Separator)}</DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>;
  const rowContext=(t:Target,row:ReactNode)=><ContextMenu.Root modal={false} onOpenChange={open=>setMenuFor(open?`context:${menuKey(t)}`:null)}>
    <ContextMenu.Trigger asChild disabled={!!renaming||!!drag?.active}>{row}</ContextMenu.Trigger>
    <ContextMenu.Portal><ContextMenu.Content className="menu" collisionPadding={12} onCloseAutoFocus={menuClose(keepMenuFocus)}>{renderEntries(t,ContextMenu.Item,ContextMenu.Separator)}</ContextMenu.Content></ContextMenu.Portal>
  </ContextMenu.Root>;
  const renameInput=(label:string)=><input className={styles.rename} aria-label={`${label} 새 이름`} autoFocus value={name} maxLength={renaming?.section?200:300} onChange={e=>setName(e.target.value)} onFocus={e=>e.currentTarget.select()} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();finishRename(true);}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();finishRename(false);}}} onBlur={()=>finishRename(true)}/>;
  function formSubmit(){
    if(!dialog||readonly)return;const titleValue=name.trim();
    let success=false;
    if(dialog.type==='move'){
      if(!moveTo)return;const to={...moveTo,...(place==='first'?{beforeId:moveSiblings[0]?.id}:place.startsWith('before:')?{beforeId:place.slice(7)}:{})};
      try{moveNavigation(work,dialog.id,to);}catch(e){setError((e as Error).message);return;}
      success=mutate(latest=>moveNavigation(latest,dialog.id,to));expand(to.parentId);expand(`section:${to.sectionId}`);
    }else if(!titleValue){setError('이름을 입력하세요.');return;}
    else if(dialog.type==='folder'){success=mutate(latest=>insertFolder(latest,titleValue,dialog.to));expand(dialog.to.parentId);expand(`section:${dialog.to.sectionId}`);}
    else if(dialog.type==='document'){
      let createdId='';success=mutate(latest=>{const result=createNavigationDocument(latest,kind,dialog.to);createdId=result.document.id;result.document.title=titleValue;return result.work;},false);expand(dialog.to.parentId);expand(`section:${dialog.to.sectionId}`);if(success&&createdId)onOpen(createdId);
    }else if(dialog.type==='section'){success=mutate(latest=>{const next=resolveNavigation(latest);next.sections.push({id:uid(),title:titleValue,defaultKind:kind});return applyNavigation(latest,next);});}
    if(success)setDialog(null);
  }
  function renderNodes(sectionId:string,parentId:string|null,depth:number):ReactNode{
    return <ul className={styles.list}>{childNodes(parentId,sectionId).filter(show).map(n=>{
      const doc=n.type==='document'?documents.get(n.id):undefined,children=childNodes(n.id,sectionId).filter(show),isClosed=!filtered&&closed.has(n.id),drop=drag?.active&&drag.drop?.id===n.id?drag.drop:undefined;
      const t={id:n.id},isRenaming=renaming?.id===n.id&&!renaming.section;
      return <li key={n.id}>{rowContext(t,<div data-navigation-row={n.id} data-drop-edge={drop?.edge} className={`${styles.row} ${n.id===activeId?styles.selected:''} ${menuOpen(t)||dialog&&anchor.current?.dataset.navigationRow===n.id?styles.active:''} ${drag?.active&&drag.id===n.id?styles.dragged:''} ${drop?.error?styles.invalid:''}`} style={{'--depth':Math.min(depth,3)} as CSSProperties}>
        <button type="button" className={styles.grip} aria-label={`${title(n)} 이동`} title="드래그로 이동 · 클릭해서 위치 선택" disabled={readonly||filtered} onPointerDown={e=>{if(e.button!==0)return;e.currentTarget.setPointerCapture(e.pointerId);suppressClick.current=null;const value={id:n.id,startX:e.clientX,startY:e.clientY,x:e.clientX,y:e.clientY,active:false};dragRef.current=value;setDrag(value);}} onPointerMove={pointerMove} onPointerUp={()=>finishDrag()} onPointerCancel={()=>finishDrag(true)} onKeyDown={e=>{if(e.key==='Escape'){finishDrag(true);e.preventDefault();}}} onClick={e=>{const suppressed=suppressClick.current;suppressClick.current=null;if(e.detail>0&&suppressed?.id===n.id&&Date.now()<suppressed.until)return;openForm({type:'move',id:n.id},rowOf(t),e.currentTarget);}}><GripVertical size={13}/></button>
        {children.length||n.type==='folder'?<button type="button" className={styles.caret} aria-label={`${title(n)} ${isClosed?'펼치기':'접기'}`} aria-expanded={!isClosed} onClick={()=>toggle(n.id)}>{isClosed?<ChevronRight size={13}/>:<ChevronDown size={13}/>}</button>:<span className={styles.caret}/>}
        {isRenaming?<span className={styles.open}><Folder size={14}/>{renameInput(title(n))}</span>:<button type="button" className={styles.open} title={title(n)} aria-current={n.id===activeId?'page':undefined} onClick={()=>doc?onOpen(doc.id):toggle(n.id)}>{n.type==='folder'?<Folder size={14}/>:doc?.kind==='wiki'?<WikiIcon category={doc.category} size={14}/>:doc?.kind==='memo'?<StickyNote size={14}/>:<FileText size={14}/>}<span className="tree-label">{title(n)}</span>{doc?.kind==='scene'&&<i className={`status-dot ${doc.status}`} role="img" aria-label={statuses[doc.status]}/>}</button>}
        {rowMenu(t,`${title(n)} 메뉴`)}
      </div>)}{!isClosed&&children.length>0&&renderNodes(sectionId,n.id,depth+1)}</li>;
    })}</ul>;
  }
  const formTitle=dialog?.type==='move'?`${moveNode?title(moveNode):noun} 이동`:dialog?.type==='folder'?'폴더 만들기':dialog?.type==='document'?'문서 만들기':'대분류 추가';
  return <div ref={root} className={styles.tree}>
    <div className={styles.toolbar} data-navigation-section={noteView?'notes':undefined} data-drop-edge={noteView&&drag?.active&&drag.drop?.id==='notes'?drag.drop.edge:undefined}><span>{noteView?'노트 정리':'문서'}</span>{undo&&<IconButton label={`${noun} 정리 되돌리기`} disabled={readonly} onClick={()=>{const previous=undo;mutate(latest=>restoreNavigation(latest,previous),false);setUndo(null);}}><Undo2 size={14}/></IconButton>}{noteView?<IconButton label="최상위 폴더 추가" disabled={readonly} onClick={e=>openForm({type:'folder',to:{sectionId:'notes',parentId:null}},e.currentTarget)}><FolderPlus size={15}/></IconButton>:<IconButton label="대분류 추가" disabled={readonly||nav.sections.length>=40} onClick={e=>openForm({type:'section'},e.currentTarget)}><Plus size={15}/></IconButton>}</div>
    {noteView?<section className={styles.section} aria-label="노트 트리">{renderNodes('notes',null,0)}</section>:nav.sections.map((section,index)=>{const sectionClosed=!query.trim()&&closed.has(`section:${section.id}`),count=nav.nodes.filter(n=>n.sectionId===section.id&&n.type==='document').length,drop=drag?.active&&drag.drop?.id===section.id?drag.drop:undefined;
      const t={id:section.id,section:true},isRenaming=renaming?.id===section.id&&!!renaming.section;
      return <section key={section.id} className={styles.section} aria-label={section.title}>{rowContext(t,<div data-navigation-section={section.id} data-drop-edge={drop?.edge} className={`${styles.heading} ${menuOpen(t)||dialog&&anchor.current?.dataset.navigationSection===section.id?styles.active:''} ${drop?.error?styles.invalid:''}`}>
        {isRenaming?<span className={styles.sectionTitle}><ChevronDown size={13}/><i className="tree-number" aria-hidden="true">{String(index+1).padStart(2,'0')}</i>{renameInput(section.title)}</span>:<button type="button" className={styles.sectionTitle} aria-expanded={!sectionClosed} onClick={()=>toggle(`section:${section.id}`)}>{sectionClosed?<ChevronRight size={13}/>:<ChevronDown size={13}/>}<i className="tree-number" aria-hidden="true">{String(index+1).padStart(2,'0')}</i><span className="tree-label">{section.title}</span><small>{count}</small></button>}
        <IconButton label={`${section.title} 문서 추가`} disabled={readonly} className={styles.rowMenu} onClick={e=>openForm({type:'document',to:{sectionId:section.id,parentId:null},kind:section.defaultKind},rowOf(t),e.currentTarget)}><Plus size={14}/></IconButton>{rowMenu(t,`${section.title} 대분류 메뉴`)}
      </div>)}{!sectionClosed&&renderNodes(section.id,null,0)}{!sectionClosed&&!childNodes(null,section.id).length&&<p className={styles.empty}>문서를 추가하거나 여기로 옮겨주세요.</p>}</section>;
    })}
    {filtered&&!nav.nodes.some(show)&&<p className="empty-text">검색 결과가 없습니다.</p>}
    {!dialog&&error&&<p className={styles.error} role="alert">{error}</p>}
    {drag?.active&&<div className={styles.ghost} style={{left:Math.max(4,Math.min(drag.x+12,typeof window==='undefined'?0:window.innerWidth-190)),top:drag.y+15}}>{nodes.get(drag.id)?title(nodes.get(drag.id)!):'문서'}<small>{drag.drop?.error|| (drag.drop?drag.drop.edge==='inside'?'하위에 넣기':drag.drop.edge==='before'?'앞에 놓기':'뒤에 놓기':'놓을 위치를 선택하세요.')}</small></div>}
    <Popover open={!!dialog} onOpenChange={open=>{if(!open){setDialog(null);setError('');}}} anchor={anchor} side={typeof window!=='undefined'&&window.innerWidth<700?'bottom':'right'} width={dialog?.type==='move'?340:280} title={formTitle} description={dialog?.type==='move'?(noteView?'하위 노트와 폴더도 함께 이동합니다.':'하위 문서와 폴더도 함께 이동합니다. 문서 종류와 부·장은 유지됩니다.'):undefined} onReturnFocus={()=>{const target=returnFocus.current;if(target?.isConnected)target.focus();else (root.current?.querySelector<HTMLButtonElement>(`[data-navigation-row="${activeId}"] button`)||document.getElementById('sidebar-toggle'))?.focus();}}>
      <form onSubmit={e=>{e.preventDefault();formSubmit();}} className={styles.form}>
        {dialog?.type==='move'?<><label>옮길 위치<select value={destination} onChange={e=>{setDestination(e.target.value);setPlace('last');}}>{targets.map(t=><option value={t.value} key={t.value}>{t.label}</option>)}</select></label><label>순서<select value={place} onChange={e=>setPlace(e.target.value)}><option value="last">맨 뒤</option><option value="first">맨 앞</option>{moveSiblings.map(n=><option key={n.id} value={`before:${n.id}`}>{title(n)} 앞</option>)}</select></label></>:<label>{dialog?.type==='document'?'문서 제목':'이름'}<input autoFocus value={name} onChange={e=>setName(e.target.value)} maxLength={dialog?.type==='section'?200:300} required/></label>}
        {(dialog?.type==='section'||dialog?.type==='document')&&<label>{dialog.type==='section'?'기본 문서 종류':'문서 종류'}<select value={kind} onChange={e=>setKind(e.target.value as NovelDocument['kind'])}>{Object.entries(labels).map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label>}
        {dialog?.type==='section'&&<p className="field-help">대분류는 정리용입니다. 이동해도 원고·설정·메모의 종류는 바뀌지 않습니다.</p>}
        {dialog?.type==='folder'&&!noteView&&<p className="field-help">폴더 이름은 독서 화면의 부·장과 별도로 관리합니다.</p>}
        {error&&<p role="alert" className={styles.error}>{error}</p>}<div className={styles.formButtons}><button type="button" className="button" onClick={()=>setDialog(null)}>취소</button><button type="submit" className="button primary" disabled={readonly}>{dialog?.type==='move'?'이동':'추가'}</button></div>
      </form>
    </Popover>
  </div>;
}
