'use client';

import { Book, Plus } from 'lucide-react';
import { DocIcon } from './studio-icons';
import { countChars } from '@/lib/outline';
import { noteDate } from '@/lib/personal-notes';
import { recentDocuments, workUpdatedAt } from '@/lib/studio-position';
import type { NovelDocument, Work, Workspace } from '@/lib/model';

const kinds={scene:'원고',wiki:'설정집',memo:'메모'} as const;

const workChars=(work:Work)=>work.documents.filter(d=>d.kind==='scene').reduce((n,d)=>n+countChars(d),0);

const place=(doc:NovelDocument)=>doc.kind==='scene'?doc.chapter.trim()||'부 미지정':doc.kind==='wiki'?doc.category.trim()||kinds.wiki:kinds.memo;

/** The studio's first screen: where the writer left off, every work, and recent edits across works. Layout matches the notes home. */
export function StudioHome({state,resume,currentWorkId,readonly,onOpen,onOpenWork,onNewWork}:{state:Workspace;resume:{work:Work;doc:NovelDocument};currentWorkId:string;readonly:boolean;onOpen:(workId:string,docId:string)=>void;onOpenWork:(workId:string)=>void;onNewWork:()=>void}){
  const scenes=state.works.reduce((n,w)=>n+w.documents.filter(d=>d.kind==='scene').length,0);
  const recent=recentDocuments(state);

  return <div className="plot-board notes-home studio-home">
    <div className="board-bar"><span>작품 {state.works.length} · 장면 {scenes} · {state.works.reduce((n,w)=>n+workChars(w),0).toLocaleString()}자</span><button type="button" className="button" disabled={readonly} onClick={onNewWork}><Plus size={15}/>새 작품</button></div>
    <div className="notes-home-body">
      <section aria-label="이어 쓰기"><h3>이어 쓰기</h3><div className="notes-home-grid">
        <button type="button" className="reference-card" onClick={()=>onOpen(resume.work.id,resume.doc.id)}><DocIcon doc={resume.doc} size={16}/><span><strong>{resume.doc.title}</strong><small>{resume.work.title} · {place(resume.doc)} · {noteDate(resume.doc.updatedAt)} 수정</small></span></button>
      </div></section>
      <section aria-label="작품"><h3>작품 {state.works.length}</h3><div className="notes-home-grid">{state.works.map(work=>{const updated=noteDate(workUpdatedAt(work));

return <button type="button" className="reference-card" key={work.id} aria-current={work.id===currentWorkId||undefined} onClick={()=>onOpenWork(work.id)}><Book size={16}/><span><strong>{work.title}</strong><small>{work.form} · 장면 {work.documents.filter(d=>d.kind==='scene').length} · {workChars(work).toLocaleString()}자{updated&&` · ${updated} 수정`}</small></span></button>;})}</div></section>
      <section aria-label="최근 수정"><h3>최근 수정 문서</h3><div className="notes-home-grid">{recent.map(({work,doc})=><button type="button" className="reference-card" key={doc.id} onClick={()=>onOpen(work.id,doc.id)}><DocIcon doc={doc} size={16}/><span><strong>{doc.title}</strong><small>{state.works.length>1?`${work.title} · `:''}{place(doc)} · {noteDate(doc.updatedAt)}</small></span></button>)}</div></section>
    </div>
  </div>;
}
