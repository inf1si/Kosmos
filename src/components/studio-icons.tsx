import { BookMarked, MapPin, Orbit, User } from 'lucide-react';
/** The sidebar and link preview icon for a setting's category. */
export function WikiIcon({category,size=15}:{category:string;size?:number}){const c=category.trim();return c==='인물'?<User size={size}/>:c==='기술'?<Orbit size={size}/>:c==='장소'?<MapPin size={size}/>:<BookMarked size={size}/>;}
