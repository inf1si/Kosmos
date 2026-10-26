import { Book,FileText,Folder,LibraryBig,StickyNote } from 'lucide-react';
import type { InternalReference } from '@/lib/internal-reference-node';

export function ReferenceIcon({kind,size=14}:{kind:InternalReference['kind'];size?:number}){
  const Icon=kind==='note'?StickyNote:kind==='work'?Book:kind==='shelf'?LibraryBig:kind.endsWith('-folder')?Folder:FileText;

  return <Icon size={size} aria-hidden="true"/>;
}
