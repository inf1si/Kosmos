'use client';

import {useEffect,useRef,useState} from 'react';
import {getMarkRange,type Editor,type ChainedCommands} from '@tiptap/core';
import {Plugin,PluginKey,Selection,TextSelection,AllSelection,NodeSelection} from '@tiptap/pm/state';
import {closeHistory} from '@tiptap/pm/history';
import {CellSelection} from '@tiptap/pm/tables';
import * as Popup from '@radix-ui/react-popover';
import {ArrowLeft,ChevronRight,Clipboard,Globe,ExternalLink,Unlink,Heading1,Heading2,Heading3,ImagePlus,Link2,List,ListChecks,ListOrdered,MessageSquareText,Minus,Plus,Quote,Table2,Trash2,Type} from 'lucide-react';
import type {RichNode} from '@/lib/model';
import {internalReferenceSchema,type InternalReference} from '@/lib/internal-reference-node';
import {editorFootnote} from '@/lib/editor-footnotes';
import {EditorFootnotePopover} from './editor-footnote-popover';
import {requestWebLink} from './editor-web-link';
import {normalizeWebLink} from '@/lib/editor-web-links';

type Context={x:number;y:number;selection:Selection;document:Editor['state']['doc']} & ({kind:'paragraph'|'table'}|{kind:'footnote';pos:number;id:string}|{kind:'reference';pos:number;reference:InternalReference}|{kind:'web-link';pos:number;to:number;href:string});

type Action={label:string;icon:typeof Type;apply:(chain:ChainedCommands)=>ChainedCommands};

const key=new PluginKey('editorPositionMenu');

