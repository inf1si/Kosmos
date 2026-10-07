'use client';

import { useEffect, useState } from 'react';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { NoteImage } from '@/lib/editor-extensions';
import { cloud, cloudConfigured } from '@/lib/cloud';
import { db } from '@/lib/database';
import { useStudio } from './studio-provider';

/** 노트 본문 이미지. 첨부는 비공개라 이 기기 저장소에서 먼저 찾고, 없으면 사용자 클라우드에서 내려받는다. */
function NoteImageNode({node,selected}:ReactNodeViewProps){
  const s=useStudio(),id=String(node.attrs.assetId||''),alt=String(node.attrs.alt||'');
  const [url,setUrl]=useState(''),[failed,setFailed]=useState(false);
  useEffect(()=>{
    let alive=true,objectUrl='';
    void (async()=>{
      try{
        let blob=(await db.assets.get([s.namespace,id]))?.blob;

        if(!blob&&cloudConfigured){const result=await cloud().storage.from('private-assets').download(`${s.user}/${id}`);

if(result.error)throw result.error;blob=result.data||undefined;

if(blob)await db.assets.put({id,namespace:s.namespace,blob});}

        if(!blob)throw new Error('missing');
        objectUrl=URL.createObjectURL(blob);

if(alive)setUrl(objectUrl);else URL.revokeObjectURL(objectUrl);
      }catch{if(alive)setFailed(true);}
    })();

    return()=>{alive=false;

if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[id,s.namespace,s.user]);

  return <NodeViewWrapper as="figure" className={`note-image ${selected?'is-selected':''}`} data-note-image={id} data-drag-handle="">
    {url?<img src={url} alt={alt}/>:<span className="note-image-state">{failed?`이미지를 불러오지 못했습니다 · ${alt||'이름 없음'}`:'이미지를 불러오는 중입니다.'}</span>}
  </NodeViewWrapper>;
}

export const NoteImageView=NoteImage.extend({addNodeView(){return ReactNodeViewRenderer(NoteImageNode);}});
