'use client';
import { useEffect,useRef,useState } from 'react';
import type { Editor } from '@tiptap/core';
import { Search,ChevronUp,ChevronDown } from 'lucide-react';
import { TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { searchKey,searchMatches } from '@/lib/editor-search';
import { IconButton,Popover } from './primitives';
import styles from './editor-tools.module.css';
export function EditorSearch({editor,readonly}:{editor:Editor|null;readonly:boolean}){
  const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[replacement,setReplacement]=useState(''),[caseSensitive,setCaseSensitive]=useState(false),[wholeWord,setWholeWord]=useState(false);
  const options={query:open?query:'',caseSensitive,wholeWord},matches=editor?searchMatches(editor.state.doc,options):[],selection=editor?.state.selection,index=matches.findIndex(m=>m.from===selection?.from&&m.to===selection?.to);
  const ref=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(editor&&!editor.isDestroyed)editor.view.dispatch(editor.state.tr.setMeta(searchKey,{query:open?query:'',caseSensitive,wholeWord}).setMeta('addToHistory',false));},[editor,query,caseSensitive,wholeWord,open]);
  useEffect(()=>{if(!editor)return;const key=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&['f','h'].includes(e.key.toLowerCase())){e.preventDefault();setOpen(true);}};const dom=editor.view.dom;dom.addEventListener('keydown',key);return()=>dom.removeEventListener('keydown',key);},[editor]);
  function navigate(direction=1){if(!editor)return;const all=searchMatches(editor.state.doc,{query,caseSensitive,wholeWord});if(!all.length)return;const s=editor.state.selection,match=direction>0?all.find(m=>m.from>=s.to)||all[0]:[...all].reverse().find(m=>m.to<=s.from)||all.at(-1)!;editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc,match.from,match.to)).scrollIntoView().setMeta('addToHistory',false));}
  function replace(all=false){if(!editor||readonly)return;const found=searchMatches(editor.state.doc,{query,caseSensitive,wholeWord});const chosen=all?found:found.filter(m=>m.from===editor.state.selection.from&&m.to===editor.state.selection.to);if(!chosen.length){navigate();return;}const tr=closeHistory(editor.state.tr);for(const m of [...chosen].reverse())tr.insertText(replacement,m.from,m.to);editor.view.dispatch(tr);if(!all)navigate();}
  return <Popover open={open} onOpenChange={setOpen} title="찾기·바꾸기" width={360} align="end" onReturnFocus={()=>editor?.commands.focus()} trigger={<IconButton label="찾기와 바꾸기" disabled={!editor} aria-pressed={open}><Search size={16}/></IconButton>}><div className={styles.tools}>
    <label>찾을 내용<input ref={ref} autoFocus aria-label="찾을 내용" value={query} maxLength={500} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();navigate(e.shiftKey?-1:1);}}}/></label>
    <div className={styles.row}><span role="status">{query?(index>=0?`${index+1} / ${matches.length}`:`${matches.length}개`):'0개'}</span><IconButton label="이전 검색 결과" disabled={!matches.length} onClick={()=>navigate(-1)}><ChevronUp size={16}/></IconButton><IconButton label="다음 검색 결과" disabled={!matches.length} onClick={()=>navigate()}><ChevronDown size={16}/></IconButton></div>
    <div className={styles.row}><label className={styles.check}><input type="checkbox" checked={caseSensitive} onChange={e=>setCaseSensitive(e.target.checked)}/>대소문자 구분</label><label className={styles.check}><input type="checkbox" checked={wholeWord} onChange={e=>setWholeWord(e.target.checked)}/>어절 일치</label></div>
    <label>바꿀 내용<input aria-label="바꿀 내용" value={replacement} maxLength={5000} onChange={e=>setReplacement(e.target.value)}/></label><div className={styles.row}><button className="button" disabled={readonly||!matches.length} onClick={()=>replace()}>바꾸기</button><button className="button" disabled={readonly||!matches.length} onClick={()=>replace(true)}>모두 바꾸기</button></div>
    </div></Popover>;
}
