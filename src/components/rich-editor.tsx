'use client';

import { documentTitle } from '@/lib/model';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import { Bold, Italic, Underline, Undo2, Redo2, AlignLeft, AlignCenter, Quote, Link2, MessageSquareText, Minus, Columns2, ChevronLeft, ChevronRight, ListChecks, ImagePlus } from 'lucide-react';
import { NovelDocument, RichNode, plainText, uid } from '@/lib/model';
import { IconButton, Popover, type PopoverAnchor } from './primitives';
import { WikiIcon } from './studio-icons';
import { manuscriptFonts } from '@/lib/editor-preferences';
import { statisticsSelection } from '@/lib/text-statistics';
import { useEditorPreferences } from './use-editor-preferences';
import { useAppPreferences } from './use-app-preferences';
import { manuscriptLayoutStyle } from '@/lib/app-preferences';
import { manuscriptFontVariables } from './manuscript-fonts';
import { editorExtensions } from '@/lib/editor-extensions';
import { EditorFormatTools,FontSizeControl,ListMenu } from './editor-format-tools';
import { EditorSearch } from './editor-search';
import type { EditorAIScope } from '@/lib/ai-conversation';
import { EditorCommands } from './editor-commands';
import { captureEditorTarget,targetIsCurrent } from '@/lib/editor-target';
import { EditorFootnotePopover } from './editor-footnote-popover';

/** The link tool targets settings in a work and other notes in the notes space. */
type LinkCopy={tool:string;title:string;description:string;select:string;open:string};

const SETTING_LINK_COPY:LinkCopy={tool:'설정 링크 추가',title:'설정집 연결',description:'선택한 단어를 작품의 설정 문서에 연결합니다.',select:'연결할 설정',open:'옆에 열기'};

/** Notes-only tools: checklists and in-body images. onImage stores the file as a note attachment and returns its id. */
export type NoteTools={extensions:AnyExtension[];onImage:(file:File)=>Promise<string>};

