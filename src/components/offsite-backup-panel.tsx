'use client';

import { useCallback, useEffect, useState } from 'react';
import { cloud,cloudConfigured } from '@/lib/cloud';
import type { BackupReport } from '@/lib/offsite-backup';
import { backupHealth } from '@/lib/backup-status';
import { verifyBackupRestore } from '@/lib/backup-restore-check';
import type { TransferDownload } from '@/lib/interchange';
import { useStudio } from './studio-provider';
import { DownloadLink } from './download-link';

export function OffsiteBackupPanel({open}:{open:boolean}){
  const s=useStudio();
  const [configured,setConfigured]=useState(false),[report,setReport]=useState<BackupReport|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[checked,setChecked]=useState(false);
  const [download,setDownload]=useState<TransferDownload|null>(null),[restoreResult,setRestoreResult]=useState(''),[monitorConfigured,setMonitorConfigured]=useState(false);

  const authHeaders=useCallback(async()=>{const session=await cloud().auth.getSession();

return{Authorization:`Bearer ${session.data.session?.access_token||''}`};},[]);

  const refresh=useCallback(async()=>{try{const response=await fetch('/api/backup/status',{headers:await authHeaders()});const result=await response.json();

if(!response.ok)throw new Error(result.error);setConfigured(result.configured);setMonitorConfigured(result.monitorConfigured);setReport(result.report);setChecked(true);setError('');}catch(e){setError(e instanceof Error?e.message:'백업 상태를 확인하지 못했습니다.');}},[authHeaders]);

  useEffect(()=>{if(open&&cloudConfigured&&s.user)void refresh();},[open,s.user,refresh]);
  useEffect(()=>{if(!open){setDownload(null);setRestoreResult('');}},[open]);

  async function run(task:()=>Promise<void>){setBusy(true);setError('');

try{await task();}catch(e){setError(e instanceof Error?e.message:'백업 작업을 완료하지 못했습니다.');}finally{setBusy(false);}}

  async function loadArchive(){const response=await fetch('/api/backup/download',{headers:await authHeaders()});

if(!response.ok){const result=await response.json();throw new Error(result.error);}

const file={name:'orbis-tertius-cloud-backup.zip',blob:await response.blob()};setDownload(file);

return file;}

  if(!cloudConfigured)return null;

  return <section className="backup-explanation"><h3>별도 클라우드 자동 백업</h3>{configured?<>
    <p>매일 오전 4시대 · 원고·이력·첨부</p>
    {report?<p>마지막 정상 백업: {new Date(report.completedAt).toLocaleString('ko-KR')}<br/>{report.documents}개 문서 · {report.revisions}개 이력 · {report.assets}개 첨부 · {(report.bytes/1024/1024).toFixed(2)}MB</p>:<p>정상 백업 기록이 없습니다.</p>}
    {backupHealth(report)==='overdue'&&<p className="error-message" role="alert">백업이 36시간 이상 지연되었거나 백업 시각이 잘못되었습니다. 다시 실행하세요.</p>}
    {!monitorConfigured&&<p>실행 누락 알림 미연결</p>}
    <div className="modal-actions">
      <button className="button" disabled={busy} onClick={()=>void run(async()=>{setRestoreResult('');setDownload(null);await s.flush();await s.syncNow();const response=await fetch('/api/backup/run',{method:'POST',headers:await authHeaders()});const result=await response.json();

if(!response.ok)throw new Error(result.error);setReport(result.report);})}>{busy?'백업 작업 중…':'지금 클라우드 백업'}</button>
      <button className="button" disabled={busy||!report?.archiveKey} onClick={()=>void run(async()=>{await loadArchive();})}>저장된 백업 내려받기</button>
      <button className="button" disabled={busy||!report?.archiveKey} onClick={()=>void run(async()=>{setRestoreResult('');const file=await loadArchive();const result=await verifyBackupRestore(file.blob);setRestoreResult(`복원 시험 완료 · 작품 ${result.works}개 · 문서 ${result.documents}개 · 노트 ${result.notes}개 · 이력 ${result.revisions}개 · 첨부 ${result.assets}개`);})}>저장된 백업 복원 시험</button>
    </div>
    {report&&!report.archiveKey&&<p>새 백업을 만들면 내려받기·복원 시험을 사용할 수 있습니다.</p>}
    <DownloadLink file={open?download:null}/>{restoreResult&&<p className="success-message" role="status">{restoreResult}</p>}

  </>:<p>{checked?'별도 저장소는 연결하지 않았습니다.':'백업 연결 상태 확인 중…'}</p>}{error&&<p className="error-message" role="alert">{error}</p>}</section>;
}
