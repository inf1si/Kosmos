'use client';
import { useEffect,useRef,useState } from 'react';
import type { Editor } from '@tiptap/core';
import { Plugin,PluginKey } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { DOMSerializer } from '@tiptap/pm/model';
import * as Popup from '@radix-ui/react-popover';
import { Heading1,Heading2,List,ListOrdered,ListChecks,Table2,ImagePlus,Link2,Sparkles,Quote,Minus,Type,Copy,Scissors,Clipboard } from 'lucide-react';
import { captureNoteTarget,targetIsCurrent,type NoteTarget } from '@/lib/note-editor-target';
import { NoteInlineAI,noteAIActions,type NoteAIAction } from './note-inline-ai';

const commandItems=[
  {id:'paragraph',label:'일반 문단',words:'텍스트 text paragraph',icon:Type},
  {id:'h1',label:'제목 1',words:'heading h1',icon:Heading1},
  {id:'h2',label:'제목 2',words:'heading h2',icon:Heading2},
  {id:'bullet',label:'글머리 목록',words:'리스트 bullet list',icon:List},
  {id:'ordered',label:'번호 목록',words:'리스트 ordered list',icon:ListOrdered},
  {id:'task',label:'체크리스트',words:'체크 할일 checklist todo',icon:ListChecks},
  {id:'quote',label:'인용',words:'quote',icon:Quote},
  {id:'table',label:'표',words:'table',icon:Table2},
  {id:'rule',label:'구분선',words:'divider',icon:Minus},
  {id:'image',label:'이미지',words:'사진 image',icon:ImagePlus},
  {id:'link',label:'노트 링크',words:'연결 link',icon:Link2},
  {id:'ai',label:'AI 질문',words:'질문 chat',icon:Sparkles},
];
type Slash={from:number;to:number;query:string};
type Panel={kind:'ai';target:NoteTarget;action:NoteAIAction}|{kind:'context';target:NoteTarget;x:number;y:number}|null;
const key=new PluginKey('noteEditorCommands');
export function NoteEditorCommands({editor,noteId,onLink,onImage,onContinue}:{editor:Editor;noteId:string;onLink:()=>void;onImage:()=>void;onContinue:()=>void}){
  const [slash,setSlash]=useState<Slash|null>(null),[index,setIndex]=useState(0),[panel,setPanel]=useState<Panel>(null),[notice,setNotice]=useState('');
  const hasPanel=useRef(false);hasPanel.current=!!panel;
  const popup=useRef<HTMLDivElement>(null),dismissed=useRef<number|null>(null),handlers=useRef<{key:(event:KeyboardEvent)=>boolean;context:(event:MouseEvent)=>boolean}>({key:()=>false,context:()=>false});
  const filtered=slash?commandItems.filter(item=>`${item.label} ${item.words}`.toLowerCase().includes(slash.query.trim().toLowerCase())):[];
  const chosen=Math.min(index,Math.max(0,filtered.length-1));
  function close(restore=true){
    if(slash)dismissed.current=slash.from;setSlash(null);setPanel(null);
    if(restore&&!editor.isDestroyed)editor.view.focus();
  }
  function openAI(action:NoteAIAction,target?:NoteTarget){
    try{setSlash(null);setPanel({kind:'ai',target:target||captureNoteTarget(editor),action});setNotice('');}catch(e){setNotice(e instanceof Error?e.message:'글을 선택하세요.');}
  }
  function command(id:string){
    if(!slash||!editor.isEditable)return;
    if(slash.to>editor.state.doc.content.size||editor.state.doc.textBetween(slash.from,slash.to)!==`/${slash.query}`){close();return;}
    const chain=editor.chain().focus().command(({tr})=>{closeHistory(tr);return true;}).deleteRange({from:slash.from,to:slash.to});
    switch(id){
      case 'paragraph':chain.setParagraph().run();break;
      case 'h1':chain.setHeading({level:1}).run();break;
      case 'h2':chain.setHeading({level:2}).run();break;
      case 'bullet':chain.toggleBulletList().run();break;
      case 'ordered':chain.toggleOrderedList().run();break;
      case 'task':chain.toggleTaskList().run();break;
      case 'quote':chain.toggleBlockquote().run();break;
      case 'table':chain.insertTable({rows:3,cols:3,withHeaderRow:true}).run();break;
      case 'rule':chain.setHorizontalRule().run();break;
      default:chain.run();
    }
    editor.view.dispatch(closeHistory(editor.state.tr));setSlash(null);dismissed.current=null;
    if(id==='ai')openAI('ask');else if(id==='link')onLink();else if(id==='image')onImage();
  }
  handlers.current={
    key:event=>{
      if(event.isComposing||editor.view.composing||!editor.isEditable)return false;
      if(event.altKey&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&event.key==='Enter'){openAI('ask');return true;}
      if(event.key==='Escape'&&panel){close();return true;}
      if(!slash)return false;
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){setIndex(v=>(v+(event.key==='ArrowDown'?1:-1)+Math.max(filtered.length,1))%Math.max(filtered.length,1));return true;}
      if(event.key==='Enter'){if(filtered[chosen]){command(filtered[chosen].id);return true;}close(false);return false;}
      if(event.key==='Escape'){close();return true;}
      if(event.key==='Tab')close(false);
      return false;
    },
    context:event=>{
      if(!editor.isEditable)return false;
      const target=captureNoteTarget(editor);if(target.kind!=='selection')return false;
      const pos=editor.view.posAtCoords({left:event.clientX,top:event.clientY})?.pos;
      const {from,to}=target;if(pos===undefined||pos<from||pos>to)return false;
      event.preventDefault();setSlash(null);setPanel({kind:'context',target,x:event.clientX,y:event.clientY});setNotice('');return true;
    },
  };
  useEffect(()=>{
    const plugin=new Plugin({key,props:{handleKeyDown:(_view,event)=>handlers.current.key(event),handleDOMEvents:{contextmenu:(_view,event)=>handlers.current.context(event)}}});
    editor.registerPlugin(plugin,(added,plugins)=>[added,...plugins]);
    const update=()=>{
      if(hasPanel.current||!editor.isEditable||!editor.isFocused||!editor.state.selection.empty){setSlash(null);return;}
      const {$from,from}=editor.state.selection;
      if(!['paragraph','heading'].includes($from.parent.type.name)){setSlash(null);return;}
      const before=$from.parent.textBetween(0,$from.parentOffset,'','\ufffc');
      if(!/^\/[^/\n]{0,40}$/.test(before)){dismissed.current=null;setSlash(null);return;}
      if(dismissed.current===$from.start())return;
      setSlash(old=>{const next={from:$from.start(),to:from,query:before.slice(1)};if(old?.query!==next.query)setIndex(0);return next;});
    };
    const blur=()=>setSlash(null);editor.on('transaction',update);editor.on('focus',update);editor.on('blur',blur);
    return()=>{editor.unregisterPlugin(key);editor.off('transaction',update);editor.off('focus',update);editor.off('blur',blur);};
  },[editor]);
  useEffect(()=>{popup.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'});},[chosen]);
  useEffect(()=>{
    const dom=editor.view.dom;
    if(slash){dom.setAttribute('aria-controls','note-slash-list');dom.setAttribute('aria-activedescendant',`note-command-${filtered[chosen]?.id||'empty'}`);}
    else{dom.removeAttribute('aria-controls');dom.removeAttribute('aria-activedescendant');}
    return()=>{dom.removeAttribute('aria-controls');dom.removeAttribute('aria-activedescendant');};
  },[editor,slash,filtered,chosen]);
  const anchor=useRef({getBoundingClientRect:()=>new DOMRect()});
  anchor.current.getBoundingClientRect=()=>{
    if(panel?.kind==='context')return new DOMRect(panel.x,panel.y,0,0);
    const pos=panel?.kind==='ai'?panel.target.cursor:slash?.to??editor.state.selection.to;
    try{const c=editor.view.coordsAtPos(pos);return new DOMRect(c.left,c.top,1,c.bottom-c.top);}catch{return editor.view.dom.getBoundingClientRect();}
  };
  async function clipboard(mode:'copy'|'cut'|'paste'){
    if(panel?.kind!=='context')return;
    const target=panel.target;
    try{
      if(mode==='paste'){
        const text=await navigator.clipboard.readText();if(editor.isDestroyed||!editor.isEditable)return;
        if(!targetIsCurrent(editor,target))throw new Error('글이 바뀌었습니다. 다시 선택하세요.');
        editor.chain().focus().setTextSelection({from:target.from,to:target.to}).insertContent(text.split('\n').map(line=>({type:'paragraph',content:line?[{type:'text',text:line}]:[]}))).run();
      }else{
        const container=document.createElement('div');container.append(DOMSerializer.fromSchema(editor.schema).serializeFragment(editor.state.doc.slice(target.from,target.to).content));
        await navigator.clipboard.write([new ClipboardItem({'text/plain':new Blob([target.text],{type:'text/plain'}),'text/html':new Blob([container.innerHTML],{type:'text/html'})})]);
        if(mode==='cut'&&targetIsCurrent(editor,target))editor.chain().focus().deleteRange({from:target.from,to:target.to}).run();
      }
      close();
    }catch{close();setNotice('클립보드 권한을 확인하거나 Ctrl/Cmd+C·X·V를 사용하세요.');}
  }
  return <>
    {notice&&<p className="note-command-notice" role="status">{notice}</p>}
    <Popup.Root open={!!slash||!!panel} onOpenChange={open=>{if(!open)close(false);}}>
      <Popup.Anchor virtualRef={anchor}/><Popup.Portal><Popup.Content ref={popup} className={panel?.kind==='ai'?'popover note-ai-popover':'menu note-command-menu'} side="bottom" align="start" sideOffset={6} collisionPadding={12} aria-label={panel?.kind==='ai'?'커서 AI':panel?.kind==='context'?'선택한 글 메뉴':'노트 입력 명령'} onKeyDown={event=>{const dialog=(event.target as HTMLElement).closest('[role=dialog]');if(event.key==='Escape'&&(!dialog||dialog===popup.current)){event.preventDefault();event.stopPropagation();close();}}} onOpenAutoFocus={event=>{if(slash)event.preventDefault();}} onFocusOutside={event=>{if((slash||panel?.kind==='ai')&&editor.view.dom.contains(event.target as globalThis.Node))event.preventDefault();}} onCloseAutoFocus={event=>{event.preventDefault();if(!editor.isDestroyed&&document.activeElement===document.body)editor.view.focus();}} onInteractOutside={event=>{if(panel?.kind==='ai'&&(editor.view.dom.contains(event.target as globalThis.Node)||(event.target as HTMLElement)?.closest('[role=dialog]')))event.preventDefault();}} onEscapeKeyDown={()=>{if(slash)dismissed.current=slash.from;}}>
        {slash&&<><div className="note-command-caption">입력 명령 <kbd>↑↓ 선택 · Enter 실행</kbd></div><div role="listbox" id="note-slash-list" aria-label="노트 입력 명령">{filtered.map((item,i)=><button type="button" role="option" tabIndex={-1} aria-selected={chosen===i} id={`note-command-${item.id}`} className="menu-item" data-highlighted={chosen===i?'':undefined} key={item.id} onPointerMove={()=>setIndex(i)} onMouseDown={e=>e.preventDefault()} onClick={()=>command(item.id)}><item.icon size={15}/>{item.label}{item.id==='ai'&&<kbd>Alt+Enter</kbd>}</button>)}{!filtered.length&&<p>일치하는 명령이 없습니다.</p>}</div></>}
        {panel?.kind==='context'&&<div role="menu" aria-label="선택한 글 메뉴" onKeyDown={e=>{const buttons=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'));if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const i=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}}}>{noteAIActions.map(action=><button className="menu-item" role="menuitem" key={action.id} onClick={()=>openAI(action.id,panel.target)}><Sparkles size={15}/>{action.label}</button>)}<div className="menu-separator"/>{([{id:'copy',label:'복사',icon:Copy},{id:'cut',label:'잘라내기',icon:Scissors},{id:'paste',label:'붙여넣기',icon:Clipboard}] as const).map(item=><button className="menu-item" role="menuitem" key={item.id} onClick={()=>void clipboard(item.id)}><item.icon size={15}/>{item.label}</button>)}</div>}
        {panel?.kind==='ai'&&<NoteInlineAI key={`${noteId}-${panel.action}-${panel.target.from}-${panel.target.to}`} editor={editor} noteId={noteId} target={panel.target} action={panel.action} onClose={()=>close()} onContinue={()=>{close(false);onContinue();}}/>}
      </Popup.Content></Popup.Portal>
    </Popup.Root>
  </>;
}
