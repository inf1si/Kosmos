'use client';

import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { Children, isValidElement, type ReactNode, type Ref } from 'react';

type Item={value:string;label:string;disabled:boolean};

type Group={label:string;items:Item[]};

type OptionProps={value?:string|number;disabled?:boolean;label?:string;children?:ReactNode};

// Radix reserves the empty string for "no selection", so an empty option value travels under this key.
const EMPTY='\u0000empty';

const key=(value:string)=>value===''?EMPTY:value;

function text(node:ReactNode):string{
  // Children.toArray drops null and booleans, so anything that is not an element here is text.
  return Children.toArray(node).map(child=>isValidElement<OptionProps>(child)?text(child.props.children):String(child)).join('');
}

function parse(children:ReactNode):(Item|Group)[]{
  return Children.toArray(children).flatMap((child):(Item|Group)[]=>{
    if(!isValidElement<OptionProps>(child))return [];

    if(child.type==='optgroup')return [{label:child.props.label??'',items:parse(child.props.children).filter((entry):entry is Item=>'value' in entry)}];

    if(child.type!=='option')return [];

    const label=text(child.props.children);

    return [{value:String(child.props.value??label),label,disabled:!!child.props.disabled}];
  });
}

// A change handler may move focus on purpose (the paragraph style returns to the manuscript). Radix would then pull it
// back to the trigger, so keep it wherever the handler put it.
function keepMovedFocus(event:Event){
  const active=document.activeElement;

  if(active&&active!==document.body&&!active.closest('.select-menu'))event.preventDefault();
}

/** 앱 모양 드롭다운. 기본 select처럼 option·optgroup을 받고 고른 값을 문자열로 돌려준다. 목록은 `.menu`와 같은 떠 있는 창이다. 닫힌 칸은 가장 긴 항목 폭을 유지하고, 고른 이름을 직접 그려 서버 렌더링에서도 비지 않는다. */
export function Select({value,onChange,children,disabled,className='',ref,...props}:{value:string|number;onChange:(value:string)=>void;children:ReactNode;disabled?:boolean;className?:string;ref?:Ref<HTMLButtonElement>;'aria-label'?:string;title?:string}){
  const entries=parse(children),items=entries.flatMap(entry=>'items' in entry?entry.items:[entry]),current=items.find(item=>item.value===String(value));

  const option=(item:Item)=><SelectPrimitive.Item key={item.value} value={key(item.value)} disabled={item.disabled} className="menu-item select-item" data-value={item.value}>
    <span className="select-check" aria-hidden="true"><SelectPrimitive.ItemIndicator><Check size={14}/></SelectPrimitive.ItemIndicator></span><SelectPrimitive.ItemText>{item.label}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>;

  return <SelectPrimitive.Root value={key(String(value))} onValueChange={next=>onChange(next===EMPTY?'':next)} disabled={disabled}>
    <SelectPrimitive.Trigger ref={ref} className={`select ${className}`} data-value={String(value)} {...props}>
      <span className="select-value"><SelectPrimitive.Value>{current?.label}</SelectPrimitive.Value>{items.map(item=><span key={item.value} className="select-sizer" aria-hidden="true">{item.label}</span>)}</span>
      <SelectPrimitive.Icon className="select-icon"><ChevronDown size={14}/></SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
    <SelectPrimitive.Portal><SelectPrimitive.Content className="menu select-menu" position="popper" sideOffset={4} collisionPadding={12} onCloseAutoFocus={keepMovedFocus}>
      <SelectPrimitive.Viewport className="select-viewport">{entries.map((entry,index)=>'items' in entry?<SelectPrimitive.Group key={`group-${index}`}><SelectPrimitive.Label className="select-label">{entry.label}</SelectPrimitive.Label>{entry.items.map(option)}</SelectPrimitive.Group>:option(entry))}</SelectPrimitive.Viewport>
    </SelectPrimitive.Content></SelectPrimitive.Portal>
  </SelectPrimitive.Root>;
}
