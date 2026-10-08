'use client';

import { documentTitle } from '@/lib/model';

import { documentSchema } from '@/lib/model';
import { useState } from 'react';
import { useAppPreferences } from './use-app-preferences';
import { Clock3, Link2, Plus, User } from 'lucide-react';
import { NovelDocument, statuses, wikiReferences } from '@/lib/model';
import { countChars, groupScenes, nextPartLabel, storyDay, type SceneGroup } from '@/lib/outline';

type BoardMode='part'|'status'|'time';

const modes:[BoardMode,string][]=[['part','부와 장'],['status','진행 상태'],['time','작중 시간']];

/** Scene cards in columns by part (default), progress status or story day. */
export function PlotBoard({documents,onOpen,onCreate}:{documents:NovelDocument[];onOpen:(id:string)=>void;onCreate:(chapter?:string)=>void}){
  const [{plotBoardMode}]=useAppPreferences();const [mode,setMode]=useState<BoardMode>(plotBoardMode);
  const scenes=documents.filter(d=>d.kind==='scene');const wiki=new Map(documents.filter(d=>d.kind==='wiki').map(d=>[d.id,documentTitle(d)]));

  const columns:SceneGroup[]=mode==='part'?groupScenes(scenes,d=>d.chapter,'부 미지정',true)
    :mode==='status'?(documentSchema.shape.status.options).map(status=>({key:status,kicker:'',title:statuses[status],scenes:scenes.filter(d=>d.status===status)}))
    :groupScenes(scenes,d=>storyDay(d.storyTime),'시간 미정',true);

  const total=scenes.reduce((n,d)=>n+countChars(d),0);

  return <div className="plot-board">
    <div className="board-bar"><div className="segmented" role="group" aria-label="보드 기준">{modes.map(([value,label])=><button type="button" key={value} aria-pressed={mode===value} onClick={()=>setMode(value)}>{label}</button>)}</div><span>원고 {scenes.length} · {total.toLocaleString()}자</span><button type="button" className="button" onClick={()=>onCreate()}><Plus size={15}/>문서 추가</button></div>
    <div className="board-columns">
      {columns.map(column=><section className="board-column" key={column.key||'none'} aria-label={[column.kicker,column.title].filter(Boolean).join(' · ')}>
        <header>{column.kicker&&<small>{column.kicker}</small>}<strong>{column.title}</strong><span>{column.scenes.length}</span></header>
        {column.scenes.map(d=>{const links=wikiReferences(d.content).map(id=>wiki.get(id)).filter((t):t is string=>!!t);

return <button type="button" className="plot-card" key={d.id} onClick={()=>onOpen(d.id)}>
          <span className="plot-card-meta"><i className={`status-dot ${d.status}`} aria-hidden="true"/><span>{statuses[d.status]}</span><span>{countChars(d).toLocaleString()}자</span></span>
          <strong>{documentTitle(d)}</strong>{d.summary?<span className="plot-card-summary">{d.summary}</span>:<span className="plot-card-summary empty">요약 없음</span>}
          {(d.pov||links.length>0||d.storyTime)&&<span className="plot-card-chips">{d.pov&&<span className="chip soft"><User size={12}/>{d.pov}</span>}{links.slice(0,2).map(t=><span className="chip soft" key={t}><Link2 size={12}/>{t}</span>)}{links.length>2&&<span className="chip soft">+{links.length-2}</span>}{d.storyTime&&<span className="chip"><Clock3 size={12}/>{d.storyTime}</span>}</span>}
        </button>;})}
        {mode==='part'&&<button type="button" className="board-add" onClick={()=>onCreate(column.key)}><Plus size={14}/>이 부에 문서 추가</button>}
      </section>)}
      {mode==='part'&&<button type="button" className="board-add-part" onClick={()=>onCreate(nextPartLabel(scenes))}><Plus size={15}/>부 추가</button>}
    </div>
  </div>;
}
