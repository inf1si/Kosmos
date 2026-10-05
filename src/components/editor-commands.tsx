'use client';
import { useEffect,useId,useRef,useState } from 'react';
import type { Editor } from '@tiptap/core';
import { Plugin,PluginKey } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { DOMSerializer } from '@tiptap/pm/model';
import * as Popup from '@radix-ui/react-popover';
import { Heading1,Heading2,Heading3,MessageSquareText,List,ListOrdered,ListChecks,Table2,ImagePlus,Link2,Sparkles,Quote,Minus,Type,Copy,Scissors,Clipboard } from 'lucide-react';
import type { EditorAIScope } from '@/lib/ai-conversation';
import { captureEditorTarget,targetIsCurrent,type EditorTarget } from '@/lib/editor-target';
import { EditorInlineAI,editorAIActions,type EditorAIAction } from './editor-inline-ai';

const commandItems=[
  {id:'paragraph',label:'일반 문단',words:'텍스트 text paragraph',icon:Type},
  {id:'h1',label:'제목 1',words:'heading h1',icon:Heading1},
  {id:'h2',label:'제목 2',words:'heading h2',icon:Heading2},
  {id:'h3',label:'제목 3',words:'heading h3',icon:Heading3},
  {id:'bullet',label:'글머리 목록',words:'리스트 bullet list',icon:List},
  {id:'ordered',label:'번호 목록',words:'리스트 ordered list',icon:ListOrdered},
  {id:'task',label:'체크리스트',words:'체크 할일 checklist todo',icon:ListChecks},
  {id:'quote',label:'인용',words:'quote',icon:Quote},
  {id:'table',label:'표',words:'table',icon:Table2},
  {id:'rule',label:'구분선',words:'divider',icon:Minus},
  {id:'image',label:'이미지',words:'사진 image',icon:ImagePlus},
  {id:'link',label:'노트 링크',words:'연결 link',icon:Link2},
  {id:'footnote',label:'각주',words:'주석 footnote',icon:MessageSquareText},
  {id:'ai',label:'AI 질문',words:'질문 chat',icon:Sparkles},
];
type Slash={from:number;to:number;query:string};
type Panel={kind:'ai';target:EditorTarget;action:EditorAIAction}|{kind:'context';target:EditorTarget;x:number;y:number}|null;
const key=new PluginKey('editorCommands');
export function EditorCommands({editor,scope,onLink,onFootnote,onImage,onContinue}:{editor:Editor;scope:EditorAIScope;onLink:()=>void;onFootnote:()=>void;onImage?:()=>void;onContinue:()=>void}){
  const listId=useId(),menuLabel=scope.noteId?'노트 입력 명령':'문서 입력 명령';
  const [slash,setSlash]=useState<Slash|null>(null),[index,setIndex]=useState(0),[panel,setPanel]=useState<Panel>(null),[notice,setNotice]=useState('');
  const hasPanel=useRef(false);hasPanel.current=!!panel;
  const popup=useRef<HTMLDivElement>(null),dismissed=useRef<number|null>(null),handlers=useRef<{key:(event:KeyboardEvent)=>boolean;context:(event:MouseEvent)=>boolean}>({key:()=>false,context:()=>false});
  const available=commandItems.filter(item=>(item.id!=='task'||!!editor.schema.nodes.taskList)&&(item.id!=='image'||!!onImage)).map(item=>item.id==='link'&&!scope.noteId?{...item,label:'설정 링크'}:item);
  const filtered=slash?available.filter(item=>`${item.label} ${item.words}`.toLowerCase().includes(slash.query.trim().toLowerCase())):[];
  const chosen=Math.min(index,Math.max(0,filtered.length-1));
  function close(restore=true){
    if(slash)dismissed.current=slash.from;setSlash(null);setPanel(null);
    if(restore&&!editor.isDestroyed)editor.view.focus();
  }
  function openAI(action:EditorAIAction,target?:EditorTarget){
    try{setSlash(null);setPanel({kind:'ai',target:target||captureEditorTarget(editor),action});setNotice('');}catch(e){setNotice(e instanceof Error?e.message:'글을 선택하세요.');}
  }
  function command(id:string){
    if(!slash||!editor.isEditable)return;
    if(slash.to>editor.state.doc.content.size||editor.state.doc.textBetween(slash.from,slash.to)!==`/${slash.query}`){close();return;}
    const chain=editor.chain().focus().setTextSelection(slash.to).command(({tr})=>{closeHistory(tr);return true;});
    const insertsBlock=id==='table'||id==='rule';
    if(insertsBlock)chain.deleteRange({from:slash.from,to:slash.to});
    switch(id){
      case 'paragraph':chain.setParagraph();break;
      case 'h1':chain.setHeading({level:1});break;
      case 'h2':chain.setHeading({level:2});break;
      case 'h3':chain.setHeading({level:3});break;
      case 'bullet':chain.toggleBulletList();break;
      case 'ordered':chain.toggleOrderedList();break;
      case 'task':chain.toggleTaskList();break;
      case 'quote':chain.toggleBlockquote();break;
      case 'table':chain.insertTable({rows:3,cols:3,withHeaderRow:true});break;
      case 'rule':chain.setHorizontalRule();break;
    }
    // List lifting uses its transaction mapping; remove the query after formatting to avoid mapping it twice.
    if(!insertsBlock)chain.command(({tr})=>{tr.delete(tr.mapping.map(slash.from),tr.mapping.map(slash.to));return true;});
    chain.run();
    editor.view.dispatch(closeHistory(editor.state.tr));setSlash(null);dismissed.current=null;
    if(id==='ai')openAI('ask');else if(id==='link')onLink();else if(id==='footnote')onFootnote();else if(id==='image')onImage?.();
  }
  handlers.current={
    key:event=>{
      if(event.isComposing||editor.view.composing||!editor.isEditable)return false;
      if(event.altKey&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&event.key==='Enter'){openAI('ask');return true;}
      if(event.key==='Escape'&&panel){close();return true;}
      // Unmatched prose keeps ordinary arrows/Escape.
      if(!slash||!filtered.length)return false;
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){setIndex(v=>(v+(event.key==='ArrowDown'?1:-1)+Math.max(filtered.length,1))%Math.max(filtered.length,1));return true;}
      if(event.key==='Enter'){command(filtered[chosen].id);return true;}
      if(event.key==='Escape'){close();return true;}
      if(event.key==='Tab')close(false);
      return false;
    },
    context:event=>{
      if(!editor.isEditable)return false;
      const target=captureEditorTarget(editor);if(target.kind!=='selection')return false;
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
      const offset=before.lastIndexOf('/'),query=before.slice(offset+1),prefix=before.slice(0,offset);
      // UTF-16/leaf placeholders keep the absolute range correct across marks and inline atoms.
      // URL/path slashes stay literal; a slash after ordinary text needs no leading space.
      const token=prefix.match(/\S*$/)?.[0]||'';
      // Read both sides of a numeric slash, including when the caret is just before its denominator.
      const numericSlash=offset>=0&&/\p{Nd}\s*$/u.test(prefix)&&/^\s*\p{Nd}/u.test($from.parent.textBetween(offset+1,$from.parent.content.size,'','\ufffc'));
      if(offset<0||numericSlash||!/^[^/\n\ufffc]{0,40}$/.test(query)||token.includes('/')||/^(?:[a-z][a-z\d+.-]*:|www\.)/i.test(token)){dismissed.current=null;setSlash(null);return;}
      const trigger=$from.start()+offset;
      if(dismissed.current===trigger)return;
      setSlash(old=>{const next={from:trigger,to:from,query};if(old?.query!==next.query)setIndex(0);return next;});
    };
    const blur=()=>setSlash(null);editor.on('transaction',update);editor.on('focus',update);editor.on('blur',blur);
    return()=>{editor.unregisterPlugin(key);editor.off('transaction',update);editor.off('focus',update);editor.off('blur',blur);};
  },[editor]);
  useEffect(()=>{popup.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'});},[chosen]);
  useEffect(()=>{
    const dom=editor.view.dom;
    if(slash&&filtered.length){dom.setAttribute('aria-controls',listId);dom.setAttribute('aria-activedescendant',`${listId}-${filtered[chosen].id}`);}
    else{dom.removeAttribute('aria-controls');dom.removeAttribute('aria-activedescendant');}
    return()=>{dom.removeAttribute('aria-controls');dom.removeAttribute('aria-activedescendant');};
  },[editor,slash,filtered,chosen,listId]);
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
        // One line stays inside the current paragraph; JSON nodes never parse clipboard text as HTML.
        const lines=text.replace(/\r\n?/g,'\n').split('\n');
        if(text)editor.chain().focus().insertContentAt({from:target.from,to:target.to},lines.length===1?{type:'text',text}:lines.map(line=>({type:'paragraph',...(line?{content:[{type:'text',text:line}]}:{})}))).run();
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
    <Popup.Root open={(!!slash&&filtered.length>0)||!!panel} onOpenChange={open=>{if(!open)close(false);}}>
      <Popup.Anchor virtualRef={anchor}/><Popup.Portal><Popup.Content ref={popup} className={panel?.kind==='ai'?'popover note-ai-popover':'menu note-command-menu'} side="bottom" align="start" sideOffset={6} collisionPadding={12} aria-label={panel?.kind==='ai'?'AI 질문':panel?.kind==='context'?'선택한 글 메뉴':menuLabel} onKeyDown={event=>{const dialog=(event.target as HTMLElement).closest('[role=dialog]');if(event.key==='Escape'&&(!dialog||dialog===popup.current)){event.preventDefault();event.stopPropagation();close();}}} onOpenAutoFocus={event=>{if(slash)event.preventDefault();}} onFocusOutside={event=>{if((slash||panel?.kind==='ai')&&editor.view.dom.contains(event.target as globalThis.Node))event.preventDefault();}} onCloseAutoFocus={event=>{event.preventDefault();if(!editor.isDestroyed&&document.activeElement===document.body)editor.view.focus();}} onInteractOutside={event=>{if(panel?.kind==='ai'&&(editor.view.dom.contains(event.target as globalThis.Node)||(event.target as HTMLElement)?.closest('[role=dialog]')))event.preventDefault();}} onEscapeKeyDown={()=>{if(slash)dismissed.current=slash.from;}}>
        {slash&&filtered.length>0&&<><div className="note-command-caption">입력 명령 <kbd>↑↓ 선택 · Enter 실행</kbd></div><div role="listbox" id={listId} aria-label={menuLabel}>{filtered.map((item,i)=><button type="button" role="option" tabIndex={-1} aria-selected={chosen===i} id={`${listId}-${item.id}`} className="menu-item" data-highlighted={chosen===i?'':undefined} key={item.id} onPointerMove={()=>setIndex(i)} onMouseDown={e=>e.preventDefault()} onClick={()=>command(item.id)}><item.icon size={15}/>{item.label}{item.id==='ai'&&<kbd>Alt+Enter</kbd>}</button>)}</div></>}
        {panel?.kind==='context'&&<div role="menu" aria-label="선택한 글 메뉴" onKeyDown={e=>{const buttons=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'));if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const i=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}}}>{editorAIActions.map(action=><button className="menu-item" role="menuitem" key={action.id} onClick={()=>openAI(action.id,panel.target)}><Sparkles size={15}/>{action.label}</button>)}<div className="menu-separator"/>{([{id:'copy',label:'복사',icon:Copy},{id:'cut',label:'잘라내기',icon:Scissors},{id:'paste',label:'붙여넣기',icon:Clipboard}] as const).map(item=><button className="menu-item" role="menuitem" key={item.id} onClick={()=>void clipboard(item.id)}><item.icon size={15}/>{item.label}</button>)}</div>}
        {panel?.kind==='ai'&&<EditorInlineAI key={`${scope.docId}-${panel.action}-${panel.target.from}-${panel.target.to}`} editor={editor} scope={scope} target={panel.target} action={panel.action} onClose={()=>close()} onContinue={()=>{close(false);onContinue();}}/>}
      </Popup.Content></Popup.Portal>
    </Popup.Root>
  </>;
}
