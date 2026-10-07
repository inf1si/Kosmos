'use client';

import { useEffect,useRef,useState } from 'react';
import type { Editor } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import * as Popup from '@radix-ui/react-popover';
import { MessageSquareText } from 'lucide-react';
import { editorFootnote,updateEditorFootnote } from '@/lib/editor-footnotes';

export function EditorFootnotePopover({editor,id,readonly,onClose,onStay,onLeave,onEditing}:{editor:Editor;id:string;readonly:boolean;onClose:()=>void;onStay:()=>void;onLeave:()=>void;onEditing:(value:boolean)=>void}){
  const [draft,setDraft]=useState<{original:string;text:string}|null>(null),[error,setError]=useState('');
  const input=useRef<HTMLTextAreaElement>(null),restoreFocus=useRef(false);
  const note=editorFootnote(editor.state.doc,id),current=!!note&&(!draft||note.text===draft.original);
  const editing=!!draft;
  const anchor=useRef({getBoundingClientRect:()=>new DOMRect()});
  anchor.current.getBoundingClientRect=()=>{
    const live=editorFootnote(editor.state.doc,id),element=live?editor.view.nodeDOM(live.pos):null;

    return element instanceof Element?element.getBoundingClientRect():editor.view.dom.getBoundingClientRect();
  };

  useEffect(()=>{if(editing)input.current?.focus();},[editing]);

  function edit(){if(!note||readonly||!editor.isEditable)return;onStay();onEditing(true);setDraft({original:note.text,text:note.text});setError('');}

  function cancel(){restoreFocus.current=true;onClose();}

  function save(){
    if(!draft||readonly||editor.isDestroyed||!editor.isEditable)return;
    const tr=editor.state.tr;

    if(!updateEditorFootnote(tr,id,draft.original,draft.text)){setError('각주가 바뀌었습니다. 다시 열어 수정하세요.');

return;}

    if(tr.docChanged){editor.view.dispatch(tr);editor.view.dispatch(closeHistory(editor.state.tr));}

    restoreFocus.current=true;onClose();
  }

  return <Popup.Root open onOpenChange={open=>{if(!open)onClose();}}><Popup.Anchor virtualRef={anchor}/><Popup.Portal>
    <Popup.Content className="popover wiki-preview note-preview note-preview-popover" side="bottom" align="start" sideOffset={8} collisionPadding={12} aria-label={`각주 ${note?.index||''}`} onMouseEnter={onStay} onMouseLeave={onLeave} onOpenAutoFocus={e=>e.preventDefault()} onInteractOutside={e=>{const target=e.target instanceof Element?e.target.closest('[data-note-id]'):null;

if(target?.getAttribute('data-note-id')===id&&editor.view.dom.contains(target))e.preventDefault();}} onEscapeKeyDown={()=>{restoreFocus.current=true;}} onCloseAutoFocus={e=>{e.preventDefault();

if(restoreFocus.current&&!editor.isDestroyed)editor.view.focus();}}>
      <span><MessageSquareText size={13}/>각주 {note?.index}</span>
      {draft?<><textarea ref={input} aria-label="각주 내용" rows={4} value={draft.text} readOnly={readonly} onChange={e=>setDraft({...draft,text:e.target.value})}/>{(!current||error)&&<p className="chat-error" role="status">{error||'각주가 바뀌었습니다. 다시 열어 수정하세요.'}</p>}<div className="popover-actions"><button type="button" onClick={cancel}>취소</button><button type="button" className="primary" disabled={readonly||!current||!draft.text.trim()} onClick={save}>각주 저장</button></div></>:<><p>{note?.text||'내용 없는 각주'}</p>{!readonly&&<footer><button type="button" onClick={edit}>각주 수정</button></footer>}</>}
    </Popup.Content>
  </Popup.Portal></Popup.Root>;
}
