import { z } from 'zod';
import { navigationIssues, type DocumentNavigation } from './document-navigation-schema';

export const DEFAULT_NOTE_SPACE='default';

export const noteSpaceSchema=z.object({
  id:z.union([z.literal(DEFAULT_NOTE_SPACE),z.uuid()]),title:z.string().trim().max(80),
  sections:z.array(z.object({id:z.string().min(1).max(100),title:z.string().trim().min(1).max(200)})).min(1).max(40),
});

export type NoteSpace=z.infer<typeof noteSpaceSchema>;

export function defaultNoteSpace():NoteSpace{return {id:DEFAULT_NOTE_SPACE,title:'기본 작업공간',sections:[{id:'notes',title:'노트'}]};}

const placement={id:z.uuid(),parentId:z.uuid().nullable(),sectionId:z.string().min(1).max(100).optional()};

export const noteNavigationSchema=z.object({version:z.literal(1),spaces:z.array(noteSpaceSchema).min(1).max(100).optional(),nodes:z.array(z.discriminatedUnion('type',[
  z.object({...placement,type:z.literal('note')}),
  z.object({...placement,type:z.literal('folder'),title:z.string().trim().min(1).max(300)}),
])).max(7500)});

export type NoteNavigation=z.infer<typeof noteNavigationSchema>;

export type ResolvedNoteNavigation={version:1;spaces:NoteSpace[];nodes:(NoteNavigation['nodes'][number]&{sectionId:string})[]};

export function noteSpaceTitle(space:Pick<NoteSpace,'title'>){return space.title.trim()||'이름 없는 작업공간';}

/** Legacy trees retain their IDs and sibling order inside the default space. */
export function resolveNoteStructure(nav:NoteNavigation):ResolvedNoteNavigation {
  const spaces=structuredClone(nav.spaces??[defaultNoteSpace()]),fallback=spaces.find(s=>s.id===DEFAULT_NOTE_SPACE)?.sections[0]?.id??'notes';

  return {version:1,spaces,nodes:nav.nodes.map(n=>({...n,sectionId:n.sectionId??fallback}))};
}

/** A space uses the same section/folder/document controls as a work; note content stays independent. */
export function asDocumentNavigation(nav:NoteNavigation,spaceId=DEFAULT_NOTE_SPACE):DocumentNavigation {
  const resolved=resolveNoteStructure(nav),space=resolved.spaces.find(s=>s.id===spaceId);

  if(!space)throw new Error('노트 작업공간을 찾지 못했습니다.');
  const sections=new Set(space.sections.map(s=>s.id));

  return {version:1,sections:space.sections.map(s=>({...s,defaultKind:'memo'})),nodes:resolved.nodes.filter(n=>sections.has(n.sectionId)).map(n=>n.type==='note'?{...n,type:'document' as const}:n)};
}

/** Canonical single-section representation used by portable note templates. */
export function asNoteNavigation(nav:DocumentNavigation):NoteNavigation {
  if(nav.sections.length!==1||nav.sections[0].id!=='notes'||nav.nodes.some(n=>n.sectionId!=='notes'))throw new Error('노트의 정리 위치를 확인하세요.');

  return noteNavigationSchema.parse({version:1,nodes:nav.nodes.map(({sectionId:_,...n})=>({...n,type:n.type==='document'?'note':'folder'}))});
}

export function noteNavigationIssues(nav:NoteNavigation,ids:string[]):string[]{
  const resolved=resolveNoteStructure(nav),spaces=resolved.spaces,sections=spaces.flatMap(s=>s.sections.map(section=>section.id));

  if(new Set(spaces.map(s=>s.id)).size!==spaces.length||!spaces.some(s=>s.id===DEFAULT_NOTE_SPACE))return ['기본 작업공간과 작업공간 ID를 확인하세요.'];

  if(new Set(sections).size!==sections.length)return ['노트 섹션 ID가 중복됩니다.'];

  if(resolved.nodes.some(n=>!sections.includes(n.sectionId)))return ['노트의 작업공간·섹션을 찾지 못했습니다.'];

  if(new Set(resolved.nodes.map(n=>n.id)).size!==resolved.nodes.length)return ['노트 정리 ID가 중복됩니다.'];
  const placed=new Set(nav.nodes.filter(n=>n.type==='note').map(n=>n.id));

  if(nav.spaces&&(nav.nodes.some(n=>!n.sectionId)||ids.some(id=>!placed.has(id))))return ['노트의 작업공간·섹션 소속을 확인하세요.'];

  for(const space of spaces){const issues=navigationIssues(asDocumentNavigation(nav,space.id),ids);

    if(issues.length)return issues;
  }

  return [];
}
