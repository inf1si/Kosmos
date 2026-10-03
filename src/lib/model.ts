import { z } from 'zod';
import { conversationSchema } from './ai-conversation';
import { navigationSchema, navigationIssues } from './document-navigation-schema';
import { aiPreferencesSchema } from './ai-prompt-presets';

export type RichNode = { type: string; text?: string; attrs?: Record<string, unknown>; marks?: {type: string; attrs?: Record<string, unknown>}[]; content?: RichNode[] };
const nodeTypes = new Set(['doc','text','paragraph','heading','bulletList','orderedList','listItem','hardBreak','blockquote','codeBlock','horizontalRule','footnote']);
const markTypes = new Set(['bold','italic','strike','underline','code','link','wikiLink']);
export function isRichDocument(value: unknown): value is RichNode {
  let count = 0;
  function visit(n: unknown, depth: number): boolean {
    if (!n || typeof n !== 'object' || depth > 40 || ++count > 60000) return false;
    const v = n as RichNode;
    return nodeTypes.has(v.type) && (v.text === undefined || (typeof v.text === 'string' && v.text.length <= 200000))
      && (!v.marks || (Array.isArray(v.marks) && v.marks.every(m => m && typeof m==='object' && markTypes.has(m.type))))
      && (!v.content || (Array.isArray(v.content) && v.content.every(c => visit(c, depth + 1))));
  }
  return !!value && (value as RichNode).type === 'doc' && visit(value, 0);
}
const contentSchema = z.custom<RichNode>(isRichDocument, '지원하지 않는 원고 형식입니다.');
export const documentSchema = z.object({
  id: z.uuid(), kind: z.enum(['scene','wiki','memo']), title: z.string().min(1).max(300),
  chapter: z.string().max(300), content: contentSchema, summary: z.string().max(20000),
  status: z.enum(['idea','draft','review','done']), category: z.string().max(200),
  pov: z.string().max(200), storyTime: z.string().max(300), isPublic: z.boolean(),
  publicSummary: z.string().max(30000), updatedAt: z.string(), assetIds: z.array(z.uuid()).max(200),
});
export type NovelDocument = z.infer<typeof documentSchema>;
const publicSceneSchema = z.object({id:z.uuid(), title:z.string(), chapter:z.string(), content:contentSchema});
const publicWikiSchema = z.object({id:z.uuid(),title:z.string(),category:z.string(),summary:z.string()});
export const publicationSchema = z.object({
  id:z.uuid(),workId:z.uuid(),title:z.string(),subtitle:z.string(),description:z.string(),
  publishedAt:z.string(),scenes:z.array(publicSceneSchema),wiki:z.array(publicWikiSchema),
});
export type Publication = z.infer<typeof publicationSchema>;
export const workSchema = z.object({
  id:z.uuid(),title:z.string().min(1).max(300),subtitle:z.string().max(500),description:z.string().max(10000),
  form:z.enum(['단편','중편','장편']), documents:z.array(documentSchema).min(1).max(5000),
  publications:z.array(publicationSchema).max(100),activePublicationId:z.uuid().nullable(),
  aiConversations:z.array(conversationSchema).max(200).optional(),
  navigation:navigationSchema.optional(),
}).superRefine((work,ctx)=>{
  if(work.navigation)for(const message of navigationIssues(work.navigation,work.documents.map(d=>d.id)))ctx.addIssue({code:'custom',message,path:['navigation']});
});
export type Work = z.infer<typeof workSchema>;
export const assetSchema = z.object({id:z.uuid(),workId:z.uuid(),name:z.string().max(300),type:z.enum(['image/png','image/jpeg','image/webp']),size:z.number().int().min(0).max(10*1024*1024)});
export type AssetMeta = z.infer<typeof assetSchema>;
export const workspaceSchema = z.object({
  formatVersion:z.literal(1),id:z.uuid(),works:z.array(workSchema).min(1).max(100),assets:z.array(assetSchema).max(2000),updatedAt:z.string(),
  aiPreferences:aiPreferencesSchema.optional(),
}).superRefine((data,ctx)=>{
  const ids = [...data.works.map(w=>w.id), ...data.works.flatMap(w=>w.documents.map(d=>d.id)), ...data.works.flatMap(w=>w.navigation?.nodes.filter(n=>n.type==='folder').map(n=>n.id)||[]), ...data.assets.map(a=>a.id)];
  if (new Set(ids).size !== ids.length) ctx.addIssue({code:'custom',message:'중복된 문서 ID가 있습니다.'});
  const assets=new Map(data.assets.map(a=>[a.id,a]));
  for(const w of data.works) {
    const conversations=w.aiConversations||[];
    if(new Set(conversations.map(c=>c.docId)).size!==conversations.length||conversations.some(c=>!w.documents.some(d=>d.id===c.docId)))ctx.addIssue({code:'custom',message:'AI 대화의 문서 연결을 확인하세요.'});
    if(w.activePublicationId && !w.publications.some(p=>p.id===w.activePublicationId && p.workId===w.id)) ctx.addIssue({code:'custom',message:'공개 판본 연결을 확인하세요.'});
    for(const d of w.documents) for(const id of d.assetIds) if(assets.get(id)?.workId!==w.id) ctx.addIssue({code:'custom',message:'첨부 연결이 손상되었습니다.'});
  }
});
export type Workspace = z.infer<typeof workspaceSchema>;
export type Revision = {id:string;namespace:string;createdAt:string;label:string;data:Workspace};
export type LocalRecord = {namespace:string;data:Workspace;localVersion:number;cloudVersion:number;dirty:boolean;lastExportAt:string|null;pendingRequest?:{id:string;localVersion:number;baseVersion:number;data:Workspace}};
export function uid() { return crypto.randomUUID(); }
export function plainText(n:RichNode):string {
  if(n.type==='footnote') return '';
  if(n.type==='text') return n.text || '';
  return (n.content||[]).map(plainText).join(['doc','bulletList','orderedList'].includes(n.type)?'\n\n':'');
}
export function fromText(text:string):RichNode {
  return {type:'doc',content:text.split(/\n\s*\n/).map(t=>({type:'paragraph',attrs:{blockId:uid()},content:t?[{type:'text',text:t}]:[]}))};
}
export function newDocument(kind:NovelDocument['kind'],title:string):NovelDocument {
  return {id:uid(),kind,title,chapter:kind==='scene'?'제1부':'',content:fromText(''),summary:'',status:'draft',category:kind==='wiki'?'기타':'',pov:'',storyTime:'',isPublic:false,publicSummary:'',updatedAt:new Date().toISOString(),assetIds:[]};
}
export function makePublication(work:Work,sceneIds:string[]):Publication {
  const selected=new Set(sceneIds);
  const scenes=work.documents.filter(d=>d.kind==='scene'&&selected.has(d.id));
  if(!scenes.length) throw new Error('공개할 장면을 하나 이상 선택하세요.');
  return publicationSchema.parse({id:uid(),workId:work.id,title:work.title,subtitle:work.subtitle,description:work.description,publishedAt:new Date().toISOString(),
    scenes:scenes.map(d=>({id:d.id,title:d.title,chapter:d.chapter,content:structuredClone(d.content)})),
    wiki:work.documents.filter(d=>d.kind==='wiki'&&d.isPublic&&d.publicSummary.trim()).map(d=>({id:d.id,title:d.title,category:d.category,summary:d.publicSummary})),
  });
}
export function wikiReferences(content:RichNode):string[] {
  const ids=new Set<string>();
  function visit(n:RichNode){for(const m of n.marks||[])if(m.type==='wikiLink'&&typeof m.attrs?.targetId==='string')ids.add(m.attrs.targetId);n.content?.forEach(visit);}
  visit(content);return [...ids];
}
export function footnotes(content:RichNode):{id:string;text:string}[]{
  const notes:{id:string;text:string}[]=[];
  function visit(n:RichNode){if(n.type==='footnote')notes.push({id:String(n.attrs?.noteId||''),text:String(n.attrs?.text||'')});n.content?.forEach(visit);}
  visit(content);return notes;
}
export const statuses={idea:'구상',draft:'집필 중',review:'퇴고 중',done:'완성'} as const;
