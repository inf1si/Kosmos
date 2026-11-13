'use client';

import { useEffect,useId,useLayoutEffect,useRef,useState,type RefObject } from 'react';
import * as Popup from '@radix-ui/react-popover';
import { Check } from 'lucide-react';
import { chatMentionAbandoned,chatMentionQuery,insertChatMention,type ChatMentionQuery } from '@/lib/ai-source-mentions';
import { referencePlace,searchReferences,type ReferenceTarget } from '@/lib/internal-references';
import { ReferenceIcon } from './internal-reference-icon';

export function ChatMentionInput({value,onChange,inputRef,targets,sourceId,selectedIds,onSelectSource,disabled,onSend}:{value:string;onChange:(value:string)=>void;inputRef:RefObject<HTMLTextAreaElement|null>;targets:ReferenceTarget[];sourceId:string;selectedIds:string[];onSelectSource:(id:string)=>void;disabled:boolean;onSend:()=>void}){
  const [query,setQuery]=useState<ChatMentionQuery|null>(null),[index,setIndex]=useState(0),listId=useId();
  const dismissed=useRef<Pick<ChatMentionQuery,'from'|'text'>|null>(null),composing=useRef(false),caret=useRef<number|null>(null),menu=useRef<HTMLDivElement>(null);
  const found=query?searchReferences(targets,sourceId,query.text):[],chosen=Math.min(index,Math.max(0,found.length-1));
  const open=!!query&&!disabled;

  function close(){if(query)dismissed.current=query;setQuery(null);}

  function update(input:HTMLTextAreaElement){
    const next=composing.current?null:chatMentionQuery(input.value,input.selectionStart,input.selectionEnd);

    if(!next){dismissed.current=null;setQuery(null);

return;}

    if(dismissed.current?.from===next.from&&next.text.startsWith(dismissed.current.text)){setQuery(null);

return;}

    if(chatMentionAbandoned(next.text,searchReferences(targets,sourceId,next.text).length)){setQuery(null);

return;}

    if(next.from!==query?.from||next.text!==query?.text)setIndex(0);
    setQuery(next);
  }

  function choose(target:ReferenceTarget){
    if(!query||disabled)return;
    const next=insertChatMention(value,query,target.label);

    if(!next){close();

return;}

    dismissed.current={from:query.from,text:`${target.label} `};caret.current=next.caret;setQuery(null);onChange(next.value);onSelectSource(target.targetId);
  }

  useLayoutEffect(()=>{
    if(caret.current===null||!inputRef.current)return;
    inputRef.current.focus();inputRef.current.setSelectionRange(caret.current,caret.current);caret.current=null;
  });
  useEffect(()=>{menu.current?.querySelector('[aria-selected=true]')?.scrollIntoView({block:'nearest'});},[chosen,query?.text]);

  return <Popup.Root open={open} onOpenChange={next=>{if(!next)close();}}><Popup.Anchor asChild><textarea ref={inputRef} aria-label="AI에게 질문" rows={3} disabled={disabled} placeholder="질문 입력" value={value} aria-autocomplete="list" aria-controls={open?listId:undefined} aria-haspopup="listbox" aria-activedescendant={open&&found.length?`${listId}-${chosen}`:undefined}
    onChange={e=>{onChange(e.target.value);update(e.currentTarget);}} onSelect={e=>update(e.currentTarget)}
    onCompositionStart={()=>{composing.current=true;setQuery(null);}} onCompositionEnd={e=>{composing.current=false;update(e.currentTarget);}}
    onKeyDown={e=>{
      if(composing.current||e.nativeEvent.isComposing||e.keyCode===229)return;

      if(open&&e.key==='Escape'){e.preventDefault();e.stopPropagation();close();

return;}

      if(open&&e.key==='Tab'){close();

return;}

      if(open&&found.length&&(e.key==='ArrowDown'||e.key==='ArrowUp')){e.preventDefault();setIndex(i=>(i+(e.key==='ArrowDown'?1:-1)+found.length)%found.length);

return;}

      if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();

if(open){if(found.length)choose(found[chosen]);}else onSend();}
    }}/></Popup.Anchor><Popup.Portal><Popup.Content ref={menu} className="menu note-command-menu internal-reference-search" side="top" align="start" sideOffset={6} collisionPadding={12} aria-label="AI 참고 자료 검색"
    onOpenAutoFocus={e=>e.preventDefault()} onCloseAutoFocus={e=>e.preventDefault()}
    onInteractOutside={e=>{if(e.target===inputRef.current)e.preventDefault();}} onEscapeKeyDown={e=>{e.preventDefault();e.stopPropagation();close();}}>
    <div className="note-command-caption">참고 자료</div><div role="listbox" id={listId} aria-label="AI 참고 자료">{found.map((target,i)=><button key={target.targetId} type="button" role="option" tabIndex={-1} id={`${listId}-${i}`} aria-selected={chosen===i} className="menu-item internal-reference-option" data-highlighted={chosen===i?'':undefined} onPointerMove={()=>setIndex(i)} onMouseDown={e=>e.preventDefault()} onClick={()=>choose(target)}><ReferenceIcon kind={target.kind} size={15}/><span><strong>{target.label}</strong><small title={target.path}>{referencePlace(target)}</small></span>{selectedIds.includes(target.targetId)&&<Check size={14} aria-label="선택됨"/>}</button>)}</div>
    {!found.length&&<p role="status" className="muted internal-reference-empty">일치하는 자료가 없습니다.</p>}
  </Popup.Content></Popup.Portal></Popup.Root>;
}
