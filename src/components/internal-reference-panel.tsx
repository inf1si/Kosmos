'use client';

import { useMemo,type CSSProperties } from 'react';
import { ArrowLeft,FileText,StickyNote } from 'lucide-react';
import { plainText } from '@/lib/model';
import { referenceConnections,referenceKey,referenceTargets,type ReferenceTarget } from '@/lib/internal-references';
import type { InternalReference } from '@/lib/internal-reference-node';
import { useStudio } from './studio-provider';
import { IconButton } from './primitives';

export function InternalReferencePanel({sourceId,preview,onPreview,onOpen,showEmpty=true}:{sourceId:string;preview:InternalReference|null;onPreview:(ref:InternalReference|null)=>void;onOpen:(target:ReferenceTarget)=>void;showEmpty?:boolean}){
  const state=useStudio().state,targets=useMemo(()=>state?referenceTargets(state):[],[state]),connections=useMemo(()=>referenceConnections(targets,sourceId),[targets,sourceId]);
  const target=preview?targets.find(target=>referenceKey(target)===referenceKey(preview)):undefined;

  if(preview)return <div className="internal-reference-preview"><div className="notes-reference-bar"><IconButton label="참조 목록으로" onClick={()=>onPreview(null)}><ArrowLeft size={15}/></IconButton><span>{target?.category||'참조'}</span>{target&&<button type="button" className="button" onClick={()=>onOpen(target)}>원문 열기</button>}</div><h3>{target?.label||preview.label||'제목 없음'}</h3>{target?<><p className="muted">{target.path}</p><div className="notes-reference-body">{plainText(target.content).slice(0,12000).split('\n').filter(line=>line.trim()).map((line,i)=><p key={i}>{line}</p>)}</div></>:<p className="muted">참조 대상을 찾을 수 없습니다.</p>}</div>;

  return <>{connections.outgoing.length>0&&<><h3>참조한 글 {connections.outgoing.length}개</h3>{connections.outgoing.map(ref=><ReferenceCard key={referenceKey(ref)} target={ref} onPreview={onPreview}/>)}</>}{connections.incoming.length>0&&<><h3>이 글을 참조한 글 {connections.incoming.length}개</h3>{connections.incoming.map(ref=><ReferenceCard key={referenceKey(ref)} target={ref} onPreview={onPreview}/>)}</>}{showEmpty&&!connections.outgoing.length&&!connections.incoming.length&&<p className="muted">연결된 글이 없습니다.</p>}</>;
}

function ReferenceCard({target,onPreview}:{target:InternalReference|ReferenceTarget;onPreview:(ref:InternalReference)=>void}){
  const available='path' in target;

  return <button type="button" className="reference-card" onClick={()=>onPreview(target)}>{target.kind==='note'?<StickyNote size={14}/>:<FileText size={14}/>}<span><strong>{target.label||'제목 없음'}</strong><small>{available?target.path:'사용 불가'}</small></span></button>;
}

export function InternalReferenceHover({reference,style,onStay,onLeave,onPreview}:{reference:InternalReference;style:CSSProperties;onStay:()=>void;onLeave:()=>void;onPreview:()=>void}){
  const state=useStudio().state,targets=useMemo(()=>state?referenceTargets(state):[],[state]);
  const target=targets.find(target=>referenceKey(target)===referenceKey(reference));
  const snippet=target?plainText(target.content).trim().slice(0,160):'';

  return <div className="wiki-preview" role="dialog" aria-label="참조 미리보기" style={style} onMouseEnter={onStay} onMouseLeave={onLeave}><span>{target?.category||'참조'}{target&&` · ${target.path}`}</span><strong>{target?.label||reference.label||'제목 없음'}</strong><span>{target?snippet:'참조 대상을 찾을 수 없습니다.'}</span><footer><button type="button" onClick={onPreview}>미리보기</button></footer></div>;
}
