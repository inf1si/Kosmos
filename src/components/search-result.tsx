'use client';

import {Fragment} from 'react';
import {StickyNote} from 'lucide-react';
import {bodyMatchCount,textRanges,type WorkspaceSearchHit} from '@/lib/workspace-search';
import {referencePlace} from '@/lib/internal-references';
import {DocIcon} from './studio-icons';

/** The same title, path, matching excerpt and count in workspace and notes search. */
export function SearchResultContent({hit,terms}:{hit:WorkspaceSearchHit;terms:string[]}){
  const target=hit.document,count=bodyMatchCount(target.content,terms);

  return <>{target.kind==='note'?<StickyNote size={15}/>:<DocIcon doc={{kind:target.docKind,category:target.docCategory}} size={15}/>}<span><strong title={target.label}><SearchHighlight text={target.label} terms={terms}/></strong><small title={target.path}><SearchHighlight text={referencePlace(target)} terms={terms}/></small>{hit.snippet&&<p className="workspace-search-snippet"><SearchHighlight text={hit.snippet} terms={terms}/></p>}</span>{count>0&&<small className="workspace-search-count" aria-label={`본문 ${count}곳 일치`}>{count}곳</small>}</>;
}

function SearchHighlight({text,terms}:{text:string;terms:string[]}){
  const ranges=textRanges(text,terms);let cursor=0;

  const parts=ranges.map(range=>{const before=text.slice(cursor,range.from);cursor=range.to;

return <Fragment key={range.from}>{before}<mark className="editor-search-match">{text.slice(range.from,range.to)}</mark></Fragment>;});

  return <>{parts}{text.slice(cursor)}</>;
}
