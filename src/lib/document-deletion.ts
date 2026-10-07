import { applyNavigation, resolveNavigation } from './document-navigation';
import type { Workspace, Work } from './model';

/** Delete one working document while keeping descendants and published snapshots. */
export function removeDocument(state:Workspace,workId:string,docId:string):Workspace {
  const work=state.works.find(w=>w.id===workId),doc=work?.documents.find(d=>d.id===docId);

  if(!work||!doc)throw new Error('삭제할 문서를 찾지 못했습니다.');

  if(work.documents.length<=1)throw new Error('작품에는 문서를 최소 1개 남겨야 합니다. 다른 문서를 만든 뒤 삭제하세요.');
  const nav=resolveNavigation(work),node=nav.nodes.find(n=>n.id===docId)!;
  const children=nav.nodes.filter(n=>n.parentId===docId).map(n=>({...n,parentId:node.parentId}));
  const nodes=nav.nodes.flatMap(n=>n.id===docId?children:n.parentId===docId?[]:[n]);
  const documents=work.documents.filter(d=>d.id!==docId),usedAssets=new Set(documents.flatMap(d=>d.assetIds));
  const removedAssets=new Set(doc.assetIds.filter(id=>!usedAssets.has(id)));
  const remaining:Work={...work,documents};

  if(work.aiConversations)remaining.aiConversations=work.aiConversations.filter(c=>c.docId!==docId);
  const next=applyNavigation(remaining,{...nav,nodes});

  return {...state,works:state.works.map(w=>w.id===workId?next:w),assets:state.assets.filter(a=>a.workId!==workId||!removedAssets.has(a.id))};
}
