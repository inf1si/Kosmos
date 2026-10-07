'use client';

import { documentSchema } from '@/lib/model';
import { useEffect, useRef, useState } from 'react';
import { Check, Download, Upload, FileText } from 'lucide-react';
import { Modal } from './primitives';
import { DownloadLink } from './download-link';
import { useStudio } from './studio-provider';
import { readInterchange, type ImportBundle, type ImportChoice, type ExportFormat, type TransferDownload } from '@/lib/interchange';
import { plainText } from '@/lib/model';

const exportFormats=['markdown','html','enex'] as const;

const kinds={scene:'원고',wiki:'설정집',memo:'메모 · 리서치'} as const;

const transferFileTypes='.zip,.enex,.md,.markdown,.html,.htm,.txt,.csv,.docx,.rtf,.hwp,.hwpx,.epub,.png,.jpg,.jpeg,.webp';

// Browsers expose folder picking only through this non-standard attribute.
const folderPicker={webkitdirectory:'',directory:''};

export function InterchangeDialog({workId}:{workId:string}){
  const s=useStudio();const [open,setOpen]=useState(false),[mode,setMode]=useState<'import'|'export'>('import');
  const [bundle,setBundle]=useState<ImportBundle|null>(null),[choices,setChoices]=useState<ImportChoice[]>([]),[target,setTarget]=useState('new'),[title,setTitle]=useState('');
  const [ids,setIds]=useState<string[]>([]),[format,setFormat]=useState<ExportFormat>('markdown'),[download,setDownload]=useState<TransferDownload|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[preview,setPreview]=useState('');const operation=useRef(0);
  const work=s.state?.works.find(w=>w.id===workId);
  useEffect(()=>{const listener=(event:Event)=>{if(!(event instanceof CustomEvent)||event.detail!=='interchange')return;operation.current++;setOpen(true);setBundle(null);setChoices([]);setDownload(null);setTarget('new');setTitle('');setError('');setMessage('');setPreview('');setIds(work?.documents.filter(d=>d.kind==='scene').map(d=>d.id)||[]);};

window.addEventListener('studio-modal',listener);

return()=>window.removeEventListener('studio-modal',listener);},[work]);

  async function run(fn:()=>Promise<void>){setBusy(true);setError('');setMessage('');

try{await fn();}catch(e){setError(e instanceof Error?e.message:'문서를 옮기지 못했습니다.');}finally{setBusy(false);}}

  function pick(list:FileList|null,input:HTMLInputElement){const files=Array.from(list||[]);input.value='';

if(!files.length)return;const op=++operation.current;setBundle(null);setChoices([]);void run(async()=>{const parsed=await readInterchange(files);

if(operation.current!==op)return;setBundle(parsed);setChoices(parsed.pages.map(p=>({key:p.key,title:p.title,kind:p.kind})));setTitle((files[0].webkitRelativePath.split('/')[0]||files[0].name).replace(/\.(scriv|zip|enex|epub|docx|hwpx?|rtf|md|markdown|html?|txt|csv)$/i,'').slice(0,300));setPreview(parsed.pages[0].key);});}

  function selectAll(kind:ImportChoice['kind']){if(bundle)setChoices(bundle.pages.map(p=>({key:p.key,title:p.title,kind})));}

  const selectedKeys=new Set(choices.map(c=>c.key));

  return <Modal open={open} onClose={()=>{if(!busy){operation.current++;setOpen(false);setDownload(null);}}} title="문서 가져오기 · 내보내기" description="Notion·Evernote·Word·한글 등과 원고를 파일로 옮깁니다. 가져온 문서는 비공개로 추가됩니다." wide>
    <div className="transfer-tabs" role="tablist" aria-label="문서 이동"><button role="tab" aria-selected={mode==='import'} disabled={busy} onClick={()=>{setMode('import');setError('');setMessage('');setDownload(null);}}><Upload size={16}/>가져오기</button><button role="tab" aria-selected={mode==='export'} disabled={busy} onClick={()=>{setMode('export');setError('');setMessage('');}}><Download size={16}/>내보내기</button></div>
    {mode==='import'?<>
      <div className="transfer-guide">
        <p><strong>Notion</strong> · 내보내기(Markdown &amp; CSV 또는 HTML, 하위 페이지 포함) → 받은 ZIP 그대로</p>
        <p><strong>Evernote</strong> · 노트 / 노트북 내보내기 → ENEX</p>
        <p><strong>Obsidian · 스크리브너</strong> · 보관함이나 .scriv 폴더를 선택. 맥의 스크리브너 프로젝트는 압축한 ZIP</p>
        <p className="muted">그 밖에 Word(docx), 한글(hwp·hwpx), RTF, EPUB, Markdown·HTML·TXT·CSV를 읽습니다. 100MB · 500개 문서까지, 이미지 첨부는 PNG/JPEG/WebP 10MB 이하를 지원합니다.</p>
      </div>
      <div className="transfer-pick">
        <label className="backup-upload">파일 선택<input type="file" aria-label="외부 문서 파일" multiple accept={transferFileTypes} disabled={busy} onChange={e=>pick(e.target.files,e.target)}/></label>
        <label className="backup-upload">폴더 선택<input type="file" aria-label="외부 문서 폴더" multiple {...folderPicker} disabled={busy} onChange={e=>pick(e.target.files,e.target)}/></label>
      </div>
      {bundle&&<>
        <div className="transfer-summary"><strong>{choices.length} / {bundle.pages.length}개 문서 선택 · {bundle.assets.filter(a=>bundle.pages.some(p=>selectedKeys.has(p.key)&&p.assetKeys.includes(a.key))).length}개 첨부</strong><span>기존 문서는 유지됩니다. 같은 파일을 다시 가져오면 사본이 추가됩니다.</span></div>
        <div className="transfer-target"><label>가져올 위치<select aria-label="가져올 작품" value={target} disabled={busy} onChange={e=>setTarget(e.target.value)}><option value="new">새 작품 만들기</option>{s.state?.works.map(w=><option key={w.id} value={w.id}>{w.title}</option>)}</select></label>{target==='new'&&<label>새 작품 제목<input aria-label="가져올 새 작품 제목" value={title} maxLength={300} disabled={busy} onChange={e=>setTitle(e.target.value)}/></label>}</div>
        <div className="transfer-bulk"><span>전체 문서 분류</span>{Object.entries(kinds).map(([kind,label])=><button className="button" disabled={busy} key={kind} onClick={()=>selectAll(documentSchema.shape.kind.parse(kind))}>{label}</button>)}<button className="button" disabled={busy} onClick={()=>setChoices([])}>선택 해제</button></div>
        <div className="transfer-list">{bundle.pages.map(p=>{const choice=choices.find(c=>c.key===p.key);

return <div className="transfer-row" key={p.key}><input aria-label={`${p.title} 가져오기 선택`} type="checkbox" checked={!!choice} disabled={busy} onChange={e=>setChoices(c=>e.target.checked?[...c,{key:p.key,title:p.title,kind:p.kind}]:c.filter(v=>v.key!==p.key))}/><button className={preview===p.key?'selected':''} disabled={busy} onClick={()=>setPreview(p.key)}><FileText size={14}/><span>{p.title}<small>{p.key}</small></span></button><select aria-label={`${p.title} 문서 종류`} value={choice?.kind||p.kind} disabled={!choice||busy} onChange={e=>setChoices(c=>c.map(v=>v.key===p.key?{...v,kind:documentSchema.shape.kind.parse(e.target.value)}:v))}>{Object.entries(kinds).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>;})}</div>
        {preview&&<div className="transfer-preview"><strong>본문 미리보기</strong><p>{plainText(bundle.pages.find(p=>p.key===preview)!.content).slice(0,2000)||'본문이 비어 있습니다.'}</p></div>}
        {bundle.warnings.length>0&&<details className="transfer-warnings" open><summary>변환 시 확인할 항목 {bundle.warnings.length}개</summary><ul>{bundle.warnings.slice(0,100).map(w=><li key={w}>{w}</li>)}</ul>{bundle.warnings.length>100&&<p>추가 {bundle.warnings.length-100}개 항목이 있습니다. 파일을 더 작게 나누어 확인하세요.</p>}</details>}
        <p className="field-help">페이지 간 링크는 대상 문서를 설정집으로 가져왔을 때 설정 연결로 바뀝니다. 이미지는 본문 위치 표시와 별도 첨부로 보관합니다. 원본 파일도 보관하세요.</p>
        <div className="modal-actions"><button className="primary" disabled={busy||!choices.length||target==='new'&&!title.trim()} onClick={()=>void run(async()=>{const count=choices.length;await s.importDocuments(bundle,choices,target==='new'?{title,form:'장편'}:{workId:target});setBundle(null);setChoices([]);setMessage(`${count}개 문서를 가져왔습니다. 작품 선택에서 확인할 수 있습니다.`);})}>{busy?'처리 중…':`${choices.length}개 문서 가져오기`}</button></div>
      </>}
    </>:work&&<>
      <div className="transfer-guide"><p><strong>{work.title}</strong>의 내보낼 문서를 선택하세요. 비공개 원고·설정·메모도 선택한 범위에 포함됩니다.</p></div>
      <label className="transfer-format">내보내기 형식<select aria-label="외부 문서 내보내기 형식" value={format} disabled={busy} onChange={e=>{setFormat(exportFormats.find(value=>value===e.target.value)||'markdown');setDownload(null);}}><option value="markdown">Markdown ZIP · Notion / Obsidian / 일반 편집기</option><option value="html">HTML ZIP · Notion / 웹 문서</option><option value="enex">Evernote ENEX · Evernote 가져오기</option></select></label>
      <div className="transfer-bulk"><button className="button" disabled={busy} onClick={()=>{setIds(work.documents.map(d=>d.id));setDownload(null);}}>전체 선택</button><button className="button" disabled={busy} onClick={()=>{setIds(work.documents.filter(d=>d.kind==='scene').map(d=>d.id));setDownload(null);}}>원고만</button><button className="button" disabled={busy} onClick={()=>{setIds(work.documents.filter(d=>d.kind==='wiki').map(d=>d.id));setDownload(null);}}>설정집만</button></div>
      <div className="transfer-list">{work.documents.map(d=><label className="transfer-export-row" key={d.id}><input type="checkbox" checked={ids.includes(d.id)} disabled={busy} onChange={e=>{setIds(v=>e.target.checked?[...v,d.id]:v.filter(id=>id!==d.id));setDownload(null);}}/><span>{d.title}</span><small>{kinds[d.kind]}</small></label>)}</div>
      <p className="field-help">첨부와 각주 설명을 포함합니다. ENEX에서는 각주가 번호·설명 텍스트로 바뀌며 설정 연결은 일반 텍스트로 옮깁니다. 복구 이력과 공개 판본까지 보관하려면 전체 ZIP 백업을 사용하세요.</p>
      <div className="modal-actions"><button className="primary" disabled={busy||!ids.length} onClick={()=>void run(async()=>{setDownload(null);setDownload(await s.exportDocuments(work.id,ids,format));})}>{busy?'파일 만드는 중…':`${ids.length}개 문서 내보내기`}</button></div><DownloadLink file={download}/>
    </>}
    {message&&<p className="success-message" role="status"><Check size={15}/>{message}</p>}{error&&<p className="error-message" role="alert">{error}</p>}
  </Modal>;
}
