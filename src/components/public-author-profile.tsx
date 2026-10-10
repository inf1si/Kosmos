'use client';

import { useEffect, useState } from 'react';
import type { PublishedProfile } from '@/lib/author-profile';
import { renderProfileMarkdown } from '@/lib/profile-markdown';
import { cloudConfigured, publicAuthorProfile } from '@/lib/cloud';
import styles from '@/app/public-info.module.css';

export function PublicAuthorProfile({initial,error:initialError}:{initial:PublishedProfile|null;error:string}){
  const [profile,setProfile]=useState(initial),[error,setError]=useState(initialError);
  useEffect(()=>{let active=true;

    if(!cloudConfigured)return;
    publicAuthorProfile().then(value=>{if(active){setProfile(value);setError('');}}).catch(()=>{if(active)setError('자기소개를 불러오지 못했습니다. 잠시 뒤 다시 열어주세요.');});

    return()=>{active=false;};
  },[]);

  return <>{error?<p className={styles.documentLead} role="alert">{error}</p>:profile?<section aria-label="개인 소개">{profile.name&&<h2>{profile.name}</h2>}<div className={styles.bio} dangerouslySetInnerHTML={{__html:renderProfileMarkdown(profile.bio)}}/></section>:<p className={styles.documentLead}>자기소개를 등록하지 않았습니다.</p>}</>;
}
