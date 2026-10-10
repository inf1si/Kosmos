'use client';

import { documentTitle } from '@/lib/model';

import { z } from 'zod';
import { workSchema } from '@/lib/model';
import { countChars } from '@/lib/outline';
import { defaultSections } from '@/lib/document-navigation';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Archive, Download, History, Upload, Check, BookOpen } from 'lucide-react';
import { useStudio } from './studio-provider';
import { Modal } from './primitives';
import { Revision, Work, PersonalNote, newDocument, uid, plainText } from '@/lib/model';
import { readBackup } from '@/lib/backup';
import { cloudConfigured } from '@/lib/cloud';
import { InterchangeDialog } from './interchange-dialog';
import { DownloadLink } from './download-link';
import type { TransferDownload } from '@/lib/interchange';
import { TrashDialog } from './trash-dialog';
import { OffsiteBackupPanel } from './offsite-backup-panel';
import { SettingsDialog, sections } from './settings-dialog';
import { DEFAULT_WORK_SHELF, moveWorkToShelf, shelfForWork, workShelves, workShelfTitle } from '@/lib/work-shelves';

export function StudioDialogs({workId}:{workId:string}){
  const trashFocus=useRef<HTMLElement|null>(null);const s=useStudio();const [open,setOpen]=useState<string|null>(null);const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [error,setError]=useState('');
  const [history,setHistory]=useState<Revision[]>([]);const [restoreId,setRestoreId]=useState<string|null>(null);
  const [file,setFile]=useState<File|null>(null);const [importInfo,setImportInfo]=useState('');const [selected,setSelected]=useState<string[]>([]);const [published,setPublished]=useState(false);
  const [title,setTitle]=useState('');const [form,setForm]=useState<Work['form']>('장편');
  const [newShelf,setNewShelf]=useState(DEFAULT_WORK_SHELF);
  const [download,setDownload]=useState<TransferDownload|null>(null);
  const [emergencyDownload,setEmergencyDownload]=useState<TransferDownload|null>(null);
  useEffect(()=>{setEmergencyDownload(null);},[s.conflict]);
  const work=s.state?.works.find(w=>w.id===workId);
  useEffect(()=>{const listener=(event:Event)=>{if(!(event instanceof CustomEvent))return;const parsed=z.string().safeParse(event.detail);

if(!parsed.success)return;const value=parsed.data;

if(value==='trash'||String(value).startsWith('settings'))trashFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setOpen(value);setMessage('');setError('');setPublished(false);setFile(null);setImportInfo('');setRestoreId(null);

if(value==='backup')void s.revisions().then(setHistory);

// An empty draft (a new or replacement document) stays unchecked so it is not published by default.
if(value==='publish')setSelected(work?.documents.filter(d=>d.kind==='scene'&&plainText(d.content).trim()).map(d=>d.id)||[]);

if(value==='new-work'||value.startsWith('new-work:')){setOpen('new-work');setTitle('');const shelfId=value.slice('new-work:'.length);

setNewShelf(s.state&&workShelves(s.state).some(shelf=>shelf.id===shelfId)?shelfId:s.state?shelfForWork(s.state,workId):DEFAULT_WORK_SHELF);}};

window.addEventListener('studio-modal',listener);

return()=>window.removeEventListener('studio-modal',listener);},[s,work]);

  async function run(fn:()=>Promise<void>){setBusy(true);setError('');

try{await fn();}catch(e){setError(e instanceof Error?e.message:'작업을 완료하지 못했습니다.');}finally{setBusy(false);}}

  return <><InterchangeDialog workId={workId}/><SettingsDialog open={!!open?.startsWith('settings')} section={sections.find(section=>section.id===open?.split(':')[1])?.id} onClose={()=>setOpen(null)} onReturnFocus={()=>trashFocus.current?.isConnected&&trashFocus.current.focus()}/><TrashDialog open={open==='trash'} onClose={()=>setOpen(null)} onReturnFocus={()=>trashFocus.current?.isConnected&&trashFocus.current.focus()}/>
    <Modal open={open==='backup'} onClose={()=>{if(!busy)setOpen(null);}} title="백업과 복구" wide>
      <div className="backup-overview"><Archive size={25}/><div><strong>작업 공간 전체 ZIP 백업</strong><p>마지막 파일 생성: {s.lastExportAt?new Date(s.lastExportAt).toLocaleString('ko-KR'):'아직 없음'}</p></div><button className="primary" disabled={busy} onClick={()=>void run(async()=>{setDownload(null);setDownload(await s.exportBackup());setMessage('백업 파일을 만들었습니다.');})}><Download size={16}/>백업 내려받기</button></div><DownloadLink file={open==='backup'?download:null}/>
      <div className="backup-columns"><section><h3><History size={17}/>복구 이력</h3><button className="button" disabled={busy} onClick={()=>void run(async()=>{await s.snapshot('수동 복구 지점');setHistory(await s.revisions());setMessage('현재 원고를 보관했습니다.');})}>지금 복구 지점 만들기</button><div className="revision-list">{history.map(r=><button key={r.id} className={restoreId===r.id?'selected':''} onClick={()=>setRestoreId(r.id)}><span>{r.label}</span><small>{new Date(r.createdAt).toLocaleString('ko-KR')}</small></button>)}</div>{restoreId&&<div className="restore-choice"><p>작업 공간 전체를 선택한 시점으로 되돌립니다.</p><button className="button" disabled={busy} onClick={()=>void run(async()=>{await s.restore(history.find(r=>r.id===restoreId)!.data);setHistory(await s.revisions());setRestoreId(null);setMessage('이전 원고를 새 작업본으로 복원했습니다.');})}>선택한 원고 복원</button></div>}</section>
        <section><h3><Upload size={17}/>백업 파일 복원</h3><label className="backup-upload">ZIP 파일 선택<input aria-label="백업 ZIP 파일" type="file" accept=".zip,application/zip" disabled={busy} onChange={e=>{const chosen=e.target.files?.[0];

if(!chosen)return;void run(async()=>{const parsed=await readBackup(chosen);setFile(chosen);setImportInfo(`${parsed.data.works.length}개 작품 · ${parsed.data.works.reduce((n,w)=>n+w.documents.length,0)}개 문서 · ${parsed.data.notes?.length||0}개 개인 노트 · ${parsed.assets.length}개 첨부`);setMessage('파일의 무결성을 확인했습니다.');});}}/></label>{file&&<div className="restore-choice"><strong>{file.name}</strong><p>{importInfo}</p><p>작업 공간 전체를 이 백업으로 바꿉니다.</p><button className="primary" disabled={busy} onClick={()=>void run(async()=>{await s.importBackup(file);setFile(null);setHistory(await s.revisions());setMessage('원고와 첨부를 복원했습니다.');})}>백업 복원</button></div>}</section></div>
      <OffsiteBackupPanel open={open==='backup'}/>{message&&<p className="success-message" role="status"><Check size={15}/>{message}</p>}{error&&<p className="error-message" role="alert">{error}</p>}
    </Modal>
    <Modal open={open==='publish'} onClose={()=>{if(!busy)setOpen(null);}} title="공개 판본 만들기" description="선택한 원고와 각주를 공개합니다. 이후 수정은 다시 게시해야 반영됩니다." wide>
      {work&&<><div className="publish-heading"><BookOpen size={25}/><div><strong>{work.title}</strong><p>{cloudConfigured?'공개 서재에 게시':'현재 기기의 공개 화면 미리보기에 게시'}</p></div></div><div className="publish-scene-list">{work.documents.filter(d=>d.kind==='scene').map(d=><label className="publish-scene" key={d.id}><input type="checkbox" checked={selected.includes(d.id)} onChange={e=>setSelected(list=>e.target.checked?[...list,d.id]:list.filter(id=>id!==d.id))}/><div><strong>{documentTitle(d)}</strong><p>{d.summary||plainText(d.content).slice(0,70)}</p></div><span>{countChars(d).toLocaleString()}자</span></label>)}</div><div className="publish-summary"><strong>함께 공개되는 설정 설명</strong><p>{work.documents.filter(d=>d.kind==='wiki'&&d.isPublic&&d.publicSummary.trim()).map(documentTitle).join(' · ')||'없음'}</p><small>설정집의 집필용 본문은 공개 판본에 포함되지 않습니다.</small></div>{published?<div className="success-message"><Check size={17}/>새 공개 판본을 만들었습니다.<Link href={`/read/${work.id}`}>독서 화면 열기</Link></div>:<div className="modal-actions"><button className="primary" disabled={busy||!selected.length||!!s.conflict} onClick={()=>void run(async()=>{await s.publish(work.id,selected);setPublished(true);})}>{busy?'게시 중':'선택한 문서 게시'}</button></div>}</>}{error&&<p className="error-message" role="alert">{error}</p>}
    </Modal>
    <Modal open={open==='new-work'} onClose={()=>setOpen(null)} title="새 작품"><div className="form-grid"><label>작품명<input autoFocus value={title} onChange={e=>setTitle(e.target.value)}/></label><label>형식<select value={form} onChange={e=>setForm(workSchema.shape.form.parse(e.target.value))}>{['단편','중편','장편'].map(v=><option key={v}>{v}</option>)}</select></label><label>책장<select aria-label="책장" disabled={busy||!!s.conflict} value={newShelf} onChange={e=>setNewShelf(e.target.value)}>{s.state&&workShelves(s.state).map(shelf=><option key={shelf.id} value={shelf.id}>{workShelfTitle(shelf)}</option>)}</select></label></div><div className="modal-actions"><button className="primary" disabled={busy||!title.trim()||!!s.conflict} onClick={()=>void run(async()=>{const document=newDocument('scene','첫 문서'),folderId=uid();const work:Work={id:uid(),title:title.trim(),subtitle:'',description:'',form,documents:[document],publications:[],activePublicationId:null,navigation:{version:1,sections:structuredClone(defaultSections),nodes:[{id:folderId,type:'folder',title:'본문',sectionId:'scene',parentId:null},{id:document.id,type:'document',sectionId:'scene',parentId:folderId}]}};s.update(state=>moveWorkToShelf({...state,works:[...state.works,work]},work.id,newShelf));setOpen(null);})}>작품 만들기</button></div>{error&&<p className="error-message" role="alert">{error}</p>}</Modal>
    <Modal open={!!s.conflict} onClose={()=>{}} title="저장 충돌" description="서로 다른 수정이 있습니다. 작업본으로 사용할 원고를 선택하세요." wide>
      {s.conflict&&<><div className="conflict-columns"><section><h3>이 기기의 원고</h3><NoteConflict notes={s.conflict.local.notes}/><p>{s.conflict.local.works[0]?.title}</p><pre>{plainText(s.conflict.local.works[0]?.documents.find(d=>d.kind==='scene')?.content||{type:'doc'}).slice(0,2500)}</pre></section><section><h3>다른 창 · 클라우드의 원고</h3><NoteConflict notes={s.conflict.remote.notes}/><p>{s.conflict.remote.works[0]?.title}</p><pre>{plainText(s.conflict.remote.works[0]?.documents.find(d=>d.kind==='scene')?.content||{type:'doc'}).slice(0,2500)}</pre></section></div><button className="button" disabled={busy} onClick={()=>void run(async()=>{setEmergencyDownload(null);setEmergencyDownload(await s.exportBackup());})}><Download size={16}/>양쪽 원고 백업 만들기</button><DownloadLink file={s.conflict?emergencyDownload:null}/><div className="modal-actions"><button className="button" disabled={busy} onClick={()=>void run(()=>s.resolve('remote'))}>다른 원고를 작업본으로</button><button className="primary" disabled={busy} onClick={()=>void run(()=>s.resolve('local'))}>이 기기 원고를 작업본으로</button></div></>}{error&&<p className="error-message" role="alert">{error}</p>}
    </Modal>
  </>;
}

function NoteConflict({notes=[]}:{notes?:PersonalNote[]}){return <><h4>개인 노트 {notes.length}개</h4>{notes.slice(0,8).map(note=><p key={note.id}><strong>{note.title.trim()||plainText(note.content).split("\n").find(line=>line.trim())?.slice(0,80)||"새 노트"}</strong> · {note.box==="icebox"?"아이스박스":"수집함"}<br/>{plainText(note.content).slice(0,160)}</p>)}{notes.length>8&&<p>나머지 {notes.length-8}개는 전체 ZIP에 포함됩니다.</p>}</>;}
