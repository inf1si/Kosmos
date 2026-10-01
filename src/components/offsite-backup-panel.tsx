'use client';
import { useCallback, useEffect, useState } from 'react';
import { cloud,cloudConfigured } from '@/lib/cloud';
import { useStudio } from './studio-provider';
type Report={completedAt:string;version:number;bytes:number;documents:number;revisions:number;assets:number;verified:true};
export function OffsiteBackupPanel({open}:{open:boolean}){
  const s=useStudio();const [configured,setConfigured]=useState(false),[report,setReport]=useState<Report|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[checked,setChecked]=useState(false);
  const refresh=useCallback(async()=>{try{const session=await cloud().auth.getSession();const response=await fetch('/api/backup/status',{headers:{Authorization:`Bearer ${session.data.session?.access_token||''}`}});const result=await response.json();if(!response.ok)throw new Error(result.error);setConfigured(result.configured);setReport(result.report);setChecked(true);setError('');}catch(e){setError(e instanceof Error?e.message:'백업 상태를 확인하지 못했습니다.');}},[]);
  useEffect(()=>{if(open&&cloudConfigured&&s.user)void refresh();},[open,s.user,refresh]);
  if(!cloudConfigured)return null;
  return <section className="backup-explanation"><h3>별도 클라우드 자동 백업</h3>{configured?<><p>매일 오전 4시대에 원고·서버 이력·첨부를 별도 저장소에 보관합니다.</p>{report?<p>마지막 정상 백업: {new Date(report.completedAt).toLocaleString('ko-KR')}<br/>{report.documents}개 문서 · {report.assets}개 첨부 · {(report.bytes/1024/1024).toFixed(2)}MB · 저장 후 무결성 확인 완료</p>:<p>아직 정상 백업 기록이 없습니다.</p>}<button className="button" disabled={busy} onClick={()=>{setBusy(true);setError('');void(async()=>{try{await s.flush();await s.syncNow();const session=await cloud().auth.getSession();const response=await fetch('/api/backup/run',{method:'POST',headers:{Authorization:`Bearer ${session.data.session?.access_token||''}`}});const result=await response.json();if(!response.ok)throw new Error(result.error);setReport(result.report);}catch(e){setError(e instanceof Error?e.message:'백업을 완료하지 못했습니다.');}finally{setBusy(false);}})();}}>{busy?'외부 백업 중…':'지금 클라우드 백업'}</button><p>클라우드 동기화가 끝난 원고를 보관합니다. 기기에만 남은 수정은 전체 ZIP으로 함께 보관하세요.</p></>:<p>{checked?'별도 저장소는 아직 연결하지 않았습니다. 연결 후 하루 한 번 자동 백업과 저장 파일 검증을 실행합니다.':'백업 연결 상태 확인 중…'}</p>}{error&&<p className="error-message" role="alert">{error}</p>}</section>;
}
