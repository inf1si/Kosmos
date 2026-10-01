'use client';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tooltip from '@radix-ui/react-tooltip';
import { X } from 'lucide-react';
import type { ReactNode, ButtonHTMLAttributes } from 'react';
export function IconButton({label,children,...props}:ButtonHTMLAttributes<HTMLButtonElement>&{label:string;children:ReactNode}){
  return <Tooltip.Root><Tooltip.Trigger asChild><button type="button" className="icon-button" aria-label={label} {...props}>{children}</button></Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="tooltip" sideOffset={6}>{label}<Tooltip.Arrow/></Tooltip.Content></Tooltip.Portal></Tooltip.Root>;
}
export function TooltipProvider({children}:{children:ReactNode}){return <Tooltip.Provider delayDuration={350}>{children}</Tooltip.Provider>;}
export function Modal({open,onClose,title,description,children,wide=false}:{open:boolean;onClose:()=>void;title:string;description?:string;children:ReactNode;wide?:boolean}){
  return <Dialog.Root open={open} onOpenChange={value=>{if(!value)onClose();}}><Dialog.Portal><Dialog.Overlay className="modal-overlay"/><Dialog.Content className={`modal ${wide?'modal-wide':''}`} aria-describedby={description?'modal-description':undefined}>
    <div className="modal-heading"><Dialog.Title>{title}</Dialog.Title><Dialog.Close className="icon-button" aria-label="닫기"><X size={18}/></Dialog.Close></div>
    {description&&<Dialog.Description id="modal-description" className="muted">{description}</Dialog.Description>}{children}
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
