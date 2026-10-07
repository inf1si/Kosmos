'use client';

import { useEffect,useRef,useState } from 'react';
import Link from 'next/link';
import { cloud } from '@/lib/cloud';
import { GOOGLE_AUTH_PENDING,validateGoogleReturn,googleAuthIntentSchema } from '@/lib/google-auth';

export default function AuthCallback(){
  const started=useRef(false);const [error,setError]=useState('');
  useEffect(()=>{
    if(started.current)return;started.current=true;

    async function finish(){
      try{
        const url=new URL(location.href);

        if(url.searchParams.has('error')||new URLSearchParams(url.hash.slice(1)).has('error'))throw new Error('Google 인증이 취소되었거나 실패했습니다. 기존 로그인으로 다시 시도하세요.');
        const raw=sessionStorage.getItem(GOOGLE_AUTH_PENDING);

        if(!raw)throw new Error('인증을 시작한 브라우저에서 다시 시도하세요.');
        // Supabase's PKCE initializer exchanges the code before getSession resolves.
        const session=await cloud().auth.getSession();
        history.replaceState(null,'','/auth/callback');

        if(session.error||!session.data.session)throw new Error('Google 인증 세션을 확인하지 못했습니다. 다시 시도하세요.');
        const {data,error}=await cloud().auth.getUser();

        if(error||!data.user)throw new Error('Google 인증 세션을 확인하지 못했습니다.');

        try{validateGoogleReturn(googleAuthIntentSchema.parse(JSON.parse(raw)),data.user);}
        catch(error){await cloud().auth.signOut({scope:'local'});throw error;}

        const author=await cloud().from('authors').select('user_id').eq('user_id',data.user.id).maybeSingle();

        if(author.error||!author.data){await cloud().auth.signOut({scope:'local'});throw new Error('이 Google 계정에는 집필실 권한이 없습니다. 기존 이메일로 로그인한 뒤 Google 계정을 연결하세요.');}

        sessionStorage.removeItem(GOOGLE_AUTH_PENDING);
        location.replace('/studio');
      }catch(e){
        history.replaceState(null,'','/auth/callback');sessionStorage.removeItem(GOOGLE_AUTH_PENDING);
        setError(e instanceof Error?e.message:'Google 인증을 완료하지 못했습니다.');
      }
    }

    void finish();
  },[]);

  return <div className="login-screen"><h1>집필실 로그인</h1>{error?<><p className="error-message login-help" role="alert">{error}</p><Link className="button" href="/studio">집필실로 돌아가기</Link></>:<p role="status">Google 인증을 확인하고 있습니다.</p>}</div>;
}
