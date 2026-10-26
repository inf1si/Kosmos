import { z } from 'zod';
import type { RichNode } from './model';

export const internalReferenceType='internalReference';

export const internalReferenceSchema=z.object({
  kind:z.enum(['note','document','note-folder','document-folder','work','shelf']),targetId:z.union([z.uuid(),z.literal('default')]),workId:z.uuid().nullable(),label:z.string().max(300),
}).superRefine((value,ctx)=>{
  const scoped=value.kind==='document'||value.kind==='document-folder';

  if(scoped&&!value.workId||!scoped&&value.workId!==null||value.targetId==='default'&&value.kind!=='shelf')ctx.addIssue({code:'custom',message:'참조 대상을 확인하세요.'});
});

export type InternalReference=z.infer<typeof internalReferenceSchema>;

/** Private reference atoms never enter a public edition, including nested lists and table cells. */
export function withoutInternalReferences(content:RichNode):RichNode{
  const copy=structuredClone(content);

  function visit(node:RichNode){if(node.content)node.content=node.content.filter(child=>child.type!==internalReferenceType).map(child=>{visit(child);

return child;});}

  visit(copy);

  return copy;
}

export function internalReferences(content:RichNode):InternalReference[]{
  const result:InternalReference[]=[];

  function visit(node:RichNode){if(node.type===internalReferenceType){const parsed=internalReferenceSchema.safeParse(node.attrs);

if(parsed.success)result.push(parsed.data);}

node.content?.forEach(visit);}

  visit(content);

  return result;
}
