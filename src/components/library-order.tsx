'use client';

import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Book } from 'lucide-react';
import { librarySort, librarySorts, sortPublications, type LibraryItem } from '@/lib/library-order';
import { useStudio } from './studio-provider';
import { IconButton, Modal } from './primitives';

export function LibraryOrder({readonly,onClose,onReturnFocus}:{readonly:boolean;onClose:()=>void;onReturnFocus:()=>void}){
  const s=useStudio(),[items,setItems]=useState<LibraryItem[]>([]),[saved,setSaved]=useState<LibraryItem[]>([]);
  const [sort,setSort]=useState('titleAsc'),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const disabled=readonly||busy||loading||!!s.conflict;
  useEffect(()=>{let active=true;void s.libraryPublications().then(data=>{if(active){setItems(data);setSaved(data);}}).catch(e=>{if(active)setError(e instanceof Error?e.message:'서재를 불러오지 못했습니다.');}).finally(()=>{if(active)setLoading(false);});

return()=>{active=false;};},[s.namespace]);
  const changed=items.some((p,i)=>p.id!==saved[i]?.id);

  function move(index:number,direction:number){const next=[...items];[next[index],next[index+direction]]=[next[index+direction],next[index]];setItems(next);}

  async function save(){setBusy(true);setError('');

try{const result=await s.setLibraryOrder(items.map(p=>p.id));setItems(result);setSaved(result);}catch(e){setError(e instanceof Error?e.message:'서재 순서를 저장하지 못했습니다.');}finally{setBusy(false);}}

  return <Modal open onReturnFocus={onReturnFocus} onClose={()=>{if(!busy)onClose();}} title="서재 순서 편집" wide>
    <div className="library-order-controls"><label>자동 정렬 기준<select aria-label="자동 정렬 기준" value={sort} disabled={disabled} onChange={e=>setSort(e.target.value)}>{Object.entries(librarySorts).filter(([key])=>key!=='author').map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><button type="button" className="button" disabled={disabled||items.length<2} onClick={()=>{setItems(sortPublications(items,librarySort(sort)));}}>자동 정렬</button></div>
    {loading?<p className="muted" role="status">서재를 불러오는 중입니다.</p>:items.length?<ol className="library-order-list">{items.map((p,i)=><li className="reference-card library-order-row" key={p.id}><Book size={16}/><span><strong title={p.title}>{p.title}</strong><small>{new Date(p.publishedAt).toLocaleDateString('ko-KR')} 게시</small></span><div><IconButton label={`${p.title} 위로`} disabled={disabled||i===0} onClick={()=>move(i,-1)}><ArrowUp size={15}/></IconButton><IconButton label={`${p.title} 아래로`} disabled={disabled||i===items.length-1} onClick={()=>move(i,1)}><ArrowDown size={15}/></IconButton></div></li>)}</ol>:!error&&<p className="muted">게시된 작품이 없습니다.</p>}
    {error&&<p className="error-message" role="alert">{error}</p>}
    <div className="modal-actions"><button type="button" className="button" disabled={disabled||!changed} onClick={()=>setItems(saved)}>저장된 순서로</button><button type="button" className="button primary" disabled={disabled||!changed} onClick={()=>void save()}>{busy?'저장 중':'서재 순서 저장'}</button></div>
  </Modal>;
}
