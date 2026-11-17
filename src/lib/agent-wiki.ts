import { z } from 'zod';
import { agentScopeSchema,agentDocuments,agentLibrary,captureAgentScope,type AgentScope } from './writing-agent';
import type { Workspace } from './model';

/** The LLM wiki the writing agent keeps: one page set per work ('work:<id>') and one common set over the notes ('common'). */
export const wikiCategories=['character','place','rule','event','thread','open','concept','source','other'] as const;

export const wikiCategorySchema=z.enum(wikiCategories);

export const wikiCategoryNames:Record<z.infer<typeof wikiCategorySchema>,string>={character:'인물',place:'장소·조직',rule:'기술·규칙',event:'사건·연표',thread:'복선·회수',open:'미해결',concept:'개념',source:'자료 요약',other:'기타'};

/** What the writer said a source is. A source without a role is never treated as settled canon. */
export const wikiRoleSchema=z.enum(['canon','idea','draft']);

export type WikiRole=z.infer<typeof wikiRoleSchema>;

export const wikiRoleNames:Record<WikiRole,string>={canon:'확정 설정',idea:'아이디어',draft:'초안'};

export const wikiScopeKeySchema=z.union([z.literal('common'),z.string().regex(/^work:[0-9a-f-]{36}$/)]);

export const wikiScopeKey=(scope:AgentScope)=>scope.kind==='work'?`work:${scope.id}`:'common';

/** The scope keys a run may read: a work reads its own pages and the common ones. */
export const wikiReadableKeys=(scope:AgentScope)=>scope.kind==='work'?[wikiScopeKey(scope),'common']:['common'];

export const wikiSourceSchema=z.object({id:z.uuid(),title:z.string(),hash:z.string()});

export const wikiPageSchema=z.object({id:z.uuid(),owner_id:z.uuid(),workspace_id:z.uuid(),scope_key:wikiScopeKeySchema,title:z.string(),category:wikiCategorySchema,content:z.string(),sources:z.array(wikiSourceSchema),run_id:z.uuid().nullable(),created_at:z.string(),updated_at:z.string()});

export type WikiPage=z.infer<typeof wikiPageSchema>;

export const wikiRolesSchema=z.record(z.uuid(),wikiRoleSchema);

export const wikiScopeRowSchema=z.object({owner_id:z.uuid(),scope_key:wikiScopeKeySchema,source_roles:wikiRolesSchema,updated_at:z.string()});

export const wikiWriteSchema=z.object({id:z.uuid().nullable(),title:z.string().trim().min(1).max(300),category:wikiCategorySchema,content:z.string().trim().min(1).max(40000),sourceIds:z.array(z.uuid()).max(50)});

export const wikiRoleInputSchema=z.object({scope:agentScopeSchema,id:z.uuid(),role:wikiRoleSchema.nullable()}).strict();

export const wikiSourceStatusSchema=z.enum(['current','changed','gone']);

export const wikiPageViewSchema=wikiPageSchema.omit({sources:true}).extend({sources:z.array(z.object({id:z.uuid(),title:z.string(),status:wikiSourceStatusSchema})),stale:z.boolean()});

export type WikiPageView=z.infer<typeof wikiPageViewSchema>;

type WikiDocument=Pick<ReturnType<typeof agentDocuments>[number],'id'|'title'|'text'|'properties'>;

/** FNV-1a over the title, text and properties: enough to tell that a source changed, and the same on server and browser. */
export function wikiFingerprint(doc:WikiDocument){
  const input=JSON.stringify([doc.title,doc.text,doc.properties]);
  let a=0x811c9dc5,b=0x01000193;

  for(let i=0;i<input.length;i++){const c=input.charCodeAt(i);a=Math.imul(a^c,0x01000193)>>>0;b=Math.imul(b^c,0x5bd1e995)>>>0;}

  return a.toString(16).padStart(8,'0')+b.toString(16).padStart(8,'0');
}

