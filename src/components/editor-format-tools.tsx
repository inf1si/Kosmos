'use client';

import type { RichAttributes } from '@/lib/model';
import { useEffect,useRef,useState } from 'react';
import type { Editor } from '@tiptap/core';
import type { ResolvedPos } from '@tiptap/pm/model';
import { AlignLeft,AlignCenter,AlignRight,AlignJustify,IndentIncrease,IndentDecrease,List,ChevronDown,Pilcrow,Table2,Type,Strikethrough,Superscript,Subscript,Highlighter,RemoveFormatting,Omega } from 'lucide-react';
import { IconButton,Popover } from './primitives';
import { fontSizes,validFontSize } from '@/lib/editor-preferences';
import { inlineFontSize,bulletListStyles,orderedListStyles,listStyleType } from '@/lib/manuscript-format';
import styles from './editor-tools.module.css';

/** The size of the selected text: a number when it is all one size, null when sizes are mixed, undefined when none is set. */
function selectedFontSize(editor:Editor){
  const {from,to}=editor.state.selection,sizes=new Set<number|undefined>();
  editor.state.doc.nodesBetween(from,to,node=>{if(node.isText)sizes.add(inlineFontSize(node.marks.find(m=>m.type.name==='fontSize')?.attrs.size));});

  return sizes.size>1?null:[...sizes][0];
}

