'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

/** A free-text field whose menu also opens when its existing value is filled in. */
export function EditableCombobox({label,value,options,disabled,onChange}:{label:string;value:string;options:string[];disabled?:boolean;onChange:(value:string)=>void}){
  const id=useId();const root=useRef<HTMLDivElement>(null);const input=useRef<HTMLInputElement>(null);
  const [open,setOpen]=useState(false);const [filter,setFilter]=useState('');const [active,setActive]=useState(-1);
  const allChoices=[...new Set(options.map(o=>o.trim()).filter(Boolean))];const choices=allChoices.filter(o=>o.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  useEffect(()=>{if(open&&active>=0)root.current?.querySelector<HTMLElement>(`[id="${id}-choice-${active}"]`)?.scrollIntoView({block:'nearest'});},[open,active,id]);
  useEffect(()=>{if(!open)return;const dismiss=(e:PointerEvent)=>{if(!root.current?.contains(e.target instanceof Node?e.target:null))setOpen(false);};

document.addEventListener('pointerdown',dismiss);

return()=>document.removeEventListener('pointerdown',dismiss);},[open]);

  function choose(choice:string){onChange(choice);setOpen(false);setActive(-1);input.current?.focus();}

  return <div className="editable-combobox" ref={root} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOpen(false);}}>
    <label htmlFor={id}>{label}</label>
    <div className="combobox-field"><input ref={input} id={id} role="combobox" autoComplete="off" maxLength={200} value={value} disabled={disabled} aria-expanded={open} aria-controls={`${id}-choices`} aria-autocomplete="list" aria-activedescendant={open&&choices[active]?`${id}-choice-${active}`:undefined}
      onChange={e=>{onChange(e.target.value);setFilter(e.target.value);setActive(-1);setOpen(true);}}
      onKeyDown={e=>{if(e.key==='Escape'&&open){e.preventDefault();e.stopPropagation();setOpen(false);}else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();

if(!open){setFilter('');setOpen(true);setActive(e.key==='ArrowDown'?0:allChoices.length-1);}else setActive(v=>choices.length?(v<0?(e.key==='ArrowDown'?0:choices.length-1):(v+(e.key==='ArrowDown'?1:-1)+choices.length)%choices.length):-1);}else if(e.key==='Enter'&&open&&choices[active]){e.preventDefault();choose(choices[active]);}}}/>
      <button type="button" className="combobox-toggle" aria-label={`${label} 목록 ${open?'닫기':'열기'}`} aria-expanded={open} aria-controls={`${id}-choices`} disabled={disabled} onClick={()=>{setFilter('');setActive(-1);setOpen(v=>!v);input.current?.focus();}}><ChevronDown size={15}/></button>
    </div>
    {open&&!disabled&&<div className="combobox-menu"><div id={`${id}-choices`} role="listbox" aria-label={`${label} 목록`}>{choices.map((choice,i)=><div id={`${id}-choice-${i}`} key={choice} role="option" aria-selected={choice===value} className={active===i?'is-active':''} onPointerDown={e=>e.preventDefault()} onClick={()=>choose(choice)}><span>{choice}</span>{choice===value&&<Check size={14}/>}</div>)}</div>{!choices.length&&<p>저장된 값 없음</p>}</div>}
  </div>;
}
