'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { emptyAuthorProfile, sameProfile, type PublishedProfile } from '@/lib/author-profile';
import { cloudConfigured, publicAuthorProfile, publishAuthorProfile, unpublishAuthorProfile } from '@/lib/cloud';
import { useStudio } from './studio-provider';

export function AuthorProfilePanel(){
  const id=useId();
  const s=useStudio(),draft=s.state?.authorProfile||emptyAuthorProfile;
  const [published,setPublished]=useState<PublishedProfile|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirming,setConfirming]=useState(false);
  const readonly=!!s.conflict||busy,unchanged=sameProfile(draft,published);
  const confirmBox=useRef<HTMLDivElement>(null);
  const publishedOn=published?` · ${new Date(published.published_at).toLocaleDateString('ko-KR')} 공개`:'';

  useEffect(()=>{let active=true;

    if(!cloudConfigured){setLoading(false);

return;}

    publicAuthorProfile().then(value=>{if(active)setPublished(value);}).catch(()=>{if(active)setError('공개된 소개를 불러오지 못했습니다.');}).finally(()=>{if(active)setLoading(false);});

    return()=>{active=false;};
  },[]);

  // The settings pane scrolls; the confirmation sits below the buttons and must not open off-screen.
  useEffect(()=>{if(confirming)confirmBox.current?.scrollIntoView({block:'nearest'});},[confirming]);

  async function publish(){
    if(readonly||!draft.bio.trim())return;setBusy(true);setError('');

    try{await s.flush();setPublished(await publishAuthorProfile(draft));}
    catch(cause){setError(cause instanceof Error?cause.message:'자기소개를 공개하지 못했습니다.');}
    finally{setBusy(false);}
  }

  async function withdraw(){
    if(readonly)return;setBusy(true);setError('');

    try{await unpublishAuthorProfile();setPublished(null);setConfirming(false);}
    catch(cause){setError(cause instanceof Error?cause.message:'공개를 취소하지 못했습니다.');}
    finally{setBusy(false);}
  }

  return <div className="author-profile-form"><div className="settings-head"><p>초안은 계정에 자동 저장합니다. 공개된 소개는 누구나 볼 수 있습니다. 소개는 마크다운으로 굵게·링크·목록을 쓸 수 있고 HTML은 글자 그대로 보입니다.</p></div>
    <div className="author-profile-field"><label htmlFor={`${id}-name`}>이름 · 필명</label><input id={`${id}-name`} value={draft.name} maxLength={80} disabled={readonly} onChange={e=>{const name=e.target.value;s.update(state=>({...state,authorProfile:{...(state.authorProfile||emptyAuthorProfile),name}}));}}/></div>
    <div className="author-profile-field"><label htmlFor={`${id}-bio`}>소개</label><textarea id={`${id}-bio`} rows={10} value={draft.bio} maxLength={10000} disabled={readonly} onChange={e=>{const bio=e.target.value;s.update(state=>({...state,authorProfile:{...(state.authorProfile||emptyAuthorProfile),bio}}));}}/></div>
    {error&&<p className="error-message" role="alert">{error}</p>}
    <p className="field-help" role="status">{loading?'공개된 소개를 불러오는 중…':published?(unchanged?'공개된 내용과 같습니다':'공개된 소개와 다른 초안입니다')+publishedOn:'공개된 자기소개가 없습니다.'}</p>
    <div className="settings-links"><a className="button" href="/about" target="_blank" rel="noopener noreferrer">자기소개 페이지 보기</a>{published&&<button type="button" className="button danger" aria-expanded={confirming} disabled={readonly||loading||confirming} onClick={()=>setConfirming(true)}>공개 취소</button>}<button type="button" className="button primary" disabled={readonly||loading||!cloudConfigured||!draft.bio.trim()||unchanged} onClick={()=>void publish()}>{busy?'처리 중…':published?'공개 내용 갱신':'자기소개 공개'}</button></div>
    {published&&confirming&&<div ref={confirmBox} className="ai-prompt-confirm" role="group" aria-label="공개 취소 확인"><p>{unchanged?'공개 페이지에서 소개를 내립니다. 초안은 남아 다시 공개할 수 있습니다.':'공개 페이지에서 소개를 내립니다. 초안이 공개된 내용과 달라 지금 공개된 글은 되살릴 수 없습니다.'}</p><button type="button" disabled={readonly} onClick={()=>void withdraw()}>{busy?'처리 중…':'공개 취소'}</button><button type="button" autoFocus disabled={busy} onClick={()=>setConfirming(false)}>그대로 두기</button></div>}
  </div>;
}
