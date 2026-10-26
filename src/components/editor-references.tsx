'use client';

import { useEffect,useId,useMemo,useRef,useState } from 'react';
import type { Editor } from '@tiptap/core';
import { Plugin,PluginKey } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import * as Popup from '@radix-ui/react-popover';
import { internalReferenceType } from '@/lib/internal-reference-node';
import { referenceGroup,referenceGroups,referenceKey,referencePlace,referenceTargets,searchReferences,type ReferenceTarget } from '@/lib/internal-references';
import { ReferenceIcon } from './internal-reference-icon';
import { useStudio } from './studio-provider';

const key=new PluginKey('internalReferenceSearch');

type Query={from:number;to:number;text:string};

type ReferenceRow={target:ReferenceTarget}|{more:string;label:string};

export function EditorReferences({editor,sourceId}:{editor:Editor;sourceId:string}){
  const state=useStudio().state,targets=useMemo(()=>state?referenceTargets(state):[],[state]);
  const [query,setQuery]=useState<Query|null>(null),[index,setIndex]=useState(0),[expanded,setExpanded]=useState<string[]>([]),listId=useId();
  const currentQuery=useRef<Query|null>(null),dismissed=useRef<number|null>(null),menu=useRef<HTMLDivElement>(null),handler=useRef<(e:KeyboardEvent)=>boolean>(()=>false);
  const found=query?searchReferences(targets,sourceId,query.text):[];

  const rows:ReferenceRow[]=referenceGroups.flatMap(group=>{
    const items=found.filter(target=>referenceGroup(target)===group.id),limit=query?.text.trim()||expanded.includes(group.id)?30:5;

    return [...items.slice(0,limit).map(target=>({target})),...(items.length>limit?[{more:group.id,label:`${group.label} 더 보기`}]:[])];
  }),chosen=Math.min(index,Math.max(0,rows.length-1));

  function close(){if(query)dismissed.current=query.from;setQuery(null);}

  function insert(target:ReferenceTarget){
    if(!query||!editor.isEditable||editor.isDestroyed||editor.state.doc.textBetween(query.from,query.to)!==`@${query.text}`){close();

return;}

    const {kind,targetId,workId,label}=target;
    editor.chain().focus().command(({tr})=>{closeHistory(tr);

return true;}).insertContentAt({from:query.from,to:query.to},[{type:internalReferenceType,attrs:{kind,targetId,workId,label}},{type:'text',text:' '}]).run();
    editor.view.dispatch(closeHistory(editor.state.tr));setQuery(null);dismissed.current=null;
  }

  function choose(row:ReferenceRow){if('target' in row)insert(row.target);else setExpanded(previous=>[...previous,row.more]);}

  handler.current=event=>{
    if(!query||event.isComposing||event.keyCode===229||editor.view.composing||!editor.isEditable)return false;

    if(event.key==='Escape'){close();

return true;}

    if(event.key==='Tab'){close();

return false;}

    if(event.altKey||event.ctrlKey||event.metaKey){close();

return false;}

    if(rows.length&&(event.key==='ArrowDown'||event.key==='ArrowUp')){setIndex(i=>(i+(event.key==='ArrowDown'?1:-1)+rows.length)%rows.length);

return true;}

    if(rows.length&&event.key==='Enter'){choose(rows[chosen]);

return true;}

    return false;
  };

  useEffect(()=>{
    const update=()=>{
      if(!editor.isEditable||!editor.isFocused||!editor.state.selection.empty||editor.isActive('code')){setQuery(null);

return;}

      const {$from,from}=editor.state.selection;

      if(!['paragraph','heading'].includes($from.parent.type.name)){setQuery(null);

return;}

      const text=$from.parent.textBetween(0,$from.parentOffset,'','\ufffc'),offset=text.lastIndexOf('@'),prefix=text.slice(0,offset),value=text.slice(offset+1);

      // ASCII email addresses stay literal. Inline atom placeholders keep ProseMirror offsets intact.
      if(offset<0||/[A-Za-z0-9._%+-]$/.test(prefix)||!/^[^@/\n\ufffc]{0,80}$/.test(value)) {dismissed.current=null;setQuery(null);

return;}

      const start=$from.start()+offset;

      if(editor.state.doc.nodeAt(start)?.marks.some(mark=>mark.type.name==='code')){setQuery(null);

return;}

      if(dismissed.current===start)return;

      if(currentQuery.current?.text!==value||currentQuery.current.from!==start){setIndex(0);setExpanded([]);}

      currentQuery.current={from:start,to:from,text:value};setQuery(currentQuery.current);
    };

    const blur=()=>setQuery(null),plugin=new Plugin({key,props:{handleKeyDown:(_view,event)=>handler.current(event)}});
    editor.registerPlugin(plugin,(added,plugins)=>[added,...plugins]);editor.on('transaction',update);editor.on('focus',update);editor.on('blur',blur);

    return()=>{editor.unregisterPlugin(key);editor.off('transaction',update);editor.off('focus',update);editor.off('blur',blur);};
  },[editor]);
  useEffect(()=>{menu.current?.querySelector('[aria-selected=true]')?.scrollIntoView({block:'nearest'});},[chosen,query?.text]);
  useEffect(()=>{
    const dom=editor.view.dom;

    if(query){dom.setAttribute('aria-controls',listId);

if(rows.length)dom.setAttribute('aria-activedescendant',`${listId}-${chosen}`);}

    return()=>{if(dom.getAttribute('aria-controls')===listId){dom.removeAttribute('aria-controls');dom.removeAttribute('aria-activedescendant');}};
  },[editor,query,chosen,rows.length,listId]);
  const anchor=useRef({getBoundingClientRect:()=>new DOMRect()});
  anchor.current.getBoundingClientRect=()=>{try{const pos=editor.view.coordsAtPos(query?.to??editor.state.selection.to);

return new DOMRect(pos.left,pos.top,1,pos.bottom-pos.top);}catch{return editor.view.dom.getBoundingClientRect();}};

  return <Popup.Root open={!!query} onOpenChange={open=>{if(!open)close();}}><Popup.Anchor virtualRef={anchor}/><Popup.Portal><Popup.Content ref={menu} className="menu note-command-menu internal-reference-search" side="bottom" align="start" sideOffset={6} collisionPadding={12} onOpenAutoFocus={e=>e.preventDefault()} onCloseAutoFocus={e=>e.preventDefault()} onFocusOutside={e=>{if(e.target instanceof globalThis.Node&&editor.view.dom.contains(e.target))e.preventDefault();}} onEscapeKeyDown={close}>
    <div className="note-command-caption">참조 <kbd>↑↓ 선택 · Enter 삽입</kbd></div>
    <div role="listbox" id={listId} aria-label="참조할 항목">{referenceGroups.map(group=>{
      const items=rows.flatMap((row,i)=>('target' in row?referenceGroup(row.target):row.more)===group.id?[{row,i}]:[]);

      return items.length>0&&<div role="group" aria-label={group.label} key={group.id}><div className="note-command-caption" aria-hidden="true">{group.label}</div>{items.map(({row,i})=><button type="button" role="option" tabIndex={-1} id={`${listId}-${i}`} aria-selected={chosen===i} className={`menu-item${'target' in row?' internal-reference-option':''}`} data-highlighted={chosen===i?'':undefined} key={'target' in row?referenceKey(row.target):`more:${row.more}`} onPointerMove={()=>setIndex(i)} onMouseDown={e=>e.preventDefault()} onClick={()=>choose(row)}>{'target' in row?<><ReferenceIcon kind={row.target.kind} size={15}/><span><strong>{row.target.label}</strong><small title={row.target.path}>{referencePlace(row.target)}</small></span></>:row.label}</button>)}</div>;
    })}</div>
    {!found.length&&<p className="muted internal-reference-empty">일치하는 항목이 없습니다.</p>}
  </Popup.Content></Popup.Portal></Popup.Root>;
}
