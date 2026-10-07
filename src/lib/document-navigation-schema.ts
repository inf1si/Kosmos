import { z } from 'zod';

export const MAX_DOCUMENT_DEPTH = 24;

const sectionSchema = z.object({id:z.string().min(1).max(100),title:z.string().trim().min(1).max(200),defaultKind:z.enum(['scene','wiki','memo'])});

const placement = {id:z.uuid(),sectionId:z.string().min(1).max(100),parentId:z.uuid().nullable()};

export const navigationSchema = z.object({
  version:z.literal(1),sections:z.array(sectionSchema).min(1).max(40),
  nodes:z.array(z.discriminatedUnion('type',[
    z.object({...placement,type:z.literal('document')}),
    z.object({...placement,type:z.literal('folder'),title:z.string().trim().min(1).max(300)}),
  ])).max(7500),
});

export type DocumentNavigation = z.infer<typeof navigationSchema>;

export type NavigationNode = DocumentNavigation['nodes'][number];

export type NavigationSection = DocumentNavigation['sections'][number];

/** Missing document placements are allowed for older imports; unknown placements are never allowed. */
export function navigationIssues(nav:DocumentNavigation,documentIds:string[]):string[] {
  const sections=new Set(nav.sections.map(s=>s.id)),nodes=new Map(nav.nodes.map(n=>[n.id,n])),docs=new Set(documentIds);

  if(sections.size!==nav.sections.length||nodes.size!==nav.nodes.length)return ['문서 정리 구조에 중복 ID가 있습니다.'];

  for(const n of nav.nodes){
    if(!sections.has(n.sectionId))return ['문서의 섹션을 찾지 못했습니다.'];

    if(n.type==='document'&&!docs.has(n.id))return ['정리 구조의 문서를 찾지 못했습니다.'];

    if(n.type==='folder'&&docs.has(n.id))return ['폴더와 문서 ID가 겹칩니다.'];
    let current:NavigationNode|undefined=n;const seen=new Set<string>();let depth=0;

    while(current){
      if(seen.has(current.id))return ['문서와 폴더를 자신의 하위로 옮길 수 없습니다.'];
      seen.add(current.id);

if(++depth>MAX_DOCUMENT_DEPTH)return [`하위 문서는 ${MAX_DOCUMENT_DEPTH}단계까지 만들 수 있습니다.`];

      if(current.parentId===null)break;
      current=nodes.get(current.parentId);

      if(!current||current.sectionId!==n.sectionId)return ['상위 문서·폴더의 위치를 확인하세요.'];
    }
  }

  return [];
}
