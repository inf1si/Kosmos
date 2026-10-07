import { z } from 'zod';
import { conversationSchema } from './ai-conversation';
import { noteNavigationSchema, noteNavigationIssues } from './note-navigation-schema';
import { chatMessagesSchema } from './ai-conversation';
import { navigationSchema, navigationIssues } from './document-navigation-schema';
import { aiPreferencesSchema } from './ai-prompt-presets';
import { cellSpan, formatNumber, inlineFontSize, validListStyle } from './manuscript-format';
import { jsonValueSchema, type JsonValue } from './json-value';
import { customPropertiesSchema } from './custom-properties';

export type RichAttributes = { [key: string]: JsonValue | undefined };

export type RichNode = { type: string; text?: string; attrs?: RichAttributes; marks?: {type: string; attrs?: RichAttributes}[]; content?: RichNode[] };

const nodeTypes = new Set(['doc','text','paragraph','heading','bulletList','orderedList','listItem','hardBreak','blockquote','codeBlock','horizontalRule','footnote','table','tableRow','tableCell','tableHeader']);

// Personal notes also keep checklists and in-body images; works and publications never accept these nodes.
const noteNodeTypes = new Set(['taskList','taskItem','noteImage']);

const markTypes = new Set(['bold','italic','strike','underline','code','link','wikiLink','superscript','subscript','highlight','fontSize']);

const richAttributesSchema = z.record(z.string(), jsonValueSchema.optional());

// Decode one node at a time so the depth and node budgets also bound malformed input.
const richNodeSchema = z.object({
  type: z.string(), text: z.string().max(200000).optional(), attrs: richAttributesSchema.optional(),
  marks: z.array(z.object({ type: z.string(), attrs: richAttributesSchema.optional() })).optional(),
  content: z.array(z.custom<RichNode>()).optional(),
});

function validEmptyTableRows(rows: RichNode[]): boolean {
  let pending: number[] = [];

  for (const row of rows) {
    if (row?.type !== 'tableRow' || !Array.isArray(row.content)) return false;

    if (!row.content.length && (!pending.length || pending.some(span => span === 0))) return false;
    let column = 0;

    for (const cell of row.content) {
      if (!cell || !['tableCell', 'tableHeader'].includes(cell.type)) return false;

      while (pending[column] > 0) column++;
      const colspan = cellSpan(cell.attrs?.colspan), rowspan = cellSpan(cell.attrs?.rowspan);

      for (let offset = 0; offset < colspan; offset++) pending[column + offset] = rowspan;
      column += colspan;
    }

    pending = pending.map(span => Math.max(0, span - 1));
  }

  return true;
}

export function isRichDocument(value: JsonValue | RichNode | undefined, noteNodes = false): value is RichNode {
  let count = 0;

  function visit(n: RichNode, depth: number, mergedRow = false): boolean {
    if (depth > 40 || ++count > 60000) return false;
    const parsed = richNodeSchema.safeParse(n);

    if (!parsed.success) return false;
    const v = parsed.data;
    const attrs=v.attrs||{};

    if(['paragraph','heading'].includes(v.type))for(const [key,min,max] of [['lineHeight',1,3],['indent',0,8],['firstLineIndent',0,4],['spaceBefore',0,48],['spaceAfter',0,48]] as const){const number=attrs[key];

if(number!==undefined&&number!==null&&formatNumber(number,min,max)===undefined)return false;}

    if(['bulletList','orderedList'].includes(v.type)&&!validListStyle(v.type,attrs.listStyle))return false;

    if(v.type==='table'&&(!v.content?.length||!validEmptyTableRows(v.content)))return false;

    if(v.type==='tableRow'&&(!v.content||!mergedRow&&!v.content.length||v.content.some(c=>!['tableCell','tableHeader'].includes(c?.type))))return false;

    if(['tableCell','tableHeader'].includes(v.type)){
      if(!Array.isArray(v.content)||!v.content.length||v.content.some(c=>!['paragraph','heading','bulletList','orderedList','blockquote','codeBlock','horizontalRule','table'].includes(c?.type)))return false;

      for(const key of ['colspan','rowspan']){const span=attrs[key];

if(span!==undefined&&!z.number().int().min(1).max(40).safeParse(span).success)return false;}

      const widths=attrs.colwidth;

if(widths!==undefined&&widths!==null&&(!Array.isArray(widths)||widths.length!==(attrs.colspan??1)||!z.array(z.number().int().min(1).max(2000)).safeParse(widths).success))return false;
    }

    if(noteNodeTypes.has(v.type)){
      if(!noteNodes)return false;

      if(v.type==='taskList'&&(!Array.isArray(v.content)||!v.content.length||v.content.some(c=>c?.type!=='taskItem')))return false;

      if(v.type==='taskItem'&&(attrs.checked!==undefined&&!z.boolean().safeParse(attrs.checked).success||!v.content?.length))return false;

      if(v.type==='noteImage'&&(!z.string().max(100).safeParse(attrs.assetId).success||attrs.alt!==undefined&&attrs.alt!==null&&!z.string().max(300).safeParse(attrs.alt).success||v.content))return false;
    }

    return (nodeTypes.has(v.type)||noteNodeTypes.has(v.type))
      && (!v.marks || v.marks.every(m => markTypes.has(m.type) && (m.type!=='fontSize' || inlineFontSize(m.attrs?.size)!==undefined)))
      && (!v.content || v.content.every(c => visit(c, depth + 1, v.type === 'table')));
  }

  const root = richNodeSchema.safeParse(value);

  return root.success && root.data.type === 'doc' && visit(root.data, 0);
}

