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
  const authHeaders=useCallback(async()=>{const session=await cloud().auth.getSession();return{Authorization:`Bearer ${session.data.session?.access_token||''}`};},[]);
  const refresh=useCallback(async()=>{try{const response=await fetch('/api/backup/status',{headers:await authHeaders()});const result=await response.json();if(!response.ok)throw new Error(result.error);setConfigured(result.configured);setMonitorConfigured(result.monitorConfigured);setReport(result.report);setChecked(true);setError('');}catch(e){setError(e instanceof Error?e.message:'백업 상태를 확인하지 못했습니다.');}},[authHeaders]);
  useEffect(()=>{if(open&&cloudConfigured&&s.user)void refresh();},[open,s.user,refresh]);
  useEffect(()=>{if(!open){setDownload(null);setRestoreResult('');}},[open]);
  async function run(task:()=>Promise<void>){setBusy(true);setError('');try{await task();}catch(e){setError(e instanceof Error?e.message:'백업 작업을 완료하지 못했습니다.');}finally{setBusy(false);}}
  async function loadArchive(){const response=await fetch('/api/backup/download',{headers:await authHeaders()});if(!response.ok){const result=await response.json();throw new Error(result.error);}const file={name:'orbis-tertius-cloud-backup.zip',blob:await response.blob()};setDownload(file);return file;}
  if(!cloudConfigured)return null;
  return <section className="backup-explanation"><h3>별도 클라우드 자동 백업</h3>{configured?<>
    <p>매일 오전 4시대에 클라우드 원고·서버 이력·첨부를 백업합니다.</p>
    {report?<p>마지막 정상 백업: {new Date(report.completedAt).toLocaleString('ko-KR')}<br/>{report.documents}개 문서 · {report.revisions}개 이력 · {report.assets}개 첨부 · {(report.bytes/1024/1024).toFixed(2)}MB · 저장 후 무결성 확인 완료</p>:<p>아직 정상 백업 기록이 없습니다.</p>}
    {backupHealth(report)==='overdue'&&<p className="error-message" role="alert">마지막 정상 백업 후 36시간이 지났거나 백업 시각이 올바르지 않습니다. 연결 상태를 확인하고 백업을 다시 실행하세요.</p>}
    <p>{monitorConfigured?'예약 백업은 외부 감시 서비스에 실행 결과를 보냅니다. 감시 서비스의 알림 연결도 확인하세요.':'실행 누락 알림은 아직 연결하지 않았습니다.'}</p>
    <div className="modal-actions">
      <button className="button" disabled={busy} onClick={()=>void run(async()=>{setRestoreResult('');setDownload(null);await s.flush();await s.syncNow();const response=await fetch('/api/backup/run',{method:'POST',headers:await authHeaders()});const result=await response.json();if(!response.ok)throw new Error(result.error);setReport(result.report);})}>{busy?'백업 작업 중…':'지금 클라우드 백업'}</button>
      <button className="button" disabled={busy||!report?.archiveKey} onClick={()=>void run(async()=>{await loadArchive();})}>저장된 백업 내려받기</button>
      <button className="button" disabled={busy||!report?.archiveKey} onClick={()=>void run(async()=>{setRestoreResult('');const file=await loadArchive();const result=await verifyBackupRestore(file.blob);setRestoreResult(`기기 저장소 복원 시험 완료: ${result.works}개 작품 · ${result.documents}개 문서 · ${result.notes}개 개인 노트 · ${result.revisions}개 이력 · ${result.assets}개 첨부. 별도 시험 공간에 복원해 다시 읽고 비교했습니다. 현재 원고는 유지됩니다.`);})}>저장된 백업 복원 시험</button>
    </div>
    {report&&!report.archiveKey&&<p>백업을 한 번 새로 만들면 내려받기와 복원 시험을 사용할 수 있습니다.</p>}
    <DownloadLink file={open?download:null}/>{restoreResult&&<p className="success-message" role="status">{restoreResult}</p>}
    <p>기기에만 남은 수정은 작업 공간 전체 ZIP에도 보관하세요. 위 복원 시험은 앱 데이터와 첨부 검사이며 DB·로그인·권한의 복원 훈련은 별도로 진행합니다.</p>
  </>:<p>{checked?'별도 저장소는 아직 연결하지 않았습니다.':'백업 연결 상태 확인 중…'}</p>}{error&&<p className="error-message" role="alert">{error}</p>}</section>;
}
