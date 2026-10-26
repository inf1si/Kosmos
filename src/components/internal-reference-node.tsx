'use client';

import { Node,mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper,ReactNodeViewRenderer,type NodeViewProps } from '@tiptap/react';
import { internalReferenceSchema,internalReferenceType } from '@/lib/internal-reference-node';
import { referenceLabel } from '@/lib/internal-references';
import { useStudio } from './studio-provider';

function ReferenceNodeView({node,selected}:NodeViewProps){
  const state=useStudio().state,parsed=internalReferenceSchema.safeParse(node.attrs);

  if(!parsed.success)return <NodeViewWrapper as="span" contentEditable={false}/>;
  const ref=parsed.data,currentLabel=state?referenceLabel(state,ref):null;
  const available=currentLabel!==null,label=currentLabel??(ref.label||'제목 없음');

  return <NodeViewWrapper as="span" className={`chip soft internal-reference${selected?' is-selected':''}`} contentEditable={false} role="button" aria-haspopup="dialog" tabIndex={0} aria-label={`참조: ${label}${available?'':' · 사용 불가'}`} data-internal-reference={JSON.stringify(ref)}>@<span>{label}</span>{!available&&<small>사용 불가</small>}</NodeViewWrapper>;
}

export const InternalReferenceNode=Node.create({
  name:internalReferenceType,group:'inline',inline:true,atom:true,
  addAttributes(){return {kind:{default:'note'},targetId:{default:null},workId:{default:null},label:{default:''}};},
  parseHTML(){return [{tag:'span[data-internal-reference]',getAttrs:el=>{try{const parsed=internalReferenceSchema.safeParse(JSON.parse(el.getAttribute('data-internal-reference')||'null'));

return parsed.success?parsed.data:false;}catch{return false;}}}];},
  renderHTML({node,HTMLAttributes}){return ['span',mergeAttributes(HTMLAttributes,{'data-internal-reference':JSON.stringify(node.attrs),class:'chip soft internal-reference'}),`@${node.attrs.label}`];},
  // Only the clipboard reads this: copied prose keeps the name. Counts, search and AI text read the stored JSON or pass their own leaf text.
  renderText({node}){return `@${node.attrs.label}`;},
  addNodeView(){return ReactNodeViewRenderer(ReferenceNodeView,{as:'span'});},
});