const contentSchema = z.custom<RichNode>(value => {
  const parsed = richNodeSchema.safeParse(value);

  return parsed.success && isRichDocument(parsed.data);
}, '지원하지 않는 원고 형식입니다.');

const noteContentSchema = z.custom<RichNode>(value => {
  const parsed = richNodeSchema.safeParse(value);

  return parsed.success && isRichDocument(parsed.data,true);
}, '지원하지 않는 노트 형식입니다.');

export const documentSchema = z.object({
  id: z.uuid(), kind: z.enum(['scene','wiki','memo']), title: z.string().max(300),
  chapter: z.string().max(300), content: contentSchema, summary: z.string().max(20000),
  status: z.enum(['idea','draft','review','done']), category: z.string().max(200),
  pov: z.string().max(200), storyTime: z.string().max(300), isPublic: z.boolean(),
  publicSummary: z.string().max(30000), updatedAt: z.string(), assetIds: z.array(z.uuid()).max(200),
  customProperties:customPropertiesSchema.optional(),
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

export const noteSchema = z.object({
  id:z.uuid(),title:z.string().max(300),content:noteContentSchema,
  tags:z.array(z.string().trim().min(1).max(40)).max(20),box:z.enum(['inbox','icebox']),
  linkedWorkIds:z.array(z.uuid()).max(100),assetIds:z.array(z.uuid()).max(200),
  createdAt:z.string(),updatedAt:z.string(),aiMessages:chatMessagesSchema.optional(),pinned:z.boolean().optional(),
  customProperties:customPropertiesSchema.optional(),
}).superRefine((note,ctx)=>{
  for(const key of ['tags','linkedWorkIds','assetIds'] as const)if(new Set(note[key]).size!==note[key].length)ctx.addIssue({code:'custom',message:'노트의 중복 연결을 확인하세요.',path:[key]});
});

export type PersonalNote = z.infer<typeof noteSchema>;

const templateBase={id:z.uuid(),name:z.string().trim().min(1).max(200),createdAt:z.iso.datetime(),navigation:navigationSchema};

export const workspaceTemplateSchema=z.discriminatedUnion('scope',[
  z.object({...templateBase,scope:z.literal('work'),documents:z.array(documentSchema).min(1).max(5000)}),
  z.object({...templateBase,scope:z.literal('notes'),notes:z.array(noteSchema).min(1).max(5000)}),
]).superRefine((template,ctx)=>{
  const items=template.scope==='work'?template.documents:template.notes;

  if(new Set(items.map(d=>d.id)).size!==items.length)ctx.addIssue({code:'custom',message:'템플릿 문서 ID가 중복됩니다.'});

  for(const message of navigationIssues(template.navigation,items.map(d=>d.id)))ctx.addIssue({code:'custom',message});
  const placed=new Set(template.navigation.nodes.filter(n=>n.type==='document').map(n=>n.id));

  if(items.some(d=>!placed.has(d.id)))ctx.addIssue({code:'custom',message:'템플릿 문서의 위치를 확인하세요.'});

  if(template.scope==='notes'&&(template.navigation.sections.length!==1||template.navigation.sections[0].id!=='notes'))ctx.addIssue({code:'custom',message:'노트 템플릿의 위치를 확인하세요.'});
});

export type WorkspaceTemplate=z.infer<typeof workspaceTemplateSchema>;

export const assetSchema = z.object({id:z.uuid(),workId:z.uuid().optional(),noteId:z.uuid().optional(),templateId:z.uuid().optional(),name:z.string().max(300),type:z.enum(['image/png','image/jpeg','image/webp']),size:z.number().int().min(0).max(10*1024*1024)}).superRefine((asset,ctx)=>{
  if([asset.workId,asset.noteId,asset.templateId].filter(Boolean).length!==1)ctx.addIssue({code:'custom',message:'첨부의 소속을 확인하세요.'});
});

export type AssetMeta = z.infer<typeof assetSchema>;

const trashPlacementSchema=z.object({parentId:z.uuid().nullable(),beforeId:z.uuid().optional(),childIds:z.array(z.uuid()).max(7500)});

export const trashItemSchema=z.discriminatedUnion('type',[
  z.object({id:z.uuid(),type:z.literal('note'),deletedAt:z.iso.datetime(),note:noteSchema,placement:trashPlacementSchema}),
  // A whole work: its list position and the notes that linked to it come back on restore.
  z.object({id:z.uuid(),type:z.literal('work'),deletedAt:z.iso.datetime(),work:workSchema,index:z.number().int().min(0).max(100),noteIds:z.array(z.uuid()).max(5000)}),
  z.object({id:z.uuid(),type:z.literal('document'),deletedAt:z.iso.datetime(),workId:z.uuid(),workTitle:z.string().min(1).max(300),document:documentSchema,aiMessages:chatMessagesSchema.optional(),placement:trashPlacementSchema.extend({section:z.object({id:z.string().min(1).max(100),title:z.string().min(1).max(200),defaultKind:z.enum(['scene','wiki','memo'])})})}),
]).superRefine((item,ctx)=>{
  if(item.id!==(item.type==='note'?item.note.id:item.type==='work'?item.work.id:item.document.id))ctx.addIssue({code:'custom',message:'휴지통 항목 ID를 확인하세요.'});

  if(item.type==='work'){if(new Set(item.noteIds).size!==item.noteIds.length)ctx.addIssue({code:'custom',message:'휴지통 작품의 노트 연결을 확인하세요.'});

return;}

  const p=item.placement;

if(p.parentId===item.id||p.beforeId===item.id||p.childIds.includes(item.id)||new Set(p.childIds).size!==p.childIds.length)ctx.addIssue({code:'custom',message:'휴지통 하위 항목을 확인하세요.'});
});

export type TrashItem=z.infer<typeof trashItemSchema>;

export const workspaceSchema = z.object({
  formatVersion:z.literal(1),id:z.uuid(),works:z.array(workSchema).min(1).max(100),assets:z.array(assetSchema).max(2000),updatedAt:z.string(),
  aiPreferences:aiPreferencesSchema.optional(),
  notes:z.array(noteSchema).max(5000).optional(),
  noteNavigation:noteNavigationSchema.optional(),
  trash:z.array(trashItemSchema).max(5000).optional(),
  templates:z.array(workspaceTemplateSchema).max(100).optional(),
}).superRefine((data,ctx)=>{
  const ids = [...data.works.map(w=>w.id), ...data.works.flatMap(w=>w.documents.map(d=>d.id)), ...data.works.flatMap(w=>w.navigation?.nodes.filter(n=>n.type==='folder').map(n=>n.id)||[]), ...data.assets.map(a=>a.id), ...(data.notes||[]).map(n=>n.id), ...(data.noteNavigation?.nodes.filter(n=>n.type==='folder').map(n=>n.id)||[]), ...(data.trash||[]).map(t=>t.id)];

  if (new Set(ids).size !== ids.length) ctx.addIssue({code:'custom',message:'중복된 문서 ID가 있습니다.'});

  if(data.noteNavigation)for(const message of noteNavigationIssues(data.noteNavigation,(data.notes||[]).map(n=>n.id)))ctx.addIssue({code:'custom',message,path:['noteNavigation']});

  if((data.notes||[]).filter(n=>n.aiMessages?.length).length>200)ctx.addIssue({code:'custom',message:'노트 대화는 최대 200개까지 보관할 수 있습니다.'});
  const assets=new Map(data.assets.map(a=>[a.id,a]));
  const workIds=new Set(data.works.map(w=>w.id));

  const templateIds=new Set((data.templates||[]).map(t=>t.id));

  if(templateIds.size!==(data.templates||[]).length||[...templateIds].some(id=>ids.includes(id)))ctx.addIssue({code:'custom',message:'템플릿 ID가 중복됩니다.'});

  for(const template of data.templates||[]){
    const items=template.scope==='work'?template.documents:template.notes;

    if(items.some(d=>d.assetIds.some(id=>assets.get(id)?.templateId!==template.id)))ctx.addIssue({code:'custom',message:'템플릿 첨부 연결을 확인하세요.'});
  }

  for(const item of data.trash||[]){
    if(item.type==='work'){
      if(item.work.documents.some(d=>d.assetIds.some(id=>assets.get(id)?.workId!==item.id)))ctx.addIssue({code:'custom',message:'휴지통 첨부 연결을 확인하세요.',path:['trash']});

      continue;
    }

    const content=item.type==='note'?item.note:item.document;

    if(content.assetIds.some(id=>item.type==='note'?assets.get(id)?.noteId!==item.id:assets.get(id)?.workId!==item.workId))ctx.addIssue({code:'custom',message:'휴지통 첨부 연결을 확인하세요.',path:['trash']});
  }

  for(const note of data.notes||[]){
    if(note.linkedWorkIds.some(id=>!workIds.has(id)))ctx.addIssue({code:'custom',message:'노트에 연결된 작품을 확인하세요.'});

    if(note.assetIds.some(id=>assets.get(id)?.noteId!==note.id))ctx.addIssue({code:'custom',message:'노트 첨부 연결이 손상되었습니다.'});
  }

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

  if(n.type==='hardBreak')return '\n';

  return (n.content||[]).map(plainText).join(['tableRow'].includes(n.type)?'\t':['doc','bulletList','orderedList','table','tableCell','tableHeader'].includes(n.type)?'\n\n':'');
}

export function fromText(text:string):RichNode {
  return {type:'doc',content:text.split(/\n\s*\n/).map(t=>({type:'paragraph',attrs:{blockId:uid()},content:t?[{type:'text',text:t}]:[]}))};
}

export function newDocument(kind:NovelDocument['kind'],title:string):NovelDocument {
  return {id:uid(),kind,title,chapter:'',content:fromText(''),summary:'',status:'draft',category:kind==='wiki'?'기타':'',pov:'',storyTime:'',isPublic:false,publicSummary:'',updatedAt:new Date().toISOString(),assetIds:[]};
}

export function documentTitle(doc:Pick<NovelDocument,'title'>):string{return doc.title.trim()||'제목 없음';}

export function makePublication(work:Work,sceneIds:string[]):Publication {
  const selected=new Set(sceneIds);
  const scenes=work.documents.filter(d=>d.kind==='scene'&&selected.has(d.id));

  if(!scenes.length) throw new Error('공개할 장면을 하나 이상 선택하세요.');

  return publicationSchema.parse({id:uid(),workId:work.id,title:work.title,subtitle:work.subtitle,description:work.description,publishedAt:new Date().toISOString(),
    scenes:scenes.map(d=>({id:d.id,title:d.title,chapter:d.chapter,content:structuredClone(d.content)})),
    wiki:work.documents.filter(d=>d.kind==='wiki'&&d.isPublic&&d.publicSummary.trim()).map(d=>({id:d.id,title:d.title,category:d.category,summary:d.publicSummary})),
  });
}

/** Take a work off the public library. Earlier editions stay in the work's history; publishing again makes a new one. */
export function withdrawPublication(state:Workspace,workId:string):Workspace{
  return {...state,works:state.works.map(w=>w.id===workId?{...w,activePublicationId:null}:w)};
}

export function wikiReferences(content:RichNode):string[] {
  const ids=new Set<string>();

  function visit(n:RichNode){for(const m of n.marks||[])if(m.type==='wikiLink'){const id=z.string().safeParse(m.attrs?.targetId);

if(id.success)ids.add(id.data);}

n.content?.forEach(visit);}

  visit(content);

return [...ids];
}

export function footnotes(content:RichNode):{id:string;text:string}[]{
  const notes:{id:string;text:string}[]=[];

  function visit(n:RichNode){if(n.type==='footnote')notes.push({id:String(n.attrs?.noteId||''),text:String(n.attrs?.text||'')});n.content?.forEach(visit);}

  visit(content);

return notes;
}

export const statuses={idea:'구상',draft:'집필 중',review:'퇴고 중',done:'완성'} as const;