/** With text selected the size applies to that text only; with nothing selected it is this device's manuscript display size. */
export function FontSizeControl({editor,readonly,size,onBaseChange}:{editor:Editor|null;readonly:boolean;size:number;onBaseChange:(size:number)=>void}){
  const ranged=!!editor&&!readonly&&!editor.state.selection.empty;
  const selected=ranged?selectedFontSize(editor):undefined,shown=selected===null?null:selected??size;
  const [value,setValue]=useState(shown===null?'':String(shown)),[open,setOpen]=useState(false),listRef=useRef<HTMLDivElement>(null);
  useEffect(()=>setValue(shown===null?'':String(shown)),[shown]);
  useEffect(()=>{if(open)requestAnimationFrame(()=>{const current=listRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');current?.scrollIntoView({block:'center'});current?.focus();});},[open]);

  function apply(n:number|null){
    if(ranged&&editor){const chain=editor.chain().focus();(n===null?chain.unsetMark('fontSize'):chain.setMark('fontSize',{size:n})).run();}
    else if(n!==null)onBaseChange(n);
  }

  function commit(){const n=Number(value);

if(value.trim()&&validFontSize(n)){if(n!==shown)apply(n);}else setValue(shown===null?'':String(shown));}

  const label=ranged?'선택한 글자 크기':'본문 크기';

  return <span className={styles.size}>
    <input aria-label={label} title={ranged?'선택한 글자 크기 · 10–72px':'본문 크기 · 이 기기의 원고 표시 설정 · 10–72px'} inputMode="decimal" placeholder={shown===null?'–':undefined} value={value} onChange={e=>setValue(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();commit();

if(!ranged)e.currentTarget.blur();}else if(e.key==='Escape')setValue(shown===null?'':String(shown));}}/><span>px</span>
    <Popover open={open} onOpenChange={setOpen} width={208} title={label} description={ranged?'선택한 부분에만 적용합니다.':'글자를 선택하지 않으면 원고 전체의 표시 크기를 바꿉니다.'} onReturnFocus={()=>editor?.commands.focus()} trigger={<IconButton label="글자 크기 목록" className={`icon-button ${styles.sizeToggle}`} aria-pressed={open}><ChevronDown size={14}/></IconButton>}>
      <div className={styles.sizeList} ref={listRef}>{fontSizes.map(n=><button key={n} type="button" aria-pressed={n===shown} onClick={()=>{apply(n);setOpen(false);}}>{n}<span>px</span></button>)}</div>
      {ranged&&<div className="popover-actions"><button type="button" className="button" disabled={selected===undefined} onClick={()=>{apply(null);setOpen(false);}}>기본 크기로</button></div>}
    </Popover>
  </span>;
}

type ListType='bulletList'|'orderedList';

/** The list that holds the cursor, and the marker it shows. Nested bullet lists default to 빈 원, then 네모. */
function currentList($from:ResolvedPos):{type:ListType;depth:number;style:string;fallback:string}|null{
  for(let d=$from.depth;d>0;d--){const node=$from.node(d),type=node.type.name;

if(type!=='bulletList'&&type!=='orderedList')continue;
    let nested=0;

for(let a=d-1;a>0;a--)if($from.node(a).type.name==='bulletList')nested++;
    const fallback=type==='bulletList'?['disc','circle','square'][Math.min(nested,2)]:'decimal';

    return {type,depth:d,style:listStyleType({type,attrs:node.attrs})??fallback,fallback};}

  return null;
}

export function ListMenu({editor,readonly}:{editor:Editor|null;readonly:boolean}){
  const [open,setOpen]=useState(false);
  const current=editor?currentList(editor.state.selection.$from):null;

  function choose(type:ListType,style:string){
    if(!editor||readonly)return;let chain=editor.chain().focus();

    if(!current)chain=type==='bulletList'?chain.toggleBulletList():chain.toggleOrderedList();
    chain.command(({tr,state})=>{const list=currentList(tr.selection.$from);

if(!list)return false;const pos=tr.selection.$from.before(list.depth),node=tr.doc.nodeAt(pos);

if(!node)return false;
      // The default marker is stored as null so the nesting rules above still apply; the HTML type of pasted lists gives way.
      const attributes:RichAttributes=node.type.name===type?{...node.attrs}:{};
      attributes.listStyle=style===(list.type===type?list.fallback:type==='bulletList'?'disc':'decimal')?null:style;

      if(type==='orderedList')attributes.type=null;
      tr.setNodeMarkup(pos,state.schema.nodes[type],attributes);

return true;}).run();
    setOpen(false);
  }

  return <Popover open={open} onOpenChange={setOpen} title="목록" width={312} onReturnFocus={()=>editor?.commands.focus()} trigger={<IconButton label="목록" disabled={!editor||readonly} aria-pressed={open}><List size={16}/></IconButton>}>
    <div className={styles.tools}>
      {([['bulletList','글머리 기호',bulletListStyles],['orderedList','번호',orderedListStyles]] as const).map(([type,name,options])=><div key={type}>
        <p className={styles.group}>{name}</p>
        <div className={styles.listStyles}>{options.map(o=><button key={o.id} type="button" className={`button ${styles.listOption}`} aria-label={`${o.label} ${type==='bulletList'?'글머리 기호':'번호 목록'}`} aria-pressed={current?.type===type&&current.style===o.id} onClick={()=>choose(type,o.id)}><span aria-hidden="true">{o.marker}</span>{o.label}</button>)}</div>
      </div>)}
      {current&&<div className="popover-actions"><button type="button" className="button" onClick={()=>{if(!editor)return;const chain=editor.chain().focus();(current.type==='bulletList'?chain.toggleBulletList():chain.toggleOrderedList()).run();setOpen(false);}}>목록 해제</button></div>}
    </div>
  </Popover>;
}

const symbols=[{name:'문장 부호',characters:['“','”','‘','’','「','」','『','』','〈','〉','《','》','…','—','–','·','※']},{name:'SF · 수학',characters:['±','×','÷','≠','≤','≥','≈','∞','√','∑','∫','°','℃','α','β','γ','δ','λ','μ','π','Ω']},{name:'화살표 · 기호',characters:['←','→','↑','↓','↔','⇒','⇔','☐','☑','○','●','◇','◆','☆','★']}];

export function EditorFormatTools({editor,readonly}:{editor:Editor|null;readonly:boolean}){
  const [panel,setPanel]=useState<string|null>(null),[rows,setRows]=useState(3),[cols,setCols]=useState(3),[header,setHeader]=useState(true);
  const disabled=!editor||readonly;
  const attrs=editor?.getAttributes(editor.isActive('heading')?'heading':'paragraph')||{};

  function paragraph(patch:RichAttributes){if(!editor||readonly)return;editor.chain().focus().updateAttributes('paragraph',patch).updateAttributes('heading',patch).run();setPanel(null);}

  function indent(direction:number){if(!editor||readonly)return;

if(editor.isActive('listItem')){const chain=editor.chain().focus();

if(direction>0)chain.sinkListItem('listItem').run();else chain.liftListItem('listItem').run();}else paragraph({indent:Math.max(0,Math.min(8,Number(attrs.indent||0)+direction))});}

  const buttons=[{id:'marks',label:'문자 서식',icon:<Type size={16}/>},{id:'paragraph',label:'문단 서식',icon:<Pilcrow size={16}/>},{id:'table',label:'표',icon:<Table2 size={16}/>},{id:'symbols',label:'특수문자',icon:<Omega size={16}/>}];
  const actions=[['위에 행 추가',()=>editor?.chain().focus().addRowBefore().run(),()=>editor?.can().addRowBefore()],['아래에 행 추가',()=>editor?.chain().focus().addRowAfter().run(),()=>editor?.can().addRowAfter()],['왼쪽 열 추가',()=>editor?.chain().focus().addColumnBefore().run(),()=>editor?.can().addColumnBefore()],['오른쪽 열 추가',()=>editor?.chain().focus().addColumnAfter().run(),()=>editor?.can().addColumnAfter()],['행 삭제',()=>editor?.chain().focus().deleteRow().run(),()=>editor?.can().deleteRow()],['열 삭제',()=>editor?.chain().focus().deleteColumn().run(),()=>editor?.can().deleteColumn()],['셀 병합',()=>editor?.chain().focus().mergeCells().run(),()=>editor?.can().mergeCells()],['셀 나누기',()=>editor?.chain().focus().splitCell().run(),()=>editor?.can().splitCell()],['제목 행 전환',()=>editor?.chain().focus().toggleHeaderRow().run(),()=>editor?.can().toggleHeaderRow()],['표 삭제',()=>editor?.chain().focus().deleteTable().run(),()=>editor?.can().deleteTable()]] as const;

  return <><select aria-label="문단 스타일" value={editor?.isActive('heading')?String(editor.getAttributes('heading').level):'body'} disabled={disabled} onChange={e=>{if(e.target.value==='body')editor?.chain().focus().setParagraph().run();else{const level=Number(e.target.value);

if(level===1||level===2||level===3)editor?.chain().focus().setHeading({level}).run();}}}><option value="body">본문</option>{[1,2,3].map(level=><option key={level} value={level}>제목 {level}</option>)}</select>{buttons.map(item=><Popover key={item.id} open={panel===item.id} onOpenChange={open=>setPanel(open?item.id:null)} title={item.label} initialFocus={['marks','paragraph'].includes(item.id)?'content':undefined} width={item.id==='symbols'?340:300} onReturnFocus={()=>editor?.commands.focus()} trigger={<IconButton label={item.label} disabled={disabled} aria-pressed={panel===item.id}>{item.icon}</IconButton>}>
    <div className={styles.tools}>
    {item.id==='marks'&&<div className={styles.row}>
      <IconButton label="취소선" aria-pressed={editor?.isActive('strike')} onClick={()=>{editor?.chain().focus().toggleStrike().run();setPanel(null);}}><Strikethrough size={16}/></IconButton>
      <IconButton label="위첨자" aria-pressed={editor?.isActive('superscript')} onClick={()=>{editor?.chain().focus().toggleSuperscript().run();setPanel(null);}}><Superscript size={16}/></IconButton>
      <IconButton label="아래첨자" aria-pressed={editor?.isActive('subscript')} onClick={()=>{editor?.chain().focus().toggleSubscript().run();setPanel(null);}}><Subscript size={16}/></IconButton>
      <IconButton label="강조 표시" aria-pressed={editor?.isActive('highlight')} onClick={()=>{editor?.chain().focus().toggleHighlight().run();setPanel(null);}}><Highlighter size={16}/></IconButton>
      <IconButton label="문자 서식 지우기" onClick={()=>{let chain=editor?.chain().focus();

for(const name of ['bold','italic','underline','strike','code','superscript','subscript','highlight','fontSize'])chain=chain?.unsetMark(name);chain?.run();setPanel(null);}}><RemoveFormatting size={16}/></IconButton>
    </div>}
    {item.id==='paragraph'&&<><div className={styles.row}>{[{name:'왼쪽 정렬',value:'left',icon:<AlignLeft size={16}/>},{name:'가운데 정렬',value:'center',icon:<AlignCenter size={16}/>},{name:'오른쪽 정렬',value:'right',icon:<AlignRight size={16}/>},{name:'양쪽 정렬',value:'justify',icon:<AlignJustify size={16}/>}].map(align=><IconButton key={align.value} label={align.name} aria-pressed={editor?.isActive({textAlign:align.value})} onClick={()=>paragraph({textAlign:align.value})}>{align.icon}</IconButton>)}<IconButton label="들여쓰기" onClick={()=>indent(1)}><IndentIncrease size={16}/></IconButton><IconButton label="내어쓰기" onClick={()=>indent(-1)}><IndentDecrease size={16}/></IconButton></div>
      <label>줄간격<select aria-label="줄간격" value={attrs.lineHeight??'default'} onChange={e=>paragraph({lineHeight:e.target.value==='default'?null:Number(e.target.value)})}><option value="default">기본 · 2배</option>{[1,1.15,1.3,1.5,1.75,2,2.25,2.5,3].map(n=><option key={n} value={n}>{n}배</option>)}</select></label>
      <label>첫 줄 들여쓰기<select aria-label="첫 줄 들여쓰기" value={attrs.firstLineIndent??'default'} onChange={e=>paragraph({firstLineIndent:e.target.value==='default'?null:Number(e.target.value)})}><option value="default">기본</option>{[0,1,2,3,4].map(n=><option key={n} value={n}>{n}자</option>)}</select></label>
      <div className={styles.grid}>{[['문단 앞 간격','spaceBefore'],['문단 뒤 간격','spaceAfter']].map(([label,key])=><label key={key}>{label}<select aria-label={label} value={attrs[key]??'default'} onChange={e=>paragraph({[key]:e.target.value==='default'?null:Number(e.target.value)})}><option value="default">기본</option>{[0,4,8,12,16,24,36,48].map(n=><option key={n} value={n}>{n}px</option>)}</select></label>)}</div><button className="button" onClick={()=>paragraph({lineHeight:null,indent:null,firstLineIndent:null,spaceBefore:null,spaceAfter:null,textAlign:null})}>문단 서식 초기화</button></>}
    {item.id==='table'&&(editor?.isActive('table')?<div className={styles.actions}>{actions.map(([label,run,can])=><button key={label} className="button" disabled={!can()} onClick={()=>{run();setPanel(null);}}>{label}</button>)}</div>:<form onSubmit={e=>{e.preventDefault();

if(!editor||readonly||!Number.isInteger(rows)||!Number.isInteger(cols)||rows<1||rows>20||cols<1||cols>12)return;editor.chain().focus().insertTable({rows,cols,withHeaderRow:header}).run();setPanel(null);}}><div className={styles.grid}><label>행<input aria-label="표 행 수" type="number" value={rows} min={1} max={20} onChange={e=>setRows(Number(e.target.value))}/></label><label>열<input aria-label="표 열 수" type="number" value={cols} min={1} max={12} onChange={e=>setCols(Number(e.target.value))}/></label></div><label className={styles.check}><input type="checkbox" checked={header} onChange={e=>setHeader(e.target.checked)}/>제목 행</label><div className="popover-actions"><button className="button" type="submit">표 삽입</button></div></form>)}
    {item.id==='symbols'&&symbols.map(group=><div key={group.name}><p className={styles.group}>{group.name}</p><div className={styles.symbols}>{group.characters.map(char=><button key={char} className="button" aria-label={`특수문자 ${char}`} onClick={()=>{if(!editor||readonly)return;editor.view.dispatch(editor.state.tr.insertText(char));setPanel(null);}}>{char}</button>)}</div></div>)}
    </div>
  </Popover>)}</>;
}
