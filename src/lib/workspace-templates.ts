import { documentTitle, uid, workspaceSchema, workspaceTemplateSchema, type AssetMeta, type NovelDocument, type PersonalNote, type RichNode, type Workspace, type WorkspaceTemplate } from './model';
import { applyNavigation, descendantsOf, navigationOrder, resolveNavigation, type DocumentDestination, type DocumentNavigation } from './document-navigation';
import { applyNoteNavigation, noteTitle, noteTreeWork, resolveNoteNavigation, type NoteDestination } from './note-navigation';
import { asNoteNavigation } from './note-navigation-schema';

export type TemplateSource={scope:'work';workId:string}|{scope:'notes'};

export type TemplateTarget={scope:'work';workId:string;to:DocumentDestination}|{scope:'notes';to:NoteDestination};

type Copies={sourceId:string;id:string}[];

export function templateTree(state:Workspace,source:TemplateSource){
  const work=source.scope==='notes'?noteTreeWork(state):state.works.find(w=>w.id===source.workId);

  if(!work)throw new Error('작품을 찾지 못했습니다.');

  return work;
}

/** A selected folder or parent document includes its descendants, once, in the saved tree order. */
export function templateSelection(nav:DocumentNavigation,selected:string[]):Set<string>{
  const ids=new Set<string>();

  for(const id of selected){
    if(!nav.nodes.some(n=>n.id===id))throw new Error('선택한 항목을 찾지 못했습니다.');

    for(const child of descendantsOf(nav,id))ids.add(child);
  }

  return ids;
}

function copyContent(content:RichNode,ids:Map<string,string>,assets:Map<string,string>):RichNode{
  const copy=structuredClone(content);

  function visit(node:RichNode){
    if(node.attrs?.blockId)node.attrs.blockId=uid();

    if(node.type==='footnote'&&node.attrs)node.attrs.noteId=uid();

    if(node.type==='noteImage'&&node.attrs){
      const id=assets.get(String(node.attrs.assetId));

      if(!id)throw new Error('템플릿 본문 이미지의 첨부를 확인하세요.');
      node.attrs.assetId=id;
    }

    if(node.marks)node.marks=node.marks.flatMap(mark=>{
      if(mark.type!=='wikiLink')return [mark];
      const targetId=ids.get(String(mark.attrs?.targetId));

      return targetId?[{...mark,attrs:{...mark.attrs,targetId}}]:[];
    });
    node.content?.forEach(visit);
  }

  visit(copy);

return copy;
}

function cloneItems<T extends NovelDocument|PersonalNote>(items:T[],nav:DocumentNavigation,assets:AssetMeta[],owner:(item:T)=>Pick<AssetMeta,'workId'|'noteId'|'templateId'>){
  const ids=new Map(nav.nodes.map(n=>[n.id,uid()])),assetIds=new Map<string,string>(),metadata:AssetMeta[]=[],copies:Copies=[];

  for(const item of items)for(const sourceId of item.assetIds){
    if(assetIds.has(sourceId))continue;
    const original=assets.find(a=>a.id===sourceId);

    if(!original)throw new Error('템플릿 첨부를 찾지 못했습니다.');
    const id=uid();assetIds.set(sourceId,id);copies.push({sourceId,id});
    metadata.push({id,...owner({...item,id:ids.get(item.id)!}),name:original.name,type:original.type,size:original.size});
  }

  const now=new Date().toISOString();

  const documents=items.map(item=>{
    const copy={...structuredClone(item),id:ids.get(item.id)!,content:copyContent(item.content,ids,assetIds),assetIds:item.assetIds.map(id=>assetIds.get(id)!),updatedAt:now};

    if(item.customProperties)copy.customProperties=item.customProperties.map(p=>({...p,id:uid()}));

    return copy;
  });

  const navigation={...structuredClone(nav),nodes:nav.nodes.map(n=>({...n,id:ids.get(n.id)!,parentId:n.parentId?ids.get(n.parentId)!:null}))};

  return {documents,navigation,assets:metadata,copies};
}

export function prepareTemplate(state:Workspace,source:TemplateSource,selected:string[],name:string){
  if((state.templates?.length||0)>=100)throw new Error('템플릿은 100개까지 보관할 수 있습니다.');
  const work=templateTree(state,source),nav=resolveNavigation(work),selection=templateSelection(nav,selected);
  const selectedNav={...nav,nodes:nav.nodes.filter(n=>selection.has(n.id)).map(n=>({...n,parentId:n.parentId&&selection.has(n.parentId)?n.parentId:null}))};
  const order=navigationOrder(selectedNav),id=uid();

  if(!order.length)throw new Error('템플릿에 담을 문서를 선택하세요.');
  const base={id,name,createdAt:new Date().toISOString()};
  let template:WorkspaceTemplate,copies:Copies,assets:AssetMeta[];

  if(source.scope==='work'){
    const cloned=cloneItems(order.map(id=>work.documents.find(d=>d.id===id)!),selectedNav,state.assets,()=>({templateId:id}));
    template=workspaceTemplateSchema.parse({...base,scope:'work',documents:cloned.documents.map(d=>({...d,isPublic:false})),navigation:cloned.navigation});
    copies=cloned.copies;assets=cloned.assets;
  }else{
    const cloned=cloneItems(order.map(id=>state.notes!.find(n=>n.id===id)!),selectedNav,state.assets,()=>({templateId:id}));
    template=workspaceTemplateSchema.parse({...base,scope:'notes',notes:cloned.documents.map(({aiMessages:_,...note})=>({...note,linkedWorkIds:[],pinned:false})),navigation:cloned.navigation});
    copies=cloned.copies;assets=cloned.assets;
  }

  return {state:workspaceSchema.parse({...state,templates:[...(state.templates||[]),template],assets:[...state.assets,...assets]}),templateId:id,copies};
}

