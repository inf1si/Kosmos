'use client';

import { useMemo,useRef,useState,type CSSProperties } from 'react';
import { ArrowLeft } from 'lucide-react';
import { plainText } from '@/lib/model';
import { referenceBacklinks,referenceChildren,referenceConnections,referenceKey,referencePlace,referenceSnippet,referenceTargets,type ReferenceTarget } from '@/lib/internal-references';
import type { InternalReference } from '@/lib/internal-reference-node';
import { useStudio } from './studio-provider';
import { IconButton } from './primitives';
import { ReferenceIcon } from './internal-reference-icon';

export function InternalReferencePanel({sourceId,preview,onPreview,onOpen,showEmpty=true}:{sourceId:string;preview:InternalReference|null;onPreview:(ref:InternalReference|null)=>void;onOpen:(target:ReferenceTarget)=>void;showEmpty?:boolean}){
  const state=useStudio().state,targets=useMemo(()=>state?referenceTargets(state):[],[state]),connections=useMemo(()=>referenceConnections(targets,sourceId),[targets,sourceId]);

  if(preview)return <ReferencePreview key={referenceKey(preview)} reference={preview} targets={targets} onClose={()=>onPreview(null)} onOpen={onOpen}/>;
  const hasMentions=connections.outgoing.some(ref=>ref.kind!=='note'&&ref.kind!=='document');

  return <>{connections.outgoing.length>0&&<><h3>{hasMentions?'참조한 항목':'참조한 글'} {connections.outgoing.length}개</h3>{connections.outgoing.map(ref=><ReferenceCard key={referenceKey(ref)} target={ref} onPreview={onPreview}/>)}</>}{connections.incoming.length>0&&<><h3>이 글을 참조한 글 {connections.incoming.length}개</h3>{connections.incoming.map(ref=><ReferenceCard key={referenceKey(ref)} target={ref} onPreview={onPreview}/>)}</>}{showEmpty&&!connections.outgoing.length&&!connections.incoming.length&&<p className="muted">연결된 항목이 없습니다.</p>}</>;
}

function ReferencePreview({reference,targets,onClose,onOpen}:{reference:InternalReference;targets:ReferenceTarget[];onClose:()=>void;onOpen:(target:ReferenceTarget)=>void}){
  const [navigation,setNavigation]=useState({root:reference,trail:[reference]}),bar=useRef<HTMLDivElement>(null);

  if(navigation.root!==reference)setNavigation({root:reference,trail:[reference]});
  const trail=navigation.root===reference?navigation.trail:[reference],current=trail.at(-1)!;
  const target=targets.find(target=>referenceKey(target)===referenceKey(current)),children=target?referenceChildren(targets,target):[],backlinks=target&&!target.content?referenceBacklinks(targets,target):[];
  const navigate=(ref:InternalReference)=>{setNavigation(previous=>({...previous,trail:[...previous.trail,ref]}));bar.current?.querySelector<HTMLButtonElement>('button')?.focus();};

  const back=()=>{if(trail.length>1)setNavigation(previous=>({...previous,trail:previous.trail.slice(0,-1)}));else onClose();};

  return <div className="notes-reference internal-reference-preview"><div ref={bar} className="notes-reference-bar"><IconButton label={trail.length>1?'이전 참조로':'참조 목록으로'} onClick={back}><ArrowLeft size={15}/></IconButton><span>{target?.category||'참조'}</span>{target?.content&&<button type="button" className="button" onClick={()=>onOpen(target)}>원문 열기</button>}</div><h3 className="notes-reference-title">{target?.label||current.label||'제목 없음'}</h3>{target?<><p className="muted">{target.path}</p>{target.content&&<div className="notes-reference-body">{plainText(target.content).slice(0,12000).split('\n').filter(line=>line.trim()).map((line,i)=><p key={i}>{line}</p>)}</div>}{children.length>0?<><h3>항목 {children.length}개</h3>{children.map(child=><ReferenceCard key={referenceKey(child)} target={child} onPreview={navigate}/>)}</>:!target.content&&<p className="muted">항목이 없습니다.</p>}{backlinks.length>0&&<><h3>이 항목을 참조한 글 {backlinks.length}개</h3>{backlinks.map(ref=><ReferenceCard key={referenceKey(ref)} target={ref} onPreview={navigate}/>)}</>}</>:<p className="muted">참조 대상을 찾을 수 없습니다.</p>}</div>;
}

function ReferenceCard({target,onPreview}:{target:InternalReference|ReferenceTarget;onPreview:(ref:InternalReference)=>void}){
  const available='path' in target;

  return <button type="button" className="reference-card" onClick={()=>onPreview(target)}><ReferenceIcon kind={target.kind}/><span><strong>{target.label||'제목 없음'}</strong><small>{available?referencePlace(target):'사용 불가'}</small></span></button>;
}

export function InternalReferenceHover({reference,style,onStay,onLeave,onPreview}:{reference:InternalReference;style:CSSProperties;onStay:()=>void;onLeave:()=>void;onPreview:()=>void}){
  const state=useStudio().state,targets=useMemo(()=>state?referenceTargets(state):[],[state]);
  const target=targets.find(target=>referenceKey(target)===referenceKey(reference));
  const snippet=target?referenceSnippet(targets,target):'';

  return <div className="wiki-preview" role="dialog" aria-label="참조 미리보기" style={style} onMouseEnter={onStay} onMouseLeave={onLeave}><span>{target?referencePlace(target):'참조'}</span><strong>{target?.label||reference.label||'제목 없음'}</strong><span>{target?snippet:'참조 대상을 찾을 수 없습니다.'}</span><footer><button type="button" onClick={onPreview}>{target&&!target.content?'목록 보기':'미리보기'}</button></footer></div>;
}
