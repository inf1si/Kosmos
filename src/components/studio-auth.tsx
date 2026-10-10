'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LogOut, User } from 'lucide-react';
import { cloud,cloudConfigured } from '@/lib/cloud';
import { startGoogleAuth,googleAuthClient } from '@/lib/google-auth';
import { useStudio } from './studio-provider';
import { IconButton,Popover } from './primitives';

async function googleEnabled(){
  const response=await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`,{headers:{apikey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!},cache:'no-store'});

  if(!response.ok)throw new Error('로그인 설정을 확인하지 못했습니다. 잠시 후 다시 시도하세요.');

  return (await response.json()).external?.google===true;
}

async function redirectToGoogle(mode:'login'|'link'){
  const url=await startGoogleAuth(googleAuthClient(cloud()),mode,window.location.origin,sessionStorage,googleEnabled);
  window.location.assign(url);
}

export function Login(){
  const s=useStudio();const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  useEffect(()=>{
    const url=new URL(window.location.href);

    if(url.searchParams.has('auth_error')){
      setError('Google 인증을 완료하지 못했습니다. 기존 이메일로 로그인한 뒤 계정 연결을 확인하세요.');
      url.searchParams.delete('auth_error');history.replaceState(null,'',url.pathname+url.search);
    }
  },[]);

  async function run(action:()=>Promise<void>){setBusy(true);setError('');

try{await action();}catch(e){setError(e instanceof Error?e.message:'로그인하지 못했습니다.');setBusy(false);}}

  return <div className="login-screen"><span className="login-mark" aria-hidden="true">◌</span><h1>Orbis Tertius 집필실</h1>{cloudConfigured?<>
    <button type="button" className="button login-google" disabled={busy} onClick={()=>void run(()=>redirectToGoogle('login'))}>Google로 로그인</button>
    <p className="login-help">Google 첫 연결은 이메일 로그인 후 계정 메뉴에서 합니다.</p>
    <form onSubmit={e=>{e.preventDefault();void run(async()=>{await s.login(email,password);setBusy(false);});}}><label>이메일<input type="email" autoComplete="username" required disabled={busy} value={email} onChange={e=>setEmail(e.target.value)}/></label><label>비밀번호<input type="password" autoComplete="current-password" required disabled={busy} value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="primary" disabled={busy}>집필실 열기</button></form>
    {(error||s.error)&&<p className="error-message login-help" role="alert">{error||s.error}</p>}
  </>:<p>작가용 클라우드 연결을 설정한 뒤 이용할 수 있습니다.</p>}<Link href="/library">공개 서재</Link></div>;
}

export function GoogleAccountControl(){
  const s=useStudio();const [open,setOpen]=useState(false);const [linked,setLinked]=useState<boolean|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState<'link'|'logout'|null>(null);
  useEffect(()=>{
    if(!open)return;let disposed=false;setError('');setLinked(null);
    void cloud().auth.getUser().then(({data,error})=>{if(disposed)return;

if(error)setError('계정 정보를 확인하지 못했습니다.');else setLinked(!!data.user?.identities?.some(i=>i.provider==='google'));});

    return()=>{disposed=true;};
  },[open]);

  if(!cloudConfigured||!s.user)return null;

  async function connect(){setBusy('link');setError('');

try{await s.flush();await s.syncNow();await redirectToGoogle('link');}catch(e){setError(e instanceof Error?e.message:'계정을 연결하지 못했습니다.');setBusy(null);}}

  async function logout(){setBusy('logout');setError('');

try{await s.logout();}catch(e){setError(e instanceof Error?e.message:'로그아웃하지 못했습니다. 다시 시도하세요.');setBusy(null);}}

  return <Popover open={open} onOpenChange={setOpen} title="로그인 계정" width={300} align="end" trigger={<IconButton label="로그인 계정"><User size={16}/></IconButton>}>
    <div className="account-login"><p>{linked===null?'연결 상태 확인 중':linked?'Google 연결됨':'Google 미연결'}</p>
      {linked===false&&<><button type="button" className="button" disabled={!!busy||!!s.conflict} onClick={()=>void connect()}>{busy==='link'?'연결 중…':'Google 계정 연결'}</button></>}
      <button type="button" className="button" disabled={!!busy} onClick={()=>void logout()}><LogOut size={15}/>{busy==='logout'?'로그아웃 중…':'로그아웃'}</button>
      {error&&<p className="error-message" role="alert">{error}</p>}
    </div>
  </Popover>;
}
