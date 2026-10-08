import { newDocument, uid, type NovelDocument, type Work } from './model';
import { navigationIssues, navigationSchema, type DocumentNavigation, type NavigationNode } from './document-navigation-schema';

export type { DocumentNavigation, NavigationNode, NavigationSection } from './document-navigation-schema';

export type DocumentDestination = {sectionId:string;parentId:string|null;beforeId?:string};

export const defaultSections = [
  {id:'scene',title:'원고',defaultKind:'scene' as const},
  {id:'wiki',title:'설정집',defaultKind:'wiki' as const},
  {id:'memo',title:'메모 · 리서치',defaultKind:'memo' as const},
];

/** Stable virtual IDs prevent old workspaces from changing their collapsed folders on every render. */
function legacyFolderId(work:Work,index:number,used:Set<string>){
  let attempt=0,id:string;

  do {let hash=2166136261;

for(const c of `${work.id}:folder:${index}:${attempt++}`)hash=Math.imul(hash^c.charCodeAt(0),16777619);id=`${work.id.slice(0,24)}${(hash>>>0).toString(16).padStart(8,'0')}0000`;}while(used.has(id));

  used.add(id);

return id;
}

export function resolveNavigation(work:Work):DocumentNavigation {
  const nav:DocumentNavigation=work.navigation?structuredClone(work.navigation):{version:1,sections:structuredClone(defaultSections),nodes:[]};

  if(!work.navigation){
    const used=new Set([work.id,...work.documents.map(d=>d.id)]);let chapter:string|undefined,parentId:string|null=null,index=0;

    for(const d of work.documents.filter(d=>d.kind==='scene')){
      if(chapter!==d.chapter){chapter=d.chapter;parentId=legacyFolderId(work,index++,used);nav.nodes.push({id:parentId,type:'folder',title:chapter||'부 미지정',sectionId:'scene',parentId:null});}

      nav.nodes.push({id:d.id,type:'document',sectionId:'scene',parentId});
    }
  }

  const placed=new Set(nav.nodes.filter(n=>n.type==='document').map(n=>n.id));

  for(const d of work.documents){if(placed.has(d.id))continue;let section=nav.sections.find(s=>s.id===d.kind)||nav.sections.find(s=>s.defaultKind===d.kind);

if(!section){section=structuredClone(defaultSections.find(s=>s.id===d.kind)!);nav.sections.push(section);}

nav.nodes.push({id:d.id,type:'document',sectionId:section.id,parentId:null});}

  return nav;
}

export function childrenOf(nav:DocumentNavigation,parentId:string|null,sectionId:string){return nav.nodes.filter(n=>n.parentId===parentId&&n.sectionId===sectionId);}

export function descendantsOf(nav:DocumentNavigation,id:string):Set<string>{
  const children=new Map<string,NavigationNode[]>();

for(const n of nav.nodes)if(n.parentId)children.set(n.parentId,[...(children.get(n.parentId)||[]),n]);
  const ids=new Set<string>();

const visit=(key:string)=>{if(ids.has(key))return;ids.add(key);

for(const n of children.get(key)||[])visit(n.id);};

visit(id);

return ids;
}

export function navigationOrder(nav:DocumentNavigation):string[]{
  const groups=new Map<string,NavigationNode[]>();

for(const n of nav.nodes){const key=`${n.sectionId}/${n.parentId||''}`;groups.set(key,[...(groups.get(key)||[]),n]);}

  const result:string[]=[];const visit=(sectionId:string,parentId:string|null)=>{for(const n of groups.get(`${sectionId}/${parentId||''}`)||[]){if(n.type==='document')result.push(n.id);visit(sectionId,n.id);}};

  for(const s of nav.sections)visit(s.id,null);

return result;
}

export function applyNavigation(work:Work,nav:DocumentNavigation):Work {
  const parsed=navigationSchema.parse(nav),issue=navigationIssues(parsed,work.documents.map(d=>d.id))[0];

if(issue)throw new Error(issue);
  // Also repair missing placements from legacy imports before ordering documents for publication.
  const complete=navigationSchema.parse(resolveNavigation({...work,navigation:parsed})),documents=new Map(work.documents.map(d=>[d.id,d]));

  return {...work,navigation:complete,documents:navigationOrder(complete).map(id=>documents.get(id)!)};
}

