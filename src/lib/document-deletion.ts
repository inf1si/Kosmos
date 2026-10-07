import { applyNavigation, resolveNavigation } from './document-navigation';
import { newDocument, type Workspace, type Work } from './model';

/** Delete one working document while keeping descendants and published snapshots. */
export function removeDocument(state:Workspace,workId:string,docId:string):Workspace {
  const work=state.works.find(w=>w.id===workId),doc=work?.documents.find(d=>d.id===docId);

  if(!work||!doc)throw new Error('삭제할 문서를 찾지 못했습니다.');

  const nav=resolveNavigation(work),node=nav.nodes.find(n=>n.id===docId)!;
  const children=nav.nodes.filter(n=>n.parentId===docId).map(n=>({...n,parentId:node.parentId}));
  const nodes=nav.nodes.flatMap(n=>n.id===docId?children:n.parentId===docId?[]:[n]);
  const documents=work.documents.filter(d=>d.id!==docId);

  if(!documents.length){const replacement=newDocument('scene','새 장면');documents.push(replacement);nodes.push({id:replacement.id,type:'document',sectionId:nav.sections.find(s=>s.defaultKind==='scene')?.id||nav.sections[0].id,parentId:null});}

  const usedAssets=new Set(documents.flatMap(d=>d.assetIds));
  const removedAssets=new Set(doc.assetIds.filter(id=>!usedAssets.has(id)));
  const remaining:Work={...work,documents};

  if(work.aiConversations)remaining.aiConversations=work.aiConversations.filter(c=>c.docId!==docId);
  const next=applyNavigation(remaining,{...nav,nodes});

  return {...state,works:state.works.map(w=>w.id===workId?next:w),assets:state.assets.filter(a=>a.workId!==workId||!removedAssets.has(a.id))};
}