/** Every document the writer still has, in any work or note space. Trashed items have left the workspace, so they are gone. */
export function wikiDocuments(state:Workspace):Map<string,WikiDocument>{
  const all:AgentScope={kind:'notes',id:'default'};

  return new Map([...agentDocuments(captureAgentScope(state,all)),...agentLibrary(state,all)].map(doc=>[doc.id,doc]));
}

/** A page is stale when any source changed since it was written or left the workspace. */
export function wikiView(page:WikiPage,docs:Map<string,WikiDocument>):WikiPageView{
  const sources=page.sources.map(source=>{const doc=docs.get(source.id);

    return {id:source.id,title:doc?.title||source.title,status:!doc?'gone' as const:wikiFingerprint(doc)===source.hash?'current' as const:'changed' as const};});

  return {...page,sources,stale:sources.some(source=>source.status!=='current')};
}

/** Pages whose title or content holds every term; an empty query lists the index. */
export function wikiSearch(pages:WikiPageView[],query:string,offset:number){
  const terms=query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const hits=pages.filter(page=>terms.every(term=>(page.title+'\n'+page.content).toLocaleLowerCase().includes(term)));

  return {total:hits.length,nextOffset:offset+30<hits.length?offset+30:null,pages:hits.slice(offset,offset+30).map(page=>{const at=terms.length?page.content.toLocaleLowerCase().indexOf(terms[0]):-1;

    return {id:page.id,title:page.title,category:wikiCategoryNames[page.category],scope:page.scope_key==='common'?'공통':'이 작품',stale:page.stale,excerpt:at<0?page.content.slice(0,160):page.content.slice(Math.max(0,at-60),at+100)};})};
}

/** One line per page for the instructions, so the agent knows what the wiki already holds before it reads sources. */
export function wikiIndex(pages:WikiPageView[],budget=3000){
  const lines=pages.map(page=>`- ${JSON.stringify(page.title)} (${wikiCategoryNames[page.category]}${page.scope_key==='common'?' · 공통':''}${page.stale?' · 출처 바뀜':''}) id ${page.id}`);
  const kept:string[]=[];let used=0;

  for(const line of lines){if(used+line.length>budget)break;kept.push(line);used+=line.length+1;}

  if(kept.length<lines.length)kept.push(`(목록에 싣지 못한 페이지 ${lines.length-kept.length}개는 searchWiki로 찾는다.)`);

  return kept.join('\n')||'(아직 위키 페이지가 없다.)';
}

/** Roles as the instructions show them: titles grouped by role, documents that left the workspace left out. */
export function wikiRoleHints(roles:Record<string,WikiRole>,docs:Map<string,WikiDocument>){
  return wikiRoleSchema.options.flatMap(role=>{const titles=Object.entries(roles).filter(([id,value])=>value===role&&docs.has(id)).map(([id])=>docs.get(id)!.title);

    return titles.length?[`${wikiRoleNames[role]}: ${JSON.stringify(titles.slice(0,60))}`]:[];}).join('\n');
}

/** Supabase answers this way while the wiki migration has not run, so the rest of the agent keeps working. */
export const wikiMissing=(error:{code?:string}|null)=>error?.code==='PGRST205'||error?.code==='42P01';

/** Wiki rows of an AI data export for the importing account. Rows that fail the schema are left out. */
export function wikiImportRows(batch:{wikiPages:unknown[];wikiScopes:unknown[]},owner:string,workspace:string){
  return {
    pages:batch.wikiPages.flatMap(row=>{const parsed=wikiPageSchema.safeParse(row);

return parsed.success?[{...parsed.data,owner_id:owner,workspace_id:workspace}]:[];}),
    scopes:batch.wikiScopes.flatMap(row=>{const parsed=wikiScopeRowSchema.safeParse(row);

return parsed.success?[{...parsed.data,owner_id:owner}]:[];}),
  };
}