/** Separate from the selected-text menu: commands keep the clicked caret/cell, never the AI paragraph range. */
export function EditorPositionMenu({editor,note,onLink,onFootnote,onImage,onReference,onOpen,onEditing}:{editor:Editor;note:boolean;onLink:()=>void;onFootnote:()=>void;onImage?:()=>void;onReference?:(reference:InternalReference)=>void;onOpen:()=>void;onEditing:(editing:boolean)=>void}){
  const [menu,setMenu]=useState<Context|null>(null),[page,setPage]=useState<'root'|'paragraph'|'insert'>('root'),[editing,setEditing]=useState<string|null>(null),[notice,setNotice]=useState('');
  const handler=useRef<(event:MouseEvent)=>boolean>(()=>false),pending=useRef<(()=>void)|null>(null);
  const editingChanged=useRef(onEditing);editingChanged.current=onEditing;
  const content=useRef<HTMLDivElement>(null),active=useRef(menu);active.current=menu;
  const anchor=useRef({getBoundingClientRect:()=>new DOMRect()});
  anchor.current.getBoundingClientRect=()=>new DOMRect(menu?.x||0,menu?.y||0,0,0);

  function close(focus=false){active.current=null;setMenu(null);onEditing(false);

if(focus&&!editor.isDestroyed)editor.view.focus();}

  function current(target:Context){return !editor.isDestroyed&&editor.isEditable&&editor.state.doc.eq(target.document);}

  function selectedTextAt(pos:number){
    const selected=editor.state.selection,dom=editor.view.dom.ownerDocument.getSelection();

    // Native drag/Home/End can precede ProseMirror's selectionchange observer.
    if(!(selected instanceof CellSelection)&&!(selected instanceof NodeSelection)&&dom&&!dom.isCollapsed&&dom.anchorNode&&dom.focusNode&&editor.view.dom.contains(dom.anchorNode)&&editor.view.dom.contains(dom.focusNode)){
      const anchor=editor.view.posAtDOM(dom.anchorNode,dom.anchorOffset),head=editor.view.posAtDOM(dom.focusNode,dom.focusOffset);

      if(pos>=Math.min(anchor,head)&&pos<=Math.max(anchor,head)){
        if(selected.anchor!==anchor||selected.head!==head)editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc,anchor,head)).setMeta('addToHistory',false));

        return true;
      }
    }

    return (selected instanceof TextSelection||selected instanceof AllSelection)&&!selected.empty&&pos>=selected.from&&pos<=selected.to;
  }

  function restore(target:Context){
    if(!current(target)){close();setNotice('글이 바뀌었습니다. 다시 열어주세요.');

return false;}

    editor.view.dispatch(editor.state.tr.setSelection(target.selection).setMeta('addToHistory',false));

return true;
  }

  function run(apply:Action['apply']){
    if(!menu||!restore(menu))return;
    apply(editor.chain().focus().command(({tr})=>{closeHistory(tr);

return true;})).run();
    editor.view.dispatch(closeHistory(editor.state.tr));close(true);
  }

  // Let the menu finish returning focus before opening another popover.
  function next(action:()=>void){if(!menu||!restore(menu))return;const target=menu;pending.current=()=>{if(restore(target))action();};

close();}

  handler.current=event=>{
    if(event.defaultPrevented||!editor.isEditable||event.shiftKey)return false;
    const element=event.target instanceof Element?event.target:null,pos=editor.view.posAtCoords({left:event.clientX,top:event.clientY})?.pos;

    if(!element||pos===undefined)return false;
    const selected=editor.state.selection;

    if(selectedTextAt(pos))return false;
    const atom=element.closest('[data-note-id],[data-internal-reference]');
    let special:{kind:'footnote';pos:number;id:string}|{kind:'reference';pos:number;reference:InternalReference}|{kind:'web-link';pos:number;to:number;href:string}|null=null;

    if(atom){
      const start=editor.view.posAtDOM(atom,0),node=editor.state.doc.nodeAt(start);

      if(node?.type.name==='footnote'){
        const id=String(node.attrs.noteId||'');

        if(editorFootnote(editor.state.doc,id)?.pos===start)special={kind:'footnote',pos:start,id};
      }
      else if(node?.type.name==='internalReference'){
        const parsed=internalReferenceSchema.safeParse(node.attrs);

        if(parsed.success)special={kind:'reference',pos:start,reference:parsed.data};
      }
    }

    const web=element.closest('a[href]'),range=web?getMarkRange(editor.state.doc.resolve(pos),editor.schema.marks.link):undefined;

    if(!special&&web&&range)special={kind:'web-link',pos:range.from,to:range.to,href:web.getAttribute('href')||''};
    const cell=element.closest('td,th');
    const selection=selected instanceof CellSelection&&cell?.classList.contains('selectedCell')?selected:Selection.near(editor.state.doc.resolve(special?.pos??pos));

    if(!special&&!(selection instanceof CellSelection)&&!selection.$from.parent.isTextblock)return false;
    event.preventDefault();pending.current=null;onOpen();setEditing(null);onEditing(true);setPage('root');setNotice('');
    editor.view.dispatch(editor.state.tr.setSelection(selection).setMeta('addToHistory',false));editor.view.focus();
    setMenu({x:event.clientX,y:event.clientY,document:editor.state.doc,selection,...(special||{kind:cell?'table':'paragraph'})});

    return true;
  };

  useEffect(()=>{
    const plugin=new Plugin({key,props:{handleDOMEvents:{
      // ProseMirror otherwise selects an inline atom on right mouseup, stealing focus from its new menu.
      mousedown:(_view,event)=>{
        if(event.button!==2||event.shiftKey||!editor.isEditable)return false;
        const pos=editor.view.posAtCoords({left:event.clientX,top:event.clientY})?.pos;

        if(pos===undefined||selectedTextAt(pos))return false;
        event.preventDefault();

return true;
      },
    }}});

    editor.registerPlugin(plugin,(added,plugins)=>[added,...plugins]);
    // React atom views stop ProseMirror's contextmenu dispatch; listen on the editor DOM as well.
    const dom=editor.view.dom,context=(event:MouseEvent)=>{handler.current(event);};

dom.addEventListener('contextmenu',context);

    return()=>{editor.unregisterPlugin(key);dom.removeEventListener('contextmenu',context);editingChanged.current(false);};
  },[editor]);
  useEffect(()=>{if(menu)content.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();},[menu,page]);

  async function paste(){
    if(!menu)return;const target=menu;

    try{
      const text=await navigator.clipboard.readText();

      if(active.current!==target)return;

      if(!restore(target))return;
      const lines=text.replace(/\r\n?/g,'\n').split('\n');

      const content:RichNode|RichNode[]=lines.length===1?{type:'text',text}:lines.map(line=>{const paragraph:RichNode={type:'paragraph'};

if(line)paragraph.content=[{type:'text',text:line}];

return paragraph;});

      if(text)run(chain=>chain.insertContentAt(target.selection.from,content));else close(true);
    }catch{close(true);setNotice('클립보드 권한을 확인하거나 Ctrl/Cmd+V를 사용하세요.');}
  }

  const paragraphs:Action[]=[
    {label:'일반 문단',icon:Type,apply:c=>c.setParagraph()},
    {label:'제목 1',icon:Heading1,apply:c=>c.setHeading({level:1})},
    {label:'제목 2',icon:Heading2,apply:c=>c.setHeading({level:2})},
    {label:'제목 3',icon:Heading3,apply:c=>c.setHeading({level:3})},
    {label:'글머리 목록',icon:List,apply:c=>c.toggleBulletList()},
    {label:'번호 목록',icon:ListOrdered,apply:c=>c.toggleOrderedList()},
    ...(editor.schema.nodes.taskList?[{label:'체크리스트',icon:ListChecks,apply:(c:ChainedCommands)=>c.toggleTaskList()}]:[]),
    {label:'인용',icon:Quote,apply:c=>c.toggleBlockquote()},
  ];

  const tables:Action[]=[
    {label:'위에 행 추가',icon:Table2,apply:c=>c.addRowBefore()},
    {label:'아래에 행 추가',icon:Table2,apply:c=>c.addRowAfter()},
    {label:'왼쪽 열 추가',icon:Table2,apply:c=>c.addColumnBefore()},
    {label:'오른쪽 열 추가',icon:Table2,apply:c=>c.addColumnAfter()},
    {label:'행 삭제',icon:Trash2,apply:c=>c.deleteRow()},
    {label:'열 삭제',icon:Trash2,apply:c=>c.deleteColumn()},
    {label:'셀 병합',icon:Table2,apply:c=>c.mergeCells()},
    {label:'셀 나누기',icon:Table2,apply:c=>c.splitCell()},
    {label:'제목 행 전환',icon:Table2,apply:c=>c.toggleHeaderRow()},
    {label:'표 삭제',icon:Trash2,apply:c=>c.deleteTable()},
  ];

  const label=menu?.kind==='table'?'표 메뉴':menu?.kind==='footnote'?'각주 메뉴':menu?.kind==='reference'?'참조 메뉴':menu?.kind==='web-link'?'웹 링크 메뉴':'문단 메뉴';
  const actionButton=(action:Action)=><button type="button" role="menuitem" className="menu-item" key={action.label} disabled={!menu||!current(menu)||!action.apply(editor.can().chain()).run()} onClick={()=>run(action.apply)}><action.icon size={15}/>{action.label}</button>;

  return <>
    {notice&&<p className="note-command-notice" role="status">{notice}</p>}
    <Popup.Root open={!!menu} onOpenChange={open=>{if(!open)close();}}><Popup.Anchor virtualRef={anchor}/><Popup.Portal>
      <Popup.Content ref={content} className="menu note-command-menu editor-position-menu" side="bottom" align="start" sideOffset={6} collisionPadding={12} aria-label={label} onEscapeKeyDown={()=>close(true)} onCloseAutoFocus={event=>{event.preventDefault();const action=pending.current;pending.current=null;

if(action&&!editor.isDestroyed){editor.view.focus();action();}}}>
        <div role="menu" aria-label={label} onKeyDown={event=>{
          const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')),index=buttons.findIndex(button=>button===document.activeElement);

          if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowUp'?-1:1)+buttons.length)%buttons.length]?.focus();}

          if(event.key==='Tab')close();
        }}>
          {menu?.kind==='paragraph'&&<>
            {page!=='root'&&<><button type="button" role="menuitem" className="menu-item" onClick={()=>setPage('root')}><ArrowLeft size={15}/>뒤로</button><div className="menu-separator"/></>}
            {page==='root'&&<><button type="button" role="menuitem" className="menu-item" onClick={()=>setPage('paragraph')}><Type size={15}/>문단 스타일<ChevronRight size={15}/></button><button type="button" role="menuitem" className="menu-item" onClick={()=>setPage('insert')}><Plus size={15}/>삽입<ChevronRight size={15}/></button><div className="menu-separator"/><button type="button" role="menuitem" className="menu-item" onClick={()=>void paste()}><Clipboard size={15}/>붙여넣기</button></>}
            {page==='paragraph'&&paragraphs.map(actionButton)}
            {page==='insert'&&<>
              {actionButton({label:'표 삽입',icon:Table2,apply:c=>c.insertTable({rows:3,cols:3,withHeaderRow:true})})}
              {actionButton({label:'구분선',icon:Minus,apply:c=>c.setHorizontalRule()})}
              <button type="button" role="menuitem" className="menu-item" onClick={()=>next(onFootnote)}><MessageSquareText size={15}/>각주 추가</button>
              <button type="button" role="menuitem" className="menu-item" onClick={()=>next(()=>requestWebLink(editor))}><Globe size={15}/>웹 링크</button>
              <button type="button" role="menuitem" className="menu-item" onClick={()=>next(onLink)}><Link2 size={15}/>{note?'노트 링크 추가':'설정 링크 추가'}</button>
              {onImage&&<button type="button" role="menuitem" className="menu-item" onClick={()=>{if(menu&&restore(menu)){close(true);onImage();}}}><ImagePlus size={15}/>이미지</button>}
            </>}
          </>}
          {menu?.kind==='table'&&tables.map(actionButton)}
          {menu?.kind==='footnote'&&<><button type="button" role="menuitem" className="menu-item" onClick={()=>{const id=menu.id;next(()=>{onEditing(true);setEditing(id);});}}><MessageSquareText size={15}/>각주 수정</button>{actionButton({label:'각주 삭제',icon:Trash2,apply:c=>c.deleteRange({from:menu.pos,to:menu.pos+1})})}</>}
          {menu?.kind==='web-link'&&<>
            <button type="button" role="menuitem" className="menu-item" onClick={()=>next(()=>requestWebLink(editor))}><Globe size={15}/>웹 링크 수정</button>
            <button type="button" role="menuitem" className="menu-item" disabled={!normalizeWebLink(menu.href)} onClick={()=>{const href=normalizeWebLink(menu.href);

if(href)window.open(href,'_blank','noopener,noreferrer');close(true);}}><ExternalLink size={15}/>새 탭에서 열기</button>
            {actionButton({label:'링크 해제',icon:Unlink,apply:c=>c.setTextSelection({from:menu.pos,to:menu.to}).unsetLink()})}
          </>}
          {menu?.kind==='reference'&&<><button type="button" role="menuitem" className="menu-item" disabled={!onReference} onClick={()=>{const ref=menu.reference;next(()=>onReference?.(ref));}}><Link2 size={15}/>미리보기</button>{actionButton({label:'참조 제거',icon:Trash2,apply:c=>c.deleteRange({from:menu.pos,to:menu.pos+1})})}</>}
        </div>
      </Popup.Content>
    </Popup.Portal></Popup.Root>
    {editing&&<EditorFootnotePopover key={editing} editor={editor} id={editing} readonly={false} initialEditing onClose={()=>{setEditing(null);onEditing(false);}} onStay={()=>{}} onLeave={()=>{}} onEditing={onEditing}/>}
  </>;
}
