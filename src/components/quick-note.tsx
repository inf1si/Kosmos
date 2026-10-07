'use client';

import { useState } from 'react';
import { StickyNote } from 'lucide-react';
import { IconButton, Popover } from './primitives';
import { useStudio } from './studio-provider';
import { addNote, newNote, noteFromText } from '@/lib/personal-notes';

/** 한 줄이 한 문단인 새 노트를 수집함 맨 앞에 넣는다. 팝오버와 참고 패널 노트 탭이 함께 쓴다. */
export function QuickNoteForm({disabled,onOpenNote,rows=4,autoFocus=false}:{disabled:boolean;onOpenNote:(id:string)=>void;rows?:number;autoFocus?:boolean}){
  const s=useStudio(),[text,setText]=useState(''),[saved,setSaved]=useState(0),[error,setError]=useState('');

  function save(){
    const note=text.trim()?noteFromText(text):newNote();

    try{s.update(state=>addNote(state,note));}catch(e){setError(e instanceof Error?e.message:'노트를 만들지 못했습니다.');

return null;}

    setText('');setError('');

return note.id;
  }

  function capture(){if(!text.trim()||disabled)return;

if(save())setSaved(n=>n+1);}

  function openNote(){if(disabled)return;const id=save();

if(id)onOpenNote(id);}

  return <>
    <textarea className="quick-note-input" aria-label="빠른 메모 내용" rows={rows} maxLength={10000} placeholder="떠오른 생각을 적으세요" value={text} disabled={disabled} autoFocus={autoFocus}
      onChange={e=>{setText(e.target.value);setSaved(0);}} onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();capture();}}}/>
    {error?<p className="danger" role="alert">{error}</p>:saved>0&&<p className="muted" role="status">수집함에 넣었습니다{saved>1?` · ${saved}개`:''}.</p>}
    <div className="popover-actions"><button type="button" className="button" disabled={disabled} onClick={openNote}>노트에서 열기</button><button type="button" className="button" disabled={disabled||!text.trim()} onClick={capture}>수집함에 넣기</button></div>
  </>;
}

/** 집필실을 떠나지 않고 한두 줄을 수집함에 넣는다. Alt+N은 Studio가 open으로 연다. */
export function QuickNote({open,onOpenChange,disabled,onOpenNote}:{open:boolean;onOpenChange:(open:boolean)=>void;disabled:boolean;onOpenNote:(id:string)=>void}){
  return <Popover open={open} onOpenChange={onOpenChange} title="빠른 메모" description="수집함에 새 노트로 넣습니다." width={340} align="end"
    onReturnFocus={()=>document.querySelector<HTMLElement>('.studio-panel .manuscript')?.focus()}
    trigger={<IconButton label="빠른 메모 (Alt+N)" disabled={disabled}><StickyNote size={16}/></IconButton>}>
    {open&&<QuickNoteForm disabled={disabled} autoFocus onOpenNote={id=>{onOpenChange(false);onOpenNote(id);}}/>}
  </Popover>;
}
