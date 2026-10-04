'use client';
import { useMemo, useRef, useState } from 'react';
import { Check, FileText } from 'lucide-react';
import { Modal, Popover } from './primitives';
import { useStudio } from './studio-provider';
import { readInterchange, type ImportBundle } from '@/lib/interchange';
import { resolveNoteNavigation } from '@/lib/note-navigation';
import type { Work } from '@/lib/model';

/** Evernote ENEX와 Markdown·HTML·TXT를 새 최상위 폴더의 수집함 노트로 가져온다. 태그와 작성·수정 날짜는 유지한다. */
export function NotesImportDialog({open,onClose,onImported}:{open:boolean;onClose:()=>void;onImported:(folderId:string)=>void}){
  const s=useStudio(),[bundle,setBundle]=useState<ImportBundle|null>(null),[folder,setFolder]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const operation=useRef(0);
  function close(){if(busy)return;operation.current++;setBundle(null);setError('');setMessage('');onClose();}
  async function run(fn:()=>Promise<void>){setBusy(true);setError('');setMessage('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'노트를 가져오지 못했습니다.');}finally{setBusy(false);}}
  const attached=bundle?bundle.assets.filter(a=>bundle.pages.some(p=>p.assetKeys.includes(a.key))).length:0;
  return <Modal open={open} onClose={close} title="노트 가져오기" description="가져온 노트는 새 폴더의 수집함에 들어갑니다. 기존 노트는 유지됩니다." wide>
    <div className="transfer-guide"><p><strong>Evernote</strong> · 노트북 메뉴 → 노트북 내보내기 → ENEX</p><p className="muted">ENEX, Markdown·HTML·TXT 또는 이들을 묶은 ZIP을 선택하세요. 태그와 작성·수정 날짜를 유지하고, 이미지는 PNG/JPEG/WebP 10MB 이하를 노트 첨부로 보관합니다.</p></div>
    <label className="backup-upload">가져올 파일 선택<input type="file" aria-label="가져올 노트 파일" multiple accept=".enex,.zip,.md,.markdown,.html,.htm,.txt" disabled={busy} onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value='';if(!files.length)return;const op=++operation.current;setBundle(null);void run(async()=>{const parsed=await readInterchange(files);if(operation.current!==op)return;setBundle(parsed);setFolder(files[0].name.replace(/\.[^.]+$/,'').slice(0,300));});}}/></label>
    {bundle&&<>
      <div className="transfer-summary"><strong>노트 {bundle.pages.length}개 · 첨부 {attached}개</strong><span>같은 파일을 다시 가져오면 사본이 추가됩니다.</span></div>
      <div className="transfer-target"><label>새 폴더 이름<input aria-label="가져올 폴더 이름" value={folder} maxLength={300} disabled={busy} onChange={e=>setFolder(e.target.value)}/></label></div>
      <div className="transfer-list">{bundle.pages.slice(0,200).map(p=><div className="transfer-row notes-import-row" key={p.key}><FileText size={14}/><span>{p.title}<small>{[p.tags?.length?p.tags.map(t=>`#${t}`).join(' '):'',p.key].filter(Boolean).join(' · ')}</small></span></div>)}{bundle.pages.length>200&&<p className="muted">외 {bundle.pages.length-200}개</p>}</div>
      {bundle.warnings.length>0&&<details className="transfer-warnings" open><summary>변환 시 확인할 항목 {bundle.warnings.length}개</summary><ul>{bundle.warnings.slice(0,100).map(w=><li key={w}>{w}</li>)}</ul></details>}
      <p className="field-help notes-import-help">체크리스트는 체크 상태와 함께, 노트 간 링크는 일반 텍스트로 옮깁니다. 원본 파일도 보관하세요.</p>
      <div className="modal-actions"><button type="button" className="primary" disabled={busy||!bundle.pages.length} onClick={()=>void run(async()=>{const result=await s.importNotes(bundle,folder);setBundle(null);setMessage(`노트 ${result.count}개를 가져왔습니다.`);onImported(result.folderId);})}>{busy?'처리 중…':`노트 ${bundle.pages.length}개 가져오기`}</button></div>
    </>}
    {message&&<p className="success-message" role="status"><Check size={15}/>{message}</p>}{error&&<p className="error-message" role="alert">{error}</p>}
  </Modal>;
}

/** 구상 폴더를 새 작품으로. 노트는 메모 · 리서치 문서로 복사되고 하위 폴더 구조를 유지한다. */
export function FolderWorkPopover({folderId,anchor,onClose,onCreated}:{folderId:string;anchor:HTMLElement|null;onClose:()=>void;onCreated:(workId:string)=>void}){
  const s=useStudio();
  const folder=useMemo(()=>s.state?resolveNoteNavigation(s.state).nodes.find(n=>n.id===folderId):undefined,[s.state,folderId]);
  const [title,setTitle]=useState(folder?.type==='folder'?folder.title:''),[form,setForm]=useState<Work['form']>('장편'),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const anchorRef=useRef({getBoundingClientRect:()=>anchor?.getBoundingClientRect()||new DOMRect()});
  async function create(){setBusy(true);setError('');try{const id=await s.createWorkFromFolder(folderId,{title,form});onCreated(id);}catch(e){setError(e instanceof Error?e.message:'작품을 만들지 못했습니다.');}finally{setBusy(false);}}
  return <Popover open onOpenChange={open=>{if(!open&&!busy)onClose();}} anchor={anchorRef} side={typeof window!=='undefined'&&window.innerWidth<700?'bottom':'right'} width={300} title="새 작품으로 만들기" description="폴더의 노트를 메모 · 리서치 문서로 복사합니다. 원본 노트는 그대로 두고 새 작품에 연결합니다." onReturnFocus={()=>{if(anchor?.isConnected)(anchor.matches('button')?anchor:anchor.querySelector<HTMLElement>('[data-row-menu],button'))?.focus();}}>
    <label>작품 제목<input aria-label="새 작품 제목" value={title} maxLength={300} disabled={busy} onChange={e=>setTitle(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&title.trim())void create();}}/></label>
    <label>형식<select aria-label="새 작품 형식" value={form} disabled={busy} onChange={e=>setForm(e.target.value as Work['form'])}>{(['단편','중편','장편'] as const).map(v=><option key={v}>{v}</option>)}</select></label>
    {error&&<p className="danger" role="alert">{error}</p>}
    <div className="popover-actions"><button type="button" className="button" disabled={busy} onClick={onClose}>취소</button><button type="button" className="button primary" disabled={busy||!title.trim()} onClick={()=>void create()}>{busy?'만드는 중…':'작품 만들기'}</button></div>
  </Popover>;
}
