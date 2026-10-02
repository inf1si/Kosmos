'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Node, Mark, Extension, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { Plugin } from '@tiptap/pm/state';
import { Bold, Italic, Underline, Undo2, Redo2, AlignLeft, AlignCenter, List, Quote, Link2, MessageSquareText, Search, Minus, X, Columns2 } from 'lucide-react';
import { NovelDocument, RichNode, plainText, uid } from '@/lib/model';
import { IconButton, Modal } from './primitives';
import { WikiIcon } from './studio-icons';

const Note=Node.create({name:'footnote',group:'inline',inline:true,atom:true,
  addAttributes(){return {noteId:{default:null},text:{default:''}};},
  parseHTML(){return [{tag:'sup[data-note-id]'}];},
  renderHTML({HTMLAttributes}){return ['sup',mergeAttributes({'data-note-id':HTMLAttributes.noteId,class:'editor-note',title:HTMLAttributes.text}), '*'];},
});
const WikiLink=Mark.create({name:'wikiLink',inclusive:false,
  addAttributes(){return {targetId:{default:null}};},
  parseHTML(){return [{tag:'span[data-wiki-id]'}];},
  renderHTML({HTMLAttributes}){return ['span',mergeAttributes({'data-wiki-id':HTMLAttributes.targetId,class:'editor-wiki-link'}),0];},
});
const StableBlocks=Extension.create({name:'stableBlocks',
  addGlobalAttributes(){return [{types:['paragraph','heading'],attributes:{blockId:{default:null,parseHTML:el=>el.getAttribute('data-block-id'),renderHTML:attrs=>({'data-block-id':attrs.blockId})}}}];},
  addProseMirrorPlugins(){return [new Plugin({appendTransaction(transactions,_old,state){if(!transactions.some(t=>t.docChanged))return;const tr=state.tr;const seen=new Set<string>();state.doc.descendants((node,pos)=>{if(!['paragraph','heading'].includes(node.type.name))return;const id=node.attrs.blockId as string;if(!id||seen.has(id))tr.setNodeMarkup(pos,undefined,{...node.attrs,blockId:uid()});else seen.add(id);});return tr.docChanged?tr:null;}})];},
});
/** heading replaces the default kicker and title; toolbarEnd sits at the right of the toolbar; appearances counts each setting's referring documents for the link preview. */
export function RichEditor({doc,onChange,wiki,onWikiClick,readonly=false,heading,toolbarEnd,appearances}:{doc:NovelDocument;onChange:(content:RichNode)=>void;wiki:NovelDocument[];onWikiClick:(id:string)=>void;readonly?:boolean;heading?:ReactNode;toolbarEnd?:ReactNode;appearances?:Record<string,number>}){
  const [font,setFont]=useState('serif');const [size,setSize]=useState(18);const [find,setFind]=useState(false);const [query,setQuery]=useState('');const [replacement,setReplacement]=useState('');
  const [dialog,setDialog]=useState<'note'|'wiki'|null>(null);const [note,setNote]=useState('');const [target,setTarget]=useState(wiki[0]?.id||'');const [message,setMessage]=useState('');
  const [selection,setSelection]=useState<{from:number;to:number}>({from:0,to:0});const [,render]=useState(0);
  const scrollRef=useRef<HTMLDivElement>(null);const hideTimer=useRef<number|undefined>(undefined);const [preview,setPreview]=useState<{id:string;top:number;left:number}|null>(null);
  const editor=useEditor({immediatelyRender:false,editable:!readonly,
    extensions:[StarterKit,TextAlign.configure({types:['heading','paragraph']}),Note,WikiLink,StableBlocks],
    content:doc.content,
    editorProps:{attributes:{class:'manuscript','aria-label':`${doc.title} 원고`,spellcheck:'false'},handleClick:(_view,_pos,event)=>{const element=(event.target as HTMLElement).closest('[data-wiki-id]');if(element&&event.ctrlKey){onWikiClick(element.getAttribute('data-wiki-id')!);return true;}return false;}},
    onUpdate:({editor:e})=>onChange(e.getJSON() as RichNode),onSelectionUpdate:()=>render(x=>x+1),onTransaction:()=>render(x=>x+1),
  });
  useEffect(()=>{editor?.setEditable(!readonly,false);},[editor,readonly]);
  // Hovering a setting link shows its card; the card stays while the pointer moves onto it.
  function showPreview(target:EventTarget){const link=(target as HTMLElement).closest?.('[data-wiki-id]');const box=scrollRef.current;if(!link||!box)return;window.clearTimeout(hideTimer.current);const r=link.getBoundingClientRect(),b=box.getBoundingClientRect();setPreview({id:link.getAttribute('data-wiki-id')!,top:r.bottom-b.top+box.scrollTop+8,left:Math.max(8,Math.min(r.left-b.left+box.scrollLeft-12,box.clientWidth-308))});}
  function hidePreview(){window.clearTimeout(hideTimer.current);hideTimer.current=window.setTimeout(()=>setPreview(null),180);}
  useEffect(()=>()=>window.clearTimeout(hideTimer.current),[]);
  const previewDoc=preview&&wiki.find(d=>d.id===preview.id);const previewText=previewDoc?plainText(previewDoc.content).split('\n').map(t=>t.trim()).find(Boolean)||'':'';
  function openDialog(type:'note'|'wiki'){if(!editor)return;setSelection({from:editor.state.selection.from,to:editor.state.selection.to});setDialog(type);setMessage('');}
  function searchNext(){
    if(!editor||!query)return;const matches:{from:number;to:number}[]=[];
    editor.state.doc.descendants((node,pos)=>{if(!node.isText)return;let start=0;while(node.text?.indexOf(query,start)!==-1){const index=node.text!.indexOf(query,start);if(index<0)break;matches.push({from:pos+index,to:pos+index+query.length});start=index+query.length;}});
    const match=matches.find(m=>m.from>editor.state.selection.from)||matches[0];if(match){editor.chain().focus().setTextSelection(match).run();setMessage(`${matches.length}곳에서 찾았습니다.`);}else setMessage('일치하는 내용이 없습니다.');
  }
  function replaceSelected(){if(!editor||!query)return;if(editor.state.doc.textBetween(editor.state.selection.from,editor.state.selection.to)===query){editor.chain().focus().insertContent(replacement,{parseOptions:{preserveWhitespace:'full'}}).run();}else searchNext();}
  function replaceAll(){
    if(!editor||!query)return;const matches:{from:number;to:number}[]=[];
    editor.state.doc.descendants((n,pos)=>{if(!n.isText)return;let start=0;for(;;){const index=n.text!.indexOf(query,start);if(index<0)break;matches.push({from:pos+index,to:pos+index+query.length});start=index+query.length;}});
    const tr=editor.state.tr;for(const match of matches.reverse())tr.insertText(replacement,match.from,match.to);editor.view.dispatch(tr);setMessage(`${matches.length}곳을 바꿨습니다.`);
  }
  return <div className="editor-shell" style={{'--manuscript-size':`${size}px`} as React.CSSProperties}>
    <div className="editor-toolbar">
      <select aria-label="본문 글꼴" value={font} onChange={e=>setFont(e.target.value)}><option value="serif">명조</option><option value="sans">고딕</option></select>
      <select aria-label="본문 크기" value={size} onChange={e=>setSize(Number(e.target.value))}>{[16,18,20,22,24].map(v=><option key={v}>{v}</option>)}</select>
      <span className="toolbar-divider"/>
      <IconButton label="실행 취소" disabled={!editor?.can().undo()||readonly} onClick={()=>editor?.chain().focus().undo().run()}><Undo2 size={16}/></IconButton>
      <IconButton label="다시 실행" disabled={!editor?.can().redo()||readonly} onClick={()=>editor?.chain().focus().redo().run()}><Redo2 size={16}/></IconButton>
      <span className="toolbar-divider"/>
      <IconButton label="굵게" aria-pressed={editor?.isActive('bold')} disabled={readonly} onClick={()=>editor?.chain().focus().toggleBold().run()}><Bold size={16}/></IconButton>
      <IconButton label="기울임" aria-pressed={editor?.isActive('italic')} disabled={readonly} onClick={()=>editor?.chain().focus().toggleItalic().run()}><Italic size={16}/></IconButton>
      <IconButton label="밑줄" aria-pressed={editor?.isActive('underline')} disabled={readonly} onClick={()=>editor?.chain().focus().toggleUnderline().run()}><Underline size={16}/></IconButton>
      <span className="toolbar-divider"/>
      <IconButton label="왼쪽 정렬" disabled={readonly} onClick={()=>editor?.chain().focus().setTextAlign('left').run()}><AlignLeft size={16}/></IconButton>
      <IconButton label="가운데 정렬" disabled={readonly} onClick={()=>editor?.chain().focus().setTextAlign('center').run()}><AlignCenter size={16}/></IconButton>
      <IconButton label="목록" disabled={readonly} onClick={()=>editor?.chain().focus().toggleBulletList().run()}><List size={16}/></IconButton>
      <IconButton label="인용" disabled={readonly} onClick={()=>editor?.chain().focus().toggleBlockquote().run()}><Quote size={16}/></IconButton>
      <IconButton label="장면 구분선" disabled={readonly} onClick={()=>editor?.chain().focus().setHorizontalRule().run()}><Minus size={16}/></IconButton>
      <span className="toolbar-divider"/>
      <IconButton label="각주 추가" disabled={readonly} onClick={()=>openDialog('note')}><MessageSquareText size={16}/></IconButton>
      <IconButton label="설정 링크 추가" disabled={readonly||!wiki.length} onClick={()=>openDialog('wiki')}><Link2 size={16}/></IconButton>
      <IconButton label="찾기와 바꾸기" aria-pressed={find} onClick={()=>setFind(v=>!v)}><Search size={16}/></IconButton>
      {toolbarEnd&&<div className="toolbar-end">{toolbarEnd}</div>}
    </div>
    {find&&<div className="find-bar"><input aria-label="찾을 내용" placeholder="찾을 내용" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')searchNext();}}/><button onClick={searchNext}>다음</button><input aria-label="바꿀 내용" placeholder="바꿀 내용" value={replacement} onChange={e=>setReplacement(e.target.value)}/><button disabled={readonly} onClick={replaceSelected}>바꾸기</button><button disabled={readonly} onClick={replaceAll}>모두</button><IconButton label="찾기 닫기" onClick={()=>setFind(false)}><X size={14}/></IconButton>{message&&<small>{message}</small>}</div>}
    <div ref={scrollRef} className={`editor-scroll font-${font}`} onMouseOver={e=>showPreview(e.target)} onMouseOut={e=>{if((e.target as HTMLElement).closest?.('[data-wiki-id]'))hidePreview();}}>{heading||<div className="document-heading"><span>{doc.kind==='scene'?doc.chapter:doc.category||'메모'}</span><h1>{doc.title}</h1></div>}<EditorContent editor={editor}/>
      {preview&&previewDoc&&<div className="wiki-preview" role="tooltip" style={{top:preview.top,left:preview.left}} onMouseEnter={()=>window.clearTimeout(hideTimer.current)} onMouseLeave={hidePreview}><span><WikiIcon category={previewDoc.category} size={13}/>{previewDoc.category||'설정'}</span><strong>{previewDoc.title}</strong>{previewText&&<span>{previewText.length>110?`${previewText.slice(0,110)}…`:previewText}</span>}<footer><button type="button" onClick={()=>{onWikiClick(previewDoc.id);setPreview(null);}}><Columns2 size={13}/>옆에 열기</button>{appearances&&<span>등장 {appearances[previewDoc.id]||0}곳</span>}</footer></div>}
    </div>
    <Modal open={dialog==='note'} onClose={()=>setDialog(null)} title="각주 추가" description="공개할 원고에 포함되는 설명입니다."><textarea autoFocus value={note} onChange={e=>setNote(e.target.value)} placeholder="각주 내용을 입력하세요" rows={5}/><div className="modal-actions"><button className="primary" disabled={!note.trim()} onClick={()=>{editor?.chain().focus().setTextSelection(selection.to).insertContent({type:'footnote',attrs:{noteId:uid(),text:note.trim()}}).run();setDialog(null);setNote('');}}>각주 삽입</button></div></Modal>
    <Modal open={dialog==='wiki'} onClose={()=>setDialog(null)} title="설정집 연결" description="선택한 단어를 작품의 설정 문서에 연결합니다."><select aria-label="연결할 설정" value={target} onChange={e=>setTarget(e.target.value)}>{wiki.map(d=><option key={d.id} value={d.id}>{d.title}</option>)}</select><div className="modal-actions"><button className="primary" disabled={!target} onClick={()=>{if(selection.from===selection.to){const text=wiki.find(d=>d.id===target)?.title||'설정';editor?.chain().focus().setTextSelection(selection.from).insertContent({type:'text',text,marks:[{type:'wikiLink',attrs:{targetId:target}}]}).run();}else editor?.chain().focus().setTextSelection(selection).setMark('wikiLink',{targetId:target}).run();setDialog(null);}}>연결</button></div></Modal>
  </div>;
}