/** heading replaces the default kicker and title; toolbarEnd sits at the right of the toolbar; appearances counts each setting's referring documents for the link preview. */
export function RichEditor({doc,onChange,wiki,onWikiClick,readonly=false,heading,toolbarEnd,renderToolbarEnd,appearances,autofocus=false,contentLabel,linkCopy=SETTING_LINK_COPY,noteTools,aiTools}:{doc:NovelDocument;onChange:(content:RichNode)=>void;wiki:NovelDocument[];onWikiClick:(id:string)=>void;readonly?:boolean;heading?:ReactNode;toolbarEnd?:ReactNode;renderToolbarEnd?:(selection:RichNode|null)=>ReactNode;appearances?:Record<string,number>;autofocus?:boolean;contentLabel?:string;linkCopy?:LinkCopy;noteTools?:NoteTools;aiTools?:{scope:EditorAIScope;onContinue:()=>void}}){
  const [{font,size},setPreferences]=useEditorPreferences();const [appPreferences]=useAppPreferences();const selectedFont=manuscriptFonts.find(f=>f.id===font)!;
  const toolbarRef=useRef<HTMLDivElement>(null);const [overflow,setOverflow]=useState({before:false,after:false});
  const [dialog,setDialog]=useState<'note'|'wiki'|null>(null);const [note,setNote]=useState('');const [target,setTarget]=useState(wiki[0]?.id||'');
  const [selection,setSelection]=useState<{from:number;to:number}>({from:0,to:0});const [,render]=useState(0);
  const scrollRef=useRef<HTMLDivElement>(null);const hideTimer=useRef<number|undefined>(undefined);const [preview,setPreview]=useState<{kind:'wiki'|'note';id:string;top:number;left:number}|null>(null);
  const previewLocked=useRef(false);
  const lastContent=useRef<string|null>(null);const imageInput=useRef<HTMLInputElement>(null);const [imageBusy,setImageBusy]=useState(false);

  const editor=useEditor({immediatelyRender:false,editable:!readonly,autofocus:autofocus?'end':false,
    extensions:noteTools?[...editorExtensions,...noteTools.extensions]:editorExtensions,
    content:doc.content,
    editorProps:{attributes:{class:'manuscript','aria-label':contentLabel||`${documentTitle(doc)} 원고`,spellcheck:'false'},handleClick:(_view,_pos,event)=>{const element=event.target instanceof Element?event.target.closest('[data-wiki-id]'):null;

if(element&&event.ctrlKey){onWikiClick(element.getAttribute('data-wiki-id')!);

return true;}

return false;}},
    onUpdate:({editor:e})=>onChange(e.getJSON()),onSelectionUpdate:()=>render(x=>x+1),onTransaction:()=>render(x=>x+1),
  });

  useEffect(()=>{editor?.setEditable(!readonly,false);},[editor,readonly]);
  useEffect(()=>{
    if(!editor)return;const source=JSON.stringify(doc.content);

if(lastContent.current===source)return;
    const first=lastContent.current===null;lastContent.current=source;

    // AI/external changes must reach the mounted editor; local keystrokes already match it.
    if(!first&&source!==JSON.stringify(editor.getJSON()))editor.commands.setContent(doc.content,{emitUpdate:false});
  },[editor,doc.content]);
  useEffect(()=>{const bar=toolbarRef.current;

if(!bar)return;const measure=()=>setOverflow({before:bar.scrollLeft>2,after:bar.scrollWidth-bar.clientWidth-bar.scrollLeft>2});const observer=new ResizeObserver(measure);observer.observe(bar);bar.addEventListener('scroll',measure);measure();

return()=>{observer.disconnect();bar.removeEventListener('scroll',measure);};},[toolbarEnd]);

  // Hovering a setting link or a footnote mark shows its card; the card stays while the pointer moves onto it.
  function showPreview(target:EventTarget){if(previewLocked.current)return;const link=target instanceof Element?target.closest('[data-wiki-id],[data-note-id]'):null;const box=scrollRef.current;

if(!link||!box)return;window.clearTimeout(hideTimer.current);const r=link.getBoundingClientRect(),b=box.getBoundingClientRect(),wikiId=link.getAttribute('data-wiki-id');setPreview({kind:wikiId?'wiki':'note',id:wikiId||link.getAttribute('data-note-id')||'',top:r.bottom-b.top+box.scrollTop+8,left:Math.max(8,Math.min(r.left-b.left+box.scrollLeft-12,box.clientWidth-308))});}

  function hidePreview(){window.clearTimeout(hideTimer.current);

if(previewLocked.current)return;hideTimer.current=window.setTimeout(()=>setPreview(null),180);}

  function closePreview(){window.clearTimeout(hideTimer.current);previewLocked.current=false;setPreview(null);}

  useEffect(()=>{window.clearTimeout(hideTimer.current);previewLocked.current=false;setPreview(null);},[doc.id]);
  useEffect(()=>()=>window.clearTimeout(hideTimer.current),[]);
  const previewDoc=preview?.kind==='wiki'?wiki.find(d=>d.id===preview.id):undefined;
  const previewText=previewDoc?plainText(previewDoc.content).split('\n').map(t=>t.trim()).find(Boolean)||'':'';
  const dialogAnchor:PopoverAnchor=useRef(null);

  /** 각주·설정 연결 창은 선택한 글자 바로 아래에 붙인다. 선택 위치가 화면 밖이면 누른 도구 버튼에 붙인다. */
  function openDialog(type:'note'|'wiki',button:HTMLElement){
    if(!editor)return;const {from,to}=editor.state.selection;setSelection({from,to});
    dialogAnchor.current={getBoundingClientRect:()=>{
      const box=scrollRef.current?.getBoundingClientRect();

      try{const a=editor.view.coordsAtPos(from),b=editor.view.coordsAtPos(to),top=Math.min(a.top,b.top),bottom=Math.max(a.bottom,b.bottom),left=a.top===b.top?Math.min(a.left,b.left):a.left;

        if(box&&bottom>box.top&&top<box.bottom)return new DOMRect(left,top,Math.max(1,a.top===b.top?Math.abs(b.left-a.left):1),bottom-top);}catch{}

      return button.getBoundingClientRect();
    }};
    setDialog(type);
  }

  return <div className={`editor-shell ${manuscriptFontVariables}`} style={/* SAFETY: React forwards CSS custom properties whose values here are strings or numbers. */ {'--manuscript-size':`${size}px`,'--manuscript-font':selectedFont.family,...manuscriptLayoutStyle(appPreferences)} as React.CSSProperties}>
    <div className="editor-toolbar-frame">
    {overflow.before&&<div className="toolbar-scroll before"><IconButton label="이전 편집 도구" onClick={()=>toolbarRef.current?.scrollBy({left:-240,behavior:'smooth'})}><ChevronLeft size={16}/></IconButton></div>}
    <div className="editor-toolbar" ref={toolbarRef}>
      <select aria-label="본문 글꼴" title="이 기기에 저장되는 원고 표시 설정" value={font} onChange={e=>setPreferences({font:e.target.value})}>{manuscriptFonts.map(f=><option key={f.id} value={f.id}>{f.label}</option>)}</select>
      <FontSizeControl editor={editor} readonly={readonly} size={size} onBaseChange={size=>setPreferences({size})}/>
      <span className="toolbar-divider"/>
      <IconButton label="실행 취소" disabled={!editor?.can().undo()||readonly} onClick={()=>editor?.chain().focus().undo().run()}><Undo2 size={16}/></IconButton>
      <IconButton label="다시 실행" disabled={!editor?.can().redo()||readonly} onClick={()=>editor?.chain().focus().redo().run()}><Redo2 size={16}/></IconButton>
      <span className="toolbar-divider"/>
      <IconButton label="굵게" aria-pressed={editor?.isActive('bold')} disabled={readonly} onClick={()=>editor?.chain().focus().toggleBold().run()}><Bold size={16}/></IconButton>
      <IconButton label="기울임" aria-pressed={editor?.isActive('italic')} disabled={readonly} onClick={()=>editor?.chain().focus().toggleItalic().run()}><Italic size={16}/></IconButton>
      <IconButton label="밑줄" aria-pressed={editor?.isActive('underline')} disabled={readonly} onClick={()=>editor?.chain().focus().toggleUnderline().run()}><Underline size={16}/></IconButton>
      <span className="toolbar-divider"/>
      <EditorFormatTools editor={editor} readonly={readonly}/>
      <IconButton label="왼쪽 정렬" disabled={readonly} onClick={()=>editor?.chain().focus().setTextAlign('left').run()}><AlignLeft size={16}/></IconButton>
      <IconButton label="가운데 정렬" disabled={readonly} onClick={()=>editor?.chain().focus().setTextAlign('center').run()}><AlignCenter size={16}/></IconButton>
      <ListMenu editor={editor} readonly={readonly}/>
      {noteTools&&<><IconButton label="체크리스트" aria-pressed={editor?.isActive('taskList')} disabled={readonly} onClick={()=>editor?.chain().focus().toggleTaskList().run()}><ListChecks size={16}/></IconButton>
        <IconButton label="본문에 이미지 넣기" disabled={readonly||imageBusy} onClick={()=>imageInput.current?.click()}><ImagePlus size={16}/></IconButton>
        <input ref={imageInput} type="file" hidden aria-label="본문에 넣을 이미지" accept="image/png,image/jpeg,image/webp" onChange={e=>{const file=e.target.files?.[0];e.target.value='';

if(!file||!editor)return;const position=captureEditorTarget(editor),imageSelection=editor.state.selection.empty?position.cursor:{from:position.from,to:position.to};setImageBusy(true);void noteTools.onImage(file).then(id=>{if(!targetIsCurrent(editor,position))throw new Error('노트가 바뀌었습니다. 첨부는 보관했으니 원하는 위치에 다시 넣으세요.');editor.chain().focus().setTextSelection(imageSelection).insertContent({type:'noteImage',attrs:{assetId:id,alt:file.name}}).run();}).catch(error=>alert(error instanceof Error?error.message:'이미지를 넣지 못했습니다.')).finally(()=>setImageBusy(false));}}/></>}
      <IconButton label="인용" disabled={readonly} onClick={()=>editor?.chain().focus().toggleBlockquote().run()}><Quote size={16}/></IconButton>
      <IconButton label="장면 구분선" disabled={readonly} onClick={()=>editor?.chain().focus().setHorizontalRule().run()}><Minus size={16}/></IconButton>
      <span className="toolbar-divider"/>
      <IconButton label="각주 추가" disabled={readonly} onClick={e=>openDialog('note',e.currentTarget)}><MessageSquareText size={16}/></IconButton>
      <IconButton label={linkCopy.tool} disabled={readonly||!wiki.length} onClick={e=>openDialog('wiki',e.currentTarget)}><Link2 size={16}/></IconButton>
      <EditorSearch editor={editor} readonly={readonly}/>
      {(toolbarEnd||renderToolbarEnd)&&<div className="toolbar-end">{renderToolbarEnd?renderToolbarEnd(editor?statisticsSelection(editor.state.doc,editor.state.selection.from,editor.state.selection.to):null):toolbarEnd}</div>}
    </div>
    {overflow.after&&<div className="toolbar-scroll after"><IconButton label="다음 편집 도구" onClick={()=>toolbarRef.current?.scrollBy({left:240,behavior:'smooth'})}><ChevronRight size={16}/></IconButton></div>}
    </div>
    <div ref={scrollRef} className="editor-scroll" onMouseOver={e=>showPreview(e.target)} onFocusCapture={e=>{if((e.target instanceof Element?e.target:null)?.closest('[data-note-id]'))showPreview(e.target);}} onClickCapture={e=>{if((e.target instanceof Element?e.target:null)?.closest('[data-note-id]'))showPreview(e.target);}} onKeyDownCapture={e=>{if((e.key==='Enter'||e.key===' ')&&(e.target instanceof Element?e.target:null)?.closest('[data-note-id]')){e.preventDefault();showPreview(e.target);}}} onMouseOut={e=>{if((e.target instanceof Element?e.target:null)?.closest('[data-wiki-id],[data-note-id]'))hidePreview();}}>{heading||<div className="document-heading"><span>{doc.kind==='scene'?doc.chapter:doc.category||'메모'}</span><h1>{documentTitle(doc)}</h1></div>}<EditorContent editor={editor}/>
      {preview&&previewDoc&&<div className="wiki-preview" role="tooltip" style={{top:preview.top,left:preview.left}} onMouseEnter={()=>window.clearTimeout(hideTimer.current)} onMouseLeave={hidePreview}><span><WikiIcon category={previewDoc.category} size={13}/>{previewDoc.category||'설정'}</span><strong>{documentTitle(previewDoc)}</strong>{previewText&&<span>{previewText.length>110?`${previewText.slice(0,110)}…`:previewText}</span>}<footer><button type="button" onClick={()=>{onWikiClick(previewDoc.id);setPreview(null);}}><Columns2 size={13}/>{linkCopy.open}</button>{appearances&&<span>등장 {appearances[previewDoc.id]||0}곳</span>}</footer></div>}
      {preview?.kind==='note'&&editor&&<EditorFootnotePopover key={`${doc.id}-${preview.id}`} editor={editor} id={preview.id} readonly={readonly} onClose={closePreview} onStay={()=>window.clearTimeout(hideTimer.current)} onLeave={hidePreview} onEditing={value=>{previewLocked.current=value;window.clearTimeout(hideTimer.current);}}/>}
    </div>
    {aiTools&&editor&&!readonly&&<EditorCommands editor={editor} scope={aiTools.scope} onLink={()=>openDialog('wiki',editor.view.dom)} onFootnote={()=>openDialog('note',editor.view.dom)} onImage={noteTools?()=>{const input=imageInput.current;

if(input?.showPicker)input.showPicker();else input?.click();}:undefined} onContinue={aiTools.onContinue}/>}
    <Popover open={dialog==='note'} onOpenChange={open=>{if(!open)setDialog(null);}} anchor={dialogAnchor} width={320} title="각주 추가" description="공개할 원고에 포함되는 설명입니다." onReturnFocus={()=>editor?.commands.focus()}><textarea autoFocus value={note} onChange={e=>setNote(e.target.value)} placeholder="각주 내용을 입력하세요" rows={5}/><div className="popover-actions"><button className="primary" disabled={!note.trim()} onClick={()=>{editor?.chain().focus().setTextSelection(selection.to).insertContent({type:'footnote',attrs:{noteId:uid(),text:note.trim()}}).run();setDialog(null);setNote('');}}>각주 삽입</button></div></Popover>
    <Popover open={dialog==='wiki'} onOpenChange={open=>{if(!open)setDialog(null);}} anchor={dialogAnchor} width={300} title={linkCopy.title} description={linkCopy.description} onReturnFocus={()=>editor?.commands.focus()}><select aria-label={linkCopy.select} value={target} onChange={e=>setTarget(e.target.value)}>{wiki.map(d=><option key={d.id} value={d.id}>{documentTitle(d)}</option>)}</select><div className="popover-actions"><button className="primary" disabled={!target} onClick={()=>{if(selection.from===selection.to){const text=wiki.find(d=>d.id===target)?.title||'설정';editor?.chain().focus().setTextSelection(selection.from).insertContent({type:'text',text,marks:[{type:'wikiLink',attrs:{targetId:target}}]}).run();}else editor?.chain().focus().setTextSelection(selection).setMark('wikiLink',{targetId:target}).run();setDialog(null);}}>연결</button></div></Popover>
  </div>;
}
