import { BookMarked, FileText, MapPin, Orbit, StickyNote, User } from 'lucide-react';
import type { NovelDocument } from '@/lib/model';
/** The sidebar and link preview icon for a setting's category. */
export function WikiIcon({category,size=15}:{category:string;size?:number}){const c=category.trim();return c==='인물'?<User size={size}/>:c==='기술'?<Orbit size={size}/>:c==='장소'?<MapPin size={size}/>:<BookMarked size={size}/>;}
/** Manuscript FileText, memo StickyNote, settings by category: the one icon per document kind used everywhere. */
export function DocIcon({doc,size=14}:{doc:Pick<NovelDocument,'kind'|'category'>;size?:number}){return doc.kind==='wiki'?<WikiIcon category={doc.category} size={size}/>:doc.kind==='memo'?<StickyNote size={size}/>:<FileText size={size}/>;}
