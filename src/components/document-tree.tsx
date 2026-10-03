'use client';
import { useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Columns2, FileText, Folder, FolderPlus, GripVertical, MoreHorizontal, Plus, StickyNote, Undo2 } from 'lucide-react';
import { type NovelDocument, type Work, statuses, plainText, uid } from '@/lib/model';
import { applyNavigation, createNavigationDocument, descendantsOf, insertFolder, moveNavigation, navigationSnapshot, resolveNavigation, restoreNavigation, siblingDestination, type DocumentDestination, type NavigationNode, type NavigationSnapshot } from '@/lib/document-navigation';
import { IconButton, Modal } from './primitives';
import { WikiIcon } from './studio-icons';
import styles from './document-tree.module.css';

type DialogState = {type:'menu';id:string;section?:boolean}|{type:'move';id:string}|{type:'folder';to:DocumentDestination}|{type:'document';to:DocumentDestination;kind:NovelDocument['kind']}|{type:'section'}|{type:'rename';id:string;section?:boolean};
type Drop = {id:string;edge:'before'|'inside'|'after';to:DocumentDestination;error?:string};
type Drag = {id:string;startX:number;startY:number;x:number;y:number;active:boolean;drop?:Drop};
const labels={scene:'원고',wiki:'설정 문서',memo:'메모 · 리서치'};