export function moveNavigation(work:Work,id:string,to:DocumentDestination):Work {
  const nav=resolveNavigation(work),node=nav.nodes.find(n=>n.id===id);

if(!node)throw new Error('이동할 문서를 찾지 못했습니다.');
  const subtree=descendantsOf(nav,id),parent=nav.nodes.find(n=>n.id===to.parentId);

  if(!nav.sections.some(s=>s.id===to.sectionId)||(to.parentId&&(!parent||parent.sectionId!==to.sectionId)))throw new Error('이동할 위치를 찾지 못했습니다.');

  if(to.parentId&&subtree.has(to.parentId))throw new Error('자신이나 자신의 하위 문서로 옮길 수 없습니다.');

  if(to.beforeId===id&&node.parentId===to.parentId&&node.sectionId===to.sectionId)return work;
  const rest=nav.nodes.filter(n=>!subtree.has(n.id));
  const siblings=rest.filter(n=>n.parentId===to.parentId&&n.sectionId===to.sectionId);

  if(to.beforeId&&!siblings.some(n=>n.id===to.beforeId))throw new Error('순서를 정할 문서를 찾지 못했습니다.');
  const block=nav.nodes.filter(n=>subtree.has(n.id)).map(n=>({...n,sectionId:to.sectionId,parentId:n.id===id?to.parentId:n.parentId}));
  const before=to.beforeId?rest.findIndex(n=>n.id===to.beforeId):-1;
  // Appending after all nodes is safe: sibling order is the array order, while children keep their own order.
  rest.splice(before<0?rest.length:before,0,...block);nav.nodes=rest;

return applyNavigation(work,nav);
}

export function siblingDestination(work:Work,id:string,direction:number):DocumentDestination|null {
  const nav=resolveNavigation(work),node=nav.nodes.find(n=>n.id===id);

if(!node)return null;
  const siblings=childrenOf(nav,node.parentId,node.sectionId),index=siblings.findIndex(n=>n.id===id),next=index+direction;

if(next<0||next>=siblings.length)return null;

  return {sectionId:node.sectionId,parentId:node.parentId,beforeId:direction<0?siblings[next].id:siblings[next+1]?.id};
}

export function insertDocument(work:Work,doc:NovelDocument,to?:DocumentDestination):Work {
  if(work.documents.length>=5000)throw new Error('한 작품에는 문서를 5,000개까지 만들 수 있습니다.');
  const nav=resolveNavigation(work),section=nav.sections.find(s=>s.id===doc.kind)||nav.sections.find(s=>s.defaultKind===doc.kind)||nav.sections[0];
  const next={...work,documents:[...work.documents,doc],navigation:nav};nav.nodes.push({id:doc.id,type:'document',sectionId:section.id,parentId:null});

  return to?moveNavigation(next,doc.id,to):applyNavigation(next,nav);
}

type CreatedDocument={work:Work;document:NovelDocument};

export function createNavigationDocument(work:Work,kind:NovelDocument['kind'],to:DocumentDestination):CreatedDocument{
  const doc=newDocument(kind,kind==='scene'?'새 문서':kind==='wiki'?'새 설정':'새 메모');

  return {work:insertDocument(work,doc,to),document:doc};
}

export function insertFolder(work:Work,title:string,to:DocumentDestination):Work {
  const nav=resolveNavigation(work),id=uid();nav.nodes.push({id,type:'folder',title,sectionId:to.sectionId,parentId:null});

return moveNavigation({...work,navigation:nav},id,to);
}

export type NavigationSnapshot={navigation:DocumentNavigation;documentOrder:string[]};

export function navigationSnapshot(work:Work):NavigationSnapshot{return {navigation:resolveNavigation(work),documentOrder:work.documents.map(d=>d.id)};}

/** Partial exports omit unselected documents and reparent their children to the nearest retained ancestor. */
export function subsetNavigation(nav:DocumentNavigation,documentIds:string[],keepEmpty=false):DocumentNavigation {
  const selected=new Set(documentIds),nodes=new Map(nav.nodes.map(n=>[n.id,n])),keep=new Set(documentIds);

  for(const n of nav.nodes)if(keepEmpty&&n.type==='folder')keep.add(n.id);

  for(const id of [...keep]){let parent=nodes.get(id)?.parentId;

while(parent){const n=nodes.get(parent)!;

if(n.type==='folder')keep.add(n.id);parent=n.parentId;}}

  const retained=nav.nodes.filter(n=>n.type==='folder'?keep.has(n.id):selected.has(n.id)).map(n=>{let parentId=n.parentId;

while(parentId&&!keep.has(parentId))parentId=nodes.get(parentId)!.parentId;

return {...n,parentId};});

  const sections=nav.sections.filter(s=>keepEmpty||retained.some(n=>n.sectionId===s.id));

return {version:1,sections:structuredClone(sections),nodes:retained};
}

/** Restores organization only. Manuscript edits and documents created in the meantime survive undo. */
export function restoreNavigation(work:Work,snapshot:NavigationSnapshot):Work {
  const ids=new Set(work.documents.map(d=>d.id)),nav=structuredClone(snapshot.navigation);nav.nodes=nav.nodes.filter(n=>n.type==='folder'||ids.has(n.id));
  const existing=new Set(nav.nodes.map(n=>n.id));

for(const n of nav.nodes)if(n.parentId&&!existing.has(n.parentId))n.parentId=null;
  const next=applyNavigation(work,nav),documents=new Map(next.documents.map(d=>[d.id,d]));

return {...next,documents:[...snapshot.documentOrder.filter(id=>documents.has(id)).map(id=>documents.get(id)!),...next.documents.filter(d=>!snapshot.documentOrder.includes(d.id))]};
}
