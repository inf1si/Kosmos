'use client';
import * as Dialog from '@radix-ui/react-dialog';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as Tooltip from '@radix-ui/react-tooltip';
import { X } from 'lucide-react';
import { useId,useRef, type ReactNode, type ButtonHTMLAttributes, type CSSProperties, type RefObject } from 'react';
export function IconButton({label,children,...props}:ButtonHTMLAttributes<HTMLButtonElement>&{label:string;children:ReactNode}){
  return <Tooltip.Root><Tooltip.Trigger asChild><button type="button" className="icon-button" aria-label={label} {...props}>{children}</button></Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="tooltip" sideOffset={6}>{label}<Tooltip.Arrow/></Tooltip.Content></Tooltip.Portal></Tooltip.Root>;
}
export function TooltipProvider({children}:{children:ReactNode}){return <Tooltip.Provider delayDuration={350}>{children}</Tooltip.Provider>;}
export function Modal({open,onClose,title,description,children,wide=false,onReturnFocus,className=''}:{open:boolean;onClose:()=>void;title:string;description?:string;children:ReactNode;wide?:boolean;onReturnFocus?:()=>void;className?:string}){
  const descriptionId=useId();
  return <Dialog.Root open={open} onOpenChange={value=>{if(!value)onClose();}}><Dialog.Portal><Dialog.Overlay className="modal-overlay"/><Dialog.Content className={`modal ${wide?'modal-wide':''} ${className}`} aria-describedby={description?descriptionId:undefined} onCloseAutoFocus={onReturnFocus?e=>{e.preventDefault();onReturnFocus();}:undefined}>
    <div className="modal-heading"><Dialog.Title>{title}</Dialog.Title><Dialog.Close className="icon-button" aria-label="닫기"><X size={18}/></Dialog.Close></div>
    {description&&<Dialog.Description id={descriptionId} className="muted">{description}</Dialog.Description>}{children}
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
export type PopoverAnchor = RefObject<{getBoundingClientRect:()=>DOMRect}|null>;
/** 버튼·행·선택 글자 옆에 붙는 작은 창. 화면을 가리지 않고 바깥을 누르거나 Escape로 닫는다. trigger를 주면 그 버튼이, anchor를 주면 그 위치가 기준이다. */
export function Popover({open,onOpenChange,trigger,anchor,title,description,children,width=300,side='bottom',align='start',className='',onReturnFocus,initialFocus}:{open:boolean;onOpenChange:(open:boolean)=>void;trigger?:ReactNode;anchor?:PopoverAnchor;title?:string;description?:string;children:ReactNode;width?:number;side?:'top'|'right'|'bottom'|'left';align?:'start'|'center'|'end';className?:string;onReturnFocus?:()=>void;initialFocus?:'content'}){
  const id=useId(),contentRef=useRef<HTMLDivElement>(null);
  // A click on another control (the next popover's button, an input, the manuscript) already places focus there, and a
  // toolbar group that shares one open state closes this popover by opening the next one. Returning focus to the editor
  // then would blur — and so close — the popover that was just opened.
  const keepFocus=useRef(false);
  return <PopoverPrimitive.Root open={open} onOpenChange={value=>{if(value)keepFocus.current=false;onOpenChange(value);}}>{trigger?<PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>:<PopoverPrimitive.Anchor virtualRef={anchor}/>}
    <PopoverPrimitive.Portal><PopoverPrimitive.Content ref={contentRef} className={`popover ${className}`} side={side} align={align} sideOffset={6} collisionPadding={12} style={{outline:initialFocus==='content'?'none':undefined,'--popover-w':`${width}px`} as CSSProperties} aria-labelledby={title?`${id}-title`:undefined} aria-describedby={description?`${id}-description`:undefined} onOpenAutoFocus={initialFocus==='content'?e=>{e.preventDefault();contentRef.current?.focus();}:undefined} onPointerDownOutside={e=>{const target=e.detail.originalEvent.target;keepFocus.current=target instanceof Element&&!!target.closest('button,a[href],input,select,textarea,[contenteditable="true"],[tabindex]:not([tabindex="-1"])');}} onFocusOutside={()=>{keepFocus.current=true;}} onCloseAutoFocus={onReturnFocus?e=>{e.preventDefault();const active=document.activeElement,elsewhere=!!active&&active!==document.body&&!contentRef.current?.contains(active);if(!keepFocus.current&&!elsewhere)onReturnFocus();keepFocus.current=false;}:undefined}>
      {title&&<p className="popover-title" id={`${id}-title`}>{title}</p>}{description&&<p className="popover-description" id={`${id}-description`}>{description}</p>}{children}
    </PopoverPrimitive.Content></PopoverPrimitive.Portal>
  </PopoverPrimitive.Root>;
}