export function DocumentTree({work,query,activeId,readonly,onOpen,onChange}:{work:Work;query:string;activeId:string;readonly:boolean;onOpen:(id:string,beside?:boolean)=>void;onChange:(fn:(work:Work)=>Work)=>void}){
  const nav=useMemo(()=>resolveNavigation(work),[work]);const root=useRef<HTMLDivElement>(null);
  const [closed,setClosed]=useState<Set<string>>(new Set());const [dialog,setDialog]=useState<DialogState|null>(null);
  const returnFocus=useRef<HTMLElement|null>(null);
  const [name,setName]=useState('');const [kind,setKind]=useState<NovelDocument['kind']>('memo');
  const [destination,setDestination]=useState('');const [place,setPlace]=useState('last');
  const [notice,setNotice]=useState('');const [error,setError]=useState('');const [undo,setUndo]=useState<NavigationSnapshot|null>(null);
  const [drag,setDrag]=useState<Drag|null>(null);const dragRef=useRef<Drag|null>(null);const suppressClick=useRef<{id:string;until:number}|null>(null);
  const documents=new Map(work.documents.map(d=>[d.id,d])),nodes=new Map(nav.nodes.map(n=>[n.id,n]));
  const branches=new Map<string,NavigationNode[]>();for(const n of nav.nodes){const key=`${n.sectionId}/${n.parentId||''}`;branches.set(key,[...(branches.get(key)||[]),n]);}
  const childNodes=(parentId:string|null,sectionId:string)=>branches.get(`${sectionId}/${parentId||''}`)||[];
  const title=(n:NavigationNode)=>n.type==='folder'?n.title:documents.get(n.id)?.title||'문서';
  const matching=new Set(work.documents.filter(d=>!query.trim()||`${d.title} ${plainText(d.content)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map(d=>d.id));
  if(query.trim())for(const n of nav.nodes)if(n.type==='folder'&&n.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))for(const id of descendantsOf(nav,n.id))matching.add(id);
  const visible=new Set(matching);for(const id of matching){let parent=nodes.get(id)?.parentId;while(parent){visible.add(parent);parent=nodes.get(parent)?.parentId;}}
  const show=(n:NavigationNode)=>!query.trim()||visible.has(n.id);
  function mutate(fn:(latest:Work)=>Work,message:string,remember=true){
    if(readonly)return false;try{onChange(latest=>{const next=fn(latest);if(remember)setUndo(navigationSnapshot(latest));return next;});setError('');setNotice(message);return true;}catch(e){setError(e instanceof Error?e.message:'문서 정리를 바꾸지 못했습니다.');return false;}
  }
  function openDialog(next:DialogState){
    if(!dialog)returnFocus.current=document.activeElement as HTMLElement|null;
    setError('');setDialog(next);setName(next.type==='rename'?(next.section?nav.sections.find(s=>s.id===next.id)?.title:nodes.get(next.id)?title(nodes.get(next.id)!):'')||'':'');
    if(next.type==='section')setKind('memo');if(next.type==='document')setKind(next.kind);
    if(next.type==='move'){const n=nodes.get(next.id)!;setDestination(n.parentId?`node:${n.parentId}`:`section:${n.sectionId}`);setPlace('last');}
  }
  function toggle(id:string){setClosed(v=>{const next=new Set(v);if(next.has(id))next.delete(id);else next.add(id);return next;});}
  function expand(id:string|null){if(id)setClosed(v=>{const next=new Set(v);next.delete(id);return next;});}
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
    if(current.drop){const drop=current.drop;mutate(latest=>moveNavigation(latest,current.id,drop.to),'문서 위치를 저장했습니다.');expand(drop.to.parentId);expand(`section:${drop.to.sectionId}`);}
    else setNotice('이동을 취소했습니다. 문서나 대분류 위에 놓아주세요.');
  }
  function destinationFromValue(value:string):DocumentDestination {
    if(value.startsWith('section:'))return {sectionId:value.slice(8),parentId:null};const parent=nodes.get(value.slice(5));if(!parent)throw new Error('이동할 위치를 선택하세요.');return {sectionId:parent.sectionId,parentId:parent.id};
  }
  const moveNode=dialog?.type==='move'?nodes.get(dialog.id):undefined,excluded=moveNode?descendantsOf(nav,moveNode.id):new Set<string>();
  const targets:{value:string;label:string}[]=[];
  const collect=(sectionId:string,parentId:string|null,trail:string)=>{for(const n of childNodes(parentId,sectionId)){if(excluded.has(n.id))continue;const path=`${trail} / ${title(n)}`;targets.push({value:`node:${n.id}`,label:`${n.type==='folder'?'폴더':'문서'} · ${path}`});collect(sectionId,n.id,path);}};
  if(moveNode)for(const section of nav.sections){targets.push({value:`section:${section.id}`,label:section.title});collect(section.id,null,section.title);}
  let moveTo:DocumentDestination|undefined;try{if(moveNode&&destination)moveTo=destinationFromValue(destination);}catch{}
  const moveSiblings=moveTo?childNodes(moveTo.parentId,moveTo.sectionId).filter(n=>!excluded.has(n.id)):[];
  const selectedMenu=dialog?.type==='menu'?(dialog.section?undefined:nodes.get(dialog.id)):undefined;
  const menuSection=dialog?.type==='menu'&&dialog.section?nav.sections.find(s=>s.id===dialog.id):undefined;
  const menuTo=selectedMenu?{sectionId:selectedMenu.sectionId,parentId:selectedMenu.id}:menuSection?{sectionId:menuSection.id,parentId:null}:undefined;
  const defaultKind=selectedMenu?.type==='document'?documents.get(selectedMenu.id)!.kind:nav.sections.find(s=>s.id===menuTo?.sectionId)?.defaultKind||'memo';
  const menuTitle=selectedMenu?title(selectedMenu):menuSection?.title||'문서';
  function formSubmit(){
    if(!dialog||readonly)return;const titleValue=name.trim();
    let success=false;
    if(dialog.type==='move'){
      if(!moveTo)return;const to={...moveTo,...(place==='first'?{beforeId:moveSiblings[0]?.id}:place.startsWith('before:')?{beforeId:place.slice(7)}:{})};
      try{moveNavigation(work,dialog.id,to);}catch(e){setError((e as Error).message);return;}
      success=mutate(latest=>moveNavigation(latest,dialog.id,to),'문서 위치를 저장했습니다.');expand(to.parentId);expand(`section:${to.sectionId}`);
    }else if(!titleValue){setError('이름을 입력하세요.');return;}
    else if(dialog.type==='folder'){success=mutate(latest=>insertFolder(latest,titleValue,dialog.to),'폴더를 만들었습니다.');expand(dialog.to.parentId);expand(`section:${dialog.to.sectionId}`);}
    else if(dialog.type==='document'){
      let createdId='';success=mutate(latest=>{const result=createNavigationDocument(latest,kind,dialog.to);createdId=result.document.id;result.document.title=titleValue;return result.work;},'문서를 만들었습니다.',false);expand(dialog.to.parentId);expand(`section:${dialog.to.sectionId}`);if(success&&createdId)onOpen(createdId);
    }else if(dialog.type==='section'){success=mutate(latest=>{const next=resolveNavigation(latest);next.sections.push({id:uid(),title:titleValue,defaultKind:kind});return applyNavigation(latest,next);},'대분류를 만들었습니다.');}
    else if(dialog.type==='rename'){success=mutate(latest=>{const next=resolveNavigation(latest);if(dialog.section)next.sections=next.sections.map(s=>s.id===dialog.id?{...s,title:titleValue}:s);else next.nodes=next.nodes.map(n=>n.id===dialog.id&&n.type==='folder'?{...n,title:titleValue}:n);return applyNavigation(latest,next);},'이름을 변경했습니다.');}
    if(success)setDialog(null);
  }
  function renderNodes(sectionId:string,parentId:string|null,depth:number):React.ReactNode{
    return <ul className={styles.list}>{childNodes(parentId,sectionId).filter(show).map(n=>{
      const doc=n.type==='document'?documents.get(n.id):undefined,children=childNodes(n.id,sectionId).filter(show),isClosed=!query.trim()&&closed.has(n.id),drop=drag?.active&&drag.drop?.id===n.id?drag.drop:undefined;
      return <li key={n.id}><div data-navigation-row={n.id} data-drop-edge={drop?.edge} className={`${styles.row} ${n.id===activeId?styles.selected:''} ${drag?.active&&drag.id===n.id?styles.dragged:''} ${drop?.error?styles.invalid:''}`} style={{'--depth':Math.min(depth,3)} as CSSProperties}>
        <button type="button" className={styles.grip} aria-label={`${title(n)} 이동`} title="드래그로 이동 · 클릭해서 위치 선택" disabled={readonly||!!query.trim()} onPointerDown={e=>{if(e.button!==0)return;e.currentTarget.setPointerCapture(e.pointerId);suppressClick.current=null;const value={id:n.id,startX:e.clientX,startY:e.clientY,x:e.clientX,y:e.clientY,active:false};dragRef.current=value;setDrag(value);}} onPointerMove={pointerMove} onPointerUp={()=>finishDrag()} onPointerCancel={()=>finishDrag(true)} onKeyDown={e=>{if(e.key==='Escape'){finishDrag(true);e.preventDefault();}}} onClick={e=>{const suppressed=suppressClick.current;suppressClick.current=null;if(e.detail>0&&suppressed?.id===n.id&&Date.now()<suppressed.until)return;openDialog({type:'move',id:n.id});}}><GripVertical size={13}/></button>
        {children.length||n.type==='folder'?<button type="button" className={styles.caret} aria-label={`${title(n)} ${isClosed?'펼치기':'접기'}`} aria-expanded={!isClosed} onClick={()=>toggle(n.id)}>{isClosed?<ChevronRight size={13}/>:<ChevronDown size={13}/>}</button>:<span className={styles.caret}/>}
        <button type="button" className={styles.open} title={title(n)} aria-current={n.id===activeId?'page':undefined} onClick={()=>doc?onOpen(doc.id):toggle(n.id)}>{n.type==='folder'?<Folder size={14}/>:doc?.kind==='wiki'?<WikiIcon category={doc.category} size={14}/>:doc?.kind==='memo'?<StickyNote size={14}/>:<FileText size={14}/>}<span className="tree-label">{title(n)}</span>{doc?.kind==='scene'&&<i className={`status-dot ${doc.status}`} role="img" aria-label={statuses[doc.status]}/>}</button>
        <IconButton label={`${title(n)} 메뉴`} className={styles.rowMenu} onClick={()=>openDialog({type:'menu',id:n.id})}><MoreHorizontal size={15}/></IconButton>
      </div>{!isClosed&&children.length>0&&renderNodes(sectionId,n.id,depth+1)}</li>;
    })}</ul>;
  }
  const dialogTitle=dialog?.type==='menu'?menuTitle:dialog?.type==='move'?`${moveNode?title(moveNode):'문서'} 이동`:dialog?.type==='folder'?'폴더 만들기':dialog?.type==='document'?'문서 만들기':dialog?.type==='section'?'대분류 추가':'이름 변경';
  return <div ref={root} className={styles.tree}>
    <div className={styles.toolbar}><span>문서</span>{undo&&<IconButton label="문서 정리 되돌리기" disabled={readonly} onClick={()=>{const previous=undo;mutate(latest=>restoreNavigation(latest,previous),'문서 정리를 되돌렸습니다.',false);setUndo(null);}}><Undo2 size={14}/></IconButton>}<IconButton label="대분류 추가" disabled={readonly||nav.sections.length>=40} onClick={()=>openDialog({type:'section'})}><Plus size={15}/></IconButton></div>
    {nav.sections.map((section,index)=>{const sectionClosed=!query.trim()&&closed.has(`section:${section.id}`),count=nav.nodes.filter(n=>n.sectionId===section.id&&n.type==='document').length,drop=drag?.active&&drag.drop?.id===section.id?drag.drop:undefined;
      return <section key={section.id} className={styles.section} aria-label={section.title}><div data-navigation-section={section.id} data-drop-edge={drop?.edge} className={`${styles.heading} ${drop?.error?styles.invalid:''}`}>
        <button type="button" className={styles.sectionTitle} aria-expanded={!sectionClosed} onClick={()=>toggle(`section:${section.id}`)}>{sectionClosed?<ChevronRight size={13}/>:<ChevronDown size={13}/>}<i className="tree-number" aria-hidden="true">{String(index+1).padStart(2,'0')}</i><span className="tree-label">{section.title}</span><small>{count}</small></button>
        <IconButton label={`${section.title} 문서 추가`} disabled={readonly} className={styles.rowMenu} onClick={()=>openDialog({type:'document',to:{sectionId:section.id,parentId:null},kind:section.defaultKind})}><Plus size={14}/></IconButton><IconButton label={`${section.title} 대분류 메뉴`} className={styles.rowMenu} onClick={()=>openDialog({type:'menu',id:section.id,section:true})}><MoreHorizontal size={15}/></IconButton>
      </div>{!sectionClosed&&renderNodes(section.id,null,0)}{!sectionClosed&&!childNodes(null,section.id).length&&<p className={styles.empty}>문서를 추가하거나 여기로 옮겨주세요.</p>}</section>;
    })}
    {query.trim()&&!nav.nodes.some(show)&&<p className="empty-text">검색 결과가 없습니다.</p>}
    <p className={styles.help}>{query.trim()?'드래그로 정리하려면 검색을 닫으세요.':'손잡이를 끌어 순서 변경 · 가운데 놓아 하위로 이동'}</p>
    {!dialog&&error&&<p className={styles.error} role="alert">{error}</p>}<p className={styles.notice} role="status">{notice}</p>
    {drag?.active&&<div className={styles.ghost} style={{left:Math.max(4,Math.min(drag.x+12,typeof window==='undefined'?0:window.innerWidth-190)),top:drag.y+15}}>{nodes.get(drag.id)?title(nodes.get(drag.id)!):'문서'}<small>{drag.drop?.error|| (drag.drop?drag.drop.edge==='inside'?'하위에 넣기':drag.drop.edge==='before'?'앞에 놓기':'뒤에 놓기':'놓을 위치를 선택하세요.')}</small></div>}
    <Modal open={!!dialog} onClose={()=>{setDialog(null);setError('');}} title={dialogTitle} description={dialog?.type==='move'?'하위 문서와 폴더도 함께 이동합니다. 문서 종류와 부·장은 유지됩니다.':undefined} onReturnFocus={()=>{const target=returnFocus.current;if(target?.isConnected)target.focus();else (root.current?.querySelector<HTMLButtonElement>(`[data-navigation-row="${activeId}"] button`)||document.getElementById('sidebar-toggle'))?.focus();}}>
      {dialog?.type==='menu'?<div className={styles.actions}>
        <button type="button" disabled={readonly} onClick={()=>openDialog({type:'document',to:menuTo!,kind:defaultKind})}><Plus size={16}/>{selectedMenu?'하위 문서 추가':'문서 추가'}</button>
        <button type="button" disabled={readonly} onClick={()=>openDialog({type:'folder',to:menuTo!})}><FolderPlus size={16}/>{selectedMenu?'하위 폴더 추가':'폴더 추가'}</button>
        {selectedMenu&&<>
          <button type="button" disabled={readonly} onClick={()=>openDialog({type:'move',id:selectedMenu.id})}><GripVertical size={16}/>이동 · 순서 변경</button>
          {([-1,1] as const).map(direction=><button type="button" key={direction} disabled={readonly||!siblingDestination(work,selectedMenu.id,direction)} onClick={()=>{mutate(latest=>{const to=siblingDestination(latest,selectedMenu.id,direction);return to?moveNavigation(latest,selectedMenu.id,to):latest;},'문서 순서를 저장했습니다.');setDialog(null);}}>{direction<0?<ArrowUp size={16}/>:<ArrowDown size={16}/>}{direction<0?'위로 옮기기':'아래로 옮기기'}</button>)}
          {selectedMenu.type==='document'&&<button type="button" onClick={()=>{onOpen(selectedMenu.id,true);setDialog(null);}}><Columns2 size={16}/>옆에서 열기</button>}
        </>}
        {(menuSection||selectedMenu?.type==='folder')&&<button type="button" disabled={readonly} onClick={()=>openDialog({type:'rename',id:dialog.id,section:dialog.section})}>이름 변경</button>}
        {menuSection&&([-1,1] as const).map(direction=>{const index=nav.sections.findIndex(s=>s.id===menuSection.id);return <button type="button" key={direction} disabled={readonly||index+direction<0||index+direction>=nav.sections.length} onClick={()=>{mutate(latest=>{const next=resolveNavigation(latest),i=next.sections.findIndex(s=>s.id===menuSection.id);[next.sections[i],next.sections[i+direction]]=[next.sections[i+direction],next.sections[i]];return applyNavigation(latest,next);},'대분류 순서를 저장했습니다.');setDialog(null);}}>{direction<0?<ArrowUp size={16}/>:<ArrowDown size={16}/>}{direction<0?'대분류 위로':'대분류 아래로'}</button>;})}
        {(selectedMenu?.type==='folder'&&!childNodes(selectedMenu.id,selectedMenu.sectionId).length||menuSection&&!['scene','wiki','memo'].includes(menuSection.id)&&!nav.nodes.some(n=>n.sectionId===menuSection.id))&&<button type="button" disabled={readonly} onClick={()=>{mutate(latest=>{const next=resolveNavigation(latest);if(menuSection)next.sections=next.sections.filter(s=>s.id!==menuSection.id);else next.nodes=next.nodes.filter(n=>n.id!==selectedMenu!.id);return applyNavigation(latest,next);},'빈 정리 항목을 삭제했습니다.');setDialog(null);}}>빈 {menuSection?'대분류':'폴더'} 삭제</button>}
      </div>:<form onSubmit={e=>{e.preventDefault();formSubmit();}} className={styles.form}>
        {dialog?.type==='move'?<><label>옮길 위치<select value={destination} onChange={e=>{setDestination(e.target.value);setPlace('last');}}>{targets.map(t=><option value={t.value} key={t.value}>{t.label}</option>)}</select></label><label>순서<select value={place} onChange={e=>setPlace(e.target.value)}><option value="last">맨 뒤</option><option value="first">맨 앞</option>{moveSiblings.map(n=><option key={n.id} value={`before:${n.id}`}>{title(n)} 앞</option>)}</select></label></>:<label>{dialog?.type==='document'?'문서 제목':'이름'}<input autoFocus value={name} onChange={e=>setName(e.target.value)} maxLength={dialog?.type==='section'?200:300} required/></label>}
        {(dialog?.type==='section'||dialog?.type==='document')&&<label>{dialog.type==='section'?'기본 문서 종류':'문서 종류'}<select value={kind} onChange={e=>setKind(e.target.value as NovelDocument['kind'])}>{Object.entries(labels).map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label>}
        {dialog?.type==='section'&&<p className="field-help">대분류는 정리용입니다. 이동해도 원고·설정·메모의 종류는 바뀌지 않습니다.</p>}
        {dialog?.type==='folder'&&<p className="field-help">폴더 이름은 독서 화면의 부·장과 별도로 관리합니다.</p>}
        {error&&<p role="alert" className={styles.error}>{error}</p>}<div className={styles.formButtons}><button type="button" className="button" onClick={()=>setDialog(null)}>취소</button><button type="submit" className="button" disabled={readonly}>{dialog?.type==='move'?'이동':dialog?.type==='rename'?'변경':'추가'}</button></div>
      </form>}
    </Modal>
  </div>;
}
