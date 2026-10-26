'use client';

import {useEffect,useMemo,useRef,useState} from 'react';
import {BookOpen,ChevronLeft,ChevronRight,Download} from 'lucide-react';
import {bookDocuments,bookFonts,bookOptionsSchema,bookPapers,defaultBookOptions,makeBookSource,type BookOptions,type BookFormat} from '@/lib/book-content';
import {documentTitle,plainText} from '@/lib/model';
import type {PreparedBook} from '@/lib/book-export';
import type {TransferDownload} from '@/lib/interchange';
import {Modal} from './primitives';
import {Select} from './select';
import {DownloadLink} from './download-link';
import {useStudio} from './studio-provider';

export function BookExportDialog({workId,onClose,onBack,onReturnFocus}:{workId:string;onClose:()=>void;onBack?:()=>void;onReturnFocus?:()=>void}){
  const s=useStudio(),[target,setTarget]=useState(workId||s.state?.works[0]?.id||'');
  const work=s.state?.works.find(work=>work.id===target),documents=work?bookDocuments(work):[];
  const [options,setOptions]=useState<BookOptions>(()=>({...defaultBookOptions,title:work?.title||'',author:s.state?.authorProfile?.name||''}));
  const [ids,setIds]=useState(()=>documents.filter(doc=>doc.kind==='scene'&&plainText(doc.content).trim()).map(doc=>doc.id));
  const [format,setFormat]=useState<BookFormat>('pdf'),[book,setBook]=useState<PreparedBook|null>(null),[download,setDownload]=useState<TransferDownload|null>(null);
  const [preview,setPreview]=useState(''),[page,setPage]=useState(0),[spread,setSpread]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const operation=useRef(0);
  const toggles=[{key:'cover',label:'제목 표지'},{key:'toc',label:'목차'},{key:'pageNumbers',label:'쪽 번호'}] as const;
  useEffect(()=>()=>{operation.current++;},[]);
  useEffect(()=>{setBook(null);setDownload(null);setPreview('');setError('');},[work]);
  useEffect(()=>{
    if(!book){setPreview('');

return;}

    let current=true;
    void import('@/lib/book-export').then(({bookHtml})=>{if(current)setPreview(bookHtml(book,{pages:[page,...(spread&&page+1<book.layout.pages.length?[page+1]:[])],spread,preview:true}));});

    return()=>{current=false;};
  },[book,page,spread]);
  const selected=useMemo(()=>new Set(ids),[ids]),count=documents.filter(doc=>selected.has(doc.id)).length;

  function invalidate(){setBook(null);setDownload(null);setPreview('');setError('');}

  function change(value:Partial<BookOptions>){setOptions(options=>({...options,...value}));invalidate();}

  async function create(save:boolean){
    const parsed=bookOptionsSchema.safeParse(options);

    if(!parsed.success){setError(parsed.error.issues[0]?.message||'책 설정을 확인하세요.');

return;}

    const op=++operation.current;setBusy(true);setError('');setDownload(null);

    try{
      const api=await import('@/lib/book-export');
      const prepared=book||await api.prepareBook(makeBookSource(await s.captureBookWork(target),ids),parsed.data,await api.loadBookFonts(options.font),format);

      if(operation.current!==op)return;
      setBook(prepared);setPage(book?page:0);

      if(save){const file=await api.exportBook(prepared,format);

if(operation.current===op)setDownload(file);}
    }catch(error){if(operation.current===op)setError(error instanceof Error?error.message:'책 파일을 만들지 못했습니다.');}
    finally{if(operation.current===op)setBusy(false);}
  }

  return <Modal open onClose={()=>{if(!busy)onClose();}} onBack={onBack?()=>{if(!busy)onBack();}:undefined} backDisabled={busy} onReturnFocus={onReturnFocus} title="책으로 내보내기" wide>
    <div className="book-export">
      <section className="book-export-options" aria-label="책 설정">
        <div className="form-grid">
          <label>작품<Select aria-label="내보낼 작품" value={target} disabled={busy} onChange={value=>{const work=s.state?.works.find(work=>work.id===value);setTarget(value);setOptions(options=>({...options,title:work?.title||''}));setIds(work?bookDocuments(work).filter(doc=>doc.kind==='scene'&&plainText(doc.content).trim()).map(doc=>doc.id):[]);invalidate();}}>{s.state?.works.map(work=><option key={work.id} value={work.id}>{work.title}</option>)}</Select></label>
          <label>책 제목<input aria-label="책 제목" maxLength={300} value={options.title} disabled={busy} onChange={e=>change({title:e.target.value})}/></label>
          <label>저자<input aria-label="책 저자" maxLength={100} value={options.author} disabled={busy} onChange={e=>change({author:e.target.value})}/></label>
          <div className="book-export-field"><span>파일 형식</span><div className="segmented" role="group" aria-label="책 파일 형식">{(['pdf','epub','html'] as const).map(value=><button key={value} type="button" aria-pressed={format===value} disabled={busy} onClick={()=>{setFormat(value);invalidate();}}>{value.toUpperCase()}</button>)}</div></div>
          <label>글꼴<Select aria-label="책 글꼴" value={options.font} disabled={busy} onChange={value=>change({font:bookOptionsSchema.shape.font.parse(value)})}>{Object.entries(bookFonts).map(([key,font])=><option key={key} value={key}>{font.label}</option>)}</Select></label>
          {format!=='epub'&&<>
            <label>용지<Select aria-label="책 용지" value={options.paper} disabled={busy} onChange={value=>change({paper:bookOptionsSchema.shape.paper.parse(value)})}>{Object.entries(bookPapers).map(([key,paper])=><option key={key} value={key}>{paper.label}</option>)}</Select></label>
            <div className="book-export-pair"><div className="book-export-field"><span>방향</span><div className="segmented" role="group" aria-label="책 방향">{(['portrait','landscape'] as const).map(value=><button key={value} type="button" aria-pressed={options.orientation===value} disabled={busy} onClick={()=>change({orientation:value})}>{value==='portrait'?'세로':'가로'}</button>)}</div></div><div className="book-export-field"><span>단수</span><div className="segmented" role="group" aria-label="책 단수">{([1,2] as const).map(value=><button key={value} type="button" aria-pressed={options.columns===value} disabled={busy} onClick={()=>change({columns:value})}>{value}단</button>)}</div></div></div>
            <div className="book-export-pair"><label>글자 크기 · pt<input aria-label="책 글자 크기" type="number" min={8} max={20} step={.5} disabled={busy} value={Number.isFinite(options.size)?options.size:''} onChange={e=>change({size:e.target.valueAsNumber})}/></label><label>여백 · mm<input aria-label="책 여백" type="number" min={10} max={30} disabled={busy} value={Number.isFinite(options.margin)?options.margin:''} onChange={e=>change({margin:e.target.valueAsNumber})}/></label></div>
          </>}
          <div className="book-export-pair"><label>줄 간격<Select aria-label="책 줄 간격" value={options.lineHeight} disabled={busy} onChange={value=>change({lineHeight:Number(value)})}>{[1.4,1.7,2,2.2].map(value=><option key={value} value={value}>{value}</option>)}</Select></label><label>정렬<Select aria-label="책 정렬" value={options.align} disabled={busy} onChange={value=>change({align:bookOptionsSchema.shape.align.parse(value)})}><option value="justify">양쪽</option><option value="left">왼쪽</option></Select></label></div>
        </div>
        <div className="book-export-checks">{toggles.values().filter(item=>format!=='epub'||item.key!=='pageNumbers').map(({key,label})=><label key={key}><input type="checkbox" checked={options[key]} disabled={busy} onChange={e=>change({[key]:e.target.checked})}/>{label}</label>).toArray()}</div>
        <details className="book-export-documents"><summary>문서 {count}개</summary><div className="transfer-bulk"><button type="button" className="button" disabled={busy} onClick={()=>{setIds(documents.map(doc=>doc.id));invalidate();}}>전체</button><button type="button" className="button" disabled={busy} onClick={()=>{setIds(documents.filter(doc=>doc.kind==='scene'&&plainText(doc.content).trim()).map(doc=>doc.id));invalidate();}}>원고만</button><button type="button" className="button" disabled={busy} onClick={()=>{setIds([]);invalidate();}}>선택 해제</button></div><div className="transfer-list">{documents.map(doc=><label className="transfer-export-row" key={doc.id}><input type="checkbox" aria-label={`${documentTitle(doc)} 책에 포함`} checked={selected.has(doc.id)} disabled={busy} onChange={e=>{setIds(ids=>e.target.checked?[...ids,doc.id]:ids.filter(id=>id!==doc.id));invalidate();}}/><span>{documentTitle(doc)}</span></label>)}</div></details>
        <p className="field-help">문서 트리 순서 · 각주 포함 · 첨부·@ 참조 제외</p>
      </section>
      <section className="book-export-preview" aria-label="책 미리보기">
        {format==='epub'?<div className="book-export-empty"><BookOpen size={24}/><p>EPUB의 글자 크기와 쪽 배치는 독서기에서 조절합니다.</p><p className="muted">문서 {count}개 · {bookFonts[options.font].label}</p></div>:<>
          <div className="book-preview-bar"><div className="segmented" role="group" aria-label="미리보기 펼침"><button type="button" aria-pressed={!spread} disabled={busy} onClick={()=>setSpread(false)}>한 쪽</button><button type="button" aria-pressed={spread} disabled={busy} onClick={()=>setSpread(true)}>두 쪽</button></div><button type="button" className="button" disabled={busy||!count||!options.title.trim()} onClick={()=>void create(false)}>미리보기</button></div>
          {book?<><iframe title="책 쪽 미리보기" sandbox="" srcDoc={preview} style={{aspectRatio:`${book.layout.width*(spread?2:1)+(spread?24:8)} / ${book.layout.height+8}`}}/><div className="book-preview-pages"><button type="button" className="icon-button" aria-label="이전 쪽" disabled={busy||page===0} onClick={()=>setPage(page=>Math.max(0,page-(spread?2:1)))}><ChevronLeft size={16}/></button><span aria-live="polite">{page+1}{spread&&page+1<book.layout.pages.length?`–${page+2}`:''} / {book.layout.pages.length}쪽</span><button type="button" className="icon-button" aria-label="다음 쪽" disabled={busy||page+(spread?2:1)>=book.layout.pages.length} onClick={()=>setPage(page=>page+(spread?2:1))}><ChevronRight size={16}/></button></div></>:<div className="book-export-empty"><BookOpen size={24}/><p>{busy?'쪽을 나누는 중…':'미리보기'}</p></div>}
        </>}
      </section>
    </div>
    <div className="modal-actions"><button type="button" className="primary" disabled={busy||!count||!options.title.trim()||!!s.conflict} onClick={()=>void create(true)}><Download size={15}/>{busy?'만드는 중…':`${format.toUpperCase()} 만들기`}</button></div>
    <DownloadLink file={download}/>{error&&<p className="error-message" role="alert">{error}</p>}
  </Modal>;
}
