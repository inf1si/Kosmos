import { z } from 'zod';
import { navigationIssues, type DocumentNavigation } from './document-navigation-schema';

const placement={id:z.uuid(),parentId:z.uuid().nullable()};

export const noteNavigationSchema=z.object({version:z.literal(1),nodes:z.array(z.discriminatedUnion('type',[
  z.object({...placement,type:z.literal('note')}),
  z.object({...placement,type:z.literal('folder'),title:z.string().trim().min(1).max(300)}),
])).max(7500)});

export type NoteNavigation=z.infer<typeof noteNavigationSchema>;

/** The tree UI uses a single virtual section; notes never belong to a persisted work. */
export function asDocumentNavigation(nav:NoteNavigation):DocumentNavigation {
  return {version:1,sections:[{id:'notes',title:'노트',defaultKind:'memo'}],nodes:nav.nodes.map(n=>n.type==='note'?{...n,type:'document' as const,sectionId:'notes'}:{...n,sectionId:'notes'})};
}

export function asNoteNavigation(nav:DocumentNavigation):NoteNavigation {
  if(nav.sections.length!==1||nav.sections[0].id!=='notes'||nav.nodes.some(n=>n.sectionId!=='notes'))throw new Error('노트의 정리 위치를 확인하세요.');

  return noteNavigationSchema.parse({version:1,nodes:nav.nodes.map(({sectionId:_,...n})=>({...n,type:n.type==='document'?'note':'folder'}))});
}

export function noteNavigationIssues(nav:NoteNavigation,ids:string[]):string[]{return navigationIssues(asDocumentNavigation(nav),ids);}
