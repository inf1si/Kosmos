'use client';

import {useEffect,useId,useRef,useState} from 'react';
import type {Editor} from '@tiptap/core';
import {closeHistory} from '@tiptap/pm/history';
import {Globe,ExternalLink,Unlink} from 'lucide-react';
import {captureEditorTarget} from '@/lib/editor-target';
import {captureWebLink,normalizeWebLink,webLinkTransaction,type WebLinkTarget} from '@/lib/editor-web-links';
import {IconButton,Popover,type PopoverAnchor} from './primitives';

export function requestWebLink(editor:Editor){editor.view.dom.dispatchEvent(new Event('editor-web-link'));}

export function EditorWebLink({editor,readonly}:{editor:Editor|null;readonly:boolean}){
  const [target,setTarget]=useState<WebLinkTarget|null>(null),[url,setUrl]=useState(''),[label,setLabel]=useState(''),[error,setError]=useState('');
  const buttonId=useId(),anchor:PopoverAnchor=useRef(null),opener=useRef<()=>void>(()=>{}),input=useRef<HTMLInputElement>(null);
  const current=!!editor&&!!target&&!readonly&&!editor.isDestroyed&&editor.isEditable&&editor.state.doc.eq(target.document),href=normalizeWebLink(url);

  function show(){
    if(!editor||readonly||!editor.isEditable)return;

    try{
      captureEditorTarget(editor);
      const next=captureWebLink(editor.state);setTarget(next);setUrl(next.href);setLabel('');setError('');
      anchor.current={getBoundingClientRect:()=>{
        try{const c=editor.view.coordsAtPos(next.from),scroll=editor.view.dom.closest('.editor-scroll')?.getBoundingClientRect();

          if(scroll&&c.bottom>scroll.top&&c.top<scroll.bottom)return new DOMRect(c.left,c.top,1,c.bottom-c.top);
        }catch{}

        return document.getElementById(buttonId)?.getBoundingClientRect()||new DOMRect();
      }};
    }catch(e){setError(e instanceof Error?e.message:'글을 선택하세요.');}
  }

  opener.current=show;
  useEffect(()=>{
    if(!editor)return;

    let start:{x:number;y:number}|null=null;
    const down=(event:MouseEvent)=>{if(event.button===0)start={x:event.clientX,y:event.clientY};};

    const dom=editor.view.dom,open=()=>opener.current(),click=(event:MouseEvent)=>{
      const link=event.target instanceof Element?event.target.closest('a[href]'):null;

      if(!link||!dom.contains(link)||!editor.isEditable||event.button!==0)return;
      event.preventDefault();

      if(event.ctrlKey||event.metaKey){const href=normalizeWebLink(link.getAttribute('href')||'');

if(href)window.open(href,'_blank','noopener,noreferrer');}
      else{
        const dragged=event.detail!==0&&start&&Math.hypot(event.clientX-start.x,event.clientY-start.y)>5;start=null;

        if(dragged)return;
        const pos=event.detail===0?editor.view.posAtDOM(link,0):editor.view.posAtCoords({left:event.clientX,top:event.clientY})?.pos;

        if(pos!==undefined)editor.commands.setTextSelection(pos);
        opener.current();
      }
    };

    dom.addEventListener('editor-web-link',open);dom.addEventListener('mousedown',down);dom.addEventListener('click',click);

    return()=>{dom.removeEventListener('editor-web-link',open);dom.removeEventListener('mousedown',down);dom.removeEventListener('click',click);};
  },[editor]);

  function close(){setTarget(null);setError('');}

  function apply(remove=false){
    if(!editor||!target||!current||readonly||!editor.isEditable)return;

    try{const tr=webLinkTransaction(editor.state,target,remove?null:url,label);editor.view.dispatch(tr);editor.view.dispatch(closeHistory(editor.state.tr));close();editor.view.focus();}
    catch(e){setError(e instanceof Error?e.message:'웹 주소를 확인하세요.');input.current?.focus();}
  }

  return <>
    <IconButton id={buttonId} label="웹 링크" disabled={!editor||readonly} aria-pressed={editor?.isActive('link')||!!target} onMouseDown={event=>event.preventDefault()} onClick={show}><Globe size={16}/></IconButton>
    {error&&!target&&<span className="note-command-notice" role="status">{error}</span>}
    <Popover open={!!target} onOpenChange={open=>{if(!open)close();}} anchor={anchor} title={target?.linked?'웹 링크 수정':'웹 링크 추가'} width={320} onReturnFocus={()=>{if(editor&&!editor.isDestroyed)editor.view.focus();}}>
      <form className="editor-web-link-form" onSubmit={event=>{event.preventDefault();apply();}}>
        <label>주소<input ref={input} autoFocus aria-label="웹 링크 주소" type="text" inputMode="url" autoComplete="url" autoCapitalize="off" spellCheck={false} maxLength={4096} placeholder="https://example.com" value={url} aria-invalid={!!error} onChange={event=>{setUrl(event.target.value);setError('');}}/></label>
        {target?.inserting&&<label>표시할 글<input aria-label="웹 링크 표시할 글" value={label} maxLength={1000} onChange={event=>setLabel(event.target.value)}/></label>}
        {(!current||error)&&<p className="chat-error" role="status">{error||'글이 바뀌었습니다. 다시 열어주세요.'}</p>}
        <div className="popover-actions">
          {target?.linked&&<button type="button" className="button ghost" disabled={!current} onClick={()=>apply(true)}><Unlink size={14}/>링크 해제</button>}
          {href&&<a className="button" href={href} target="_blank" rel="noopener noreferrer" aria-label="웹 링크 새 탭에서 열기"><ExternalLink size={14}/></a>}
          <button type="button" onClick={close}>취소</button><button type="submit" className="primary" disabled={!current||!url.trim()}>{target?.linked?'저장':'추가'}</button>
        </div>
      </form>
    </Popover>
  </>;
}