export function prepareTemplateApplication(state:Workspace,id:string,target:TemplateTarget){
  const template=state.templates?.find(t=>t.id===id);

  if(!template||template.scope!==target.scope)throw new Error('적용할 템플릿을 확인하세요.');

  if(template.scope==='work'&&target.scope==='work'){
    const work=templateTree(state,target),nav=resolveNavigation(work);

    if(!nav.sections.some(s=>s.id===target.to.sectionId)||target.to.parentId&&!nav.nodes.some(n=>n.id===target.to.parentId&&n.sectionId===target.to.sectionId))throw new Error('템플릿을 넣을 위치를 확인하세요.');
    const cloned=cloneItems(template.documents,template.navigation,state.assets,()=>({workId:work.id}));
    const nodes=cloned.navigation.nodes.map(n=>({...n,sectionId:target.to.sectionId,parentId:n.parentId??target.to.parentId}));
    const documents=cloned.documents.map(d=>({...d,isPublic:false,status:'draft' as const}));
    const next=applyNavigation({...work,documents:[...work.documents,...documents]},{...nav,nodes:[...nav.nodes,...nodes]});

    return {state:workspaceSchema.parse({...state,works:state.works.map(w=>w.id===work.id?next:w),assets:[...state.assets,...cloned.assets]}),documentIds:documents.map(d=>d.id),copies:cloned.copies};
  }

  if(template.scope!=='notes'||target.scope!=='notes')throw new Error('템플릿의 공간을 확인하세요.');
  const nav=resolveNoteNavigation(state);

  if(target.to.parentId&&!nav.nodes.some(n=>n.id===target.to.parentId))throw new Error('템플릿을 넣을 위치를 확인하세요.');
  const cloned=cloneItems(template.notes,template.navigation,state.assets,n=>({noteId:n.id}));
  const nodes=asNoteNavigation(cloned.navigation).nodes.map(n=>({...n,parentId:n.parentId??target.to.parentId}));
  const notes=cloned.documents.map(n=>({...n,linkedWorkIds:[],pinned:false,createdAt:new Date().toISOString()}));
  const next=applyNoteNavigation({...state,notes:[...(state.notes||[]),...notes],assets:[...state.assets,...cloned.assets]},{...nav,nodes:[...nav.nodes,...nodes]});

  return {state:workspaceSchema.parse(next),documentIds:notes.map(n=>n.id),copies:cloned.copies};
}

export function removeTemplate(state:Workspace,id:string):Workspace{
  return workspaceSchema.parse({...state,templates:(state.templates||[]).filter(t=>t.id!==id),assets:state.assets.filter(a=>a.templateId!==id)});
}

/** Older full backups omit these fields. An explicit empty list still removes them. */
export function preserveTemplateData(candidate:Workspace,previous:Workspace):Workspace{
  let next=candidate;

  if(candidate.templates===undefined&&previous.templates!==undefined){
    const present=new Set(candidate.assets.map(a=>a.id));
    next={...next,templates:structuredClone(previous.templates),assets:[...next.assets,...previous.assets.filter(a=>a.templateId&&!present.has(a.id))]};
  }

  const previousItems=[...previous.works.flatMap(w=>w.documents),...(previous.notes||[]),...(previous.trash||[]).flatMap<NovelDocument|PersonalNote>(t=>t.type==='work'?t.work.documents:t.type==='document'?[t.document]:[t.note])];
  const properties=new Map(previousItems.flatMap(d=>d.customProperties!==undefined?[[d.id,d.customProperties] as const]:[]));
  const keep=<T extends NovelDocument|PersonalNote>(doc:T):T=>doc.customProperties===undefined&&properties.has(doc.id)?{...doc,customProperties:structuredClone(properties.get(doc.id)!)}:doc;

  return {...next,works:next.works.map(w=>({...w,documents:w.documents.map(keep)})),notes:next.notes?.map(keep),trash:next.trash?.map(t=>t.type==='work'?{...t,work:{...t.work,documents:t.work.documents.map(keep)}}:t.type==='document'?{...t,document:keep(t.document)}:{...t,note:keep(t.note)})};
}

export function templateItemTitle(template:WorkspaceTemplate,id:string):string{
  return template.scope==='work'?documentTitle(template.documents.find(d=>d.id===id)!):noteTitle(template.notes.find(n=>n.id===id)!);
}
