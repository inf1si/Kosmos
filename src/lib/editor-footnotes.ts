import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';

/** Resolve the live id rather than a position captured before intervening edits. */
export function editorFootnote(doc:ProseMirrorNode,id:string):{index:number;pos:number;text:string;node:ProseMirrorNode}|null{
  let index=0,matches=0,found:{index:number;pos:number;text:string;node:ProseMirrorNode}|null=null;
  doc.descendants((node,pos)=>{
    if(node.type.name!=='footnote')return;
    index++;
    if(node.attrs.noteId===id){matches++;found={index,pos,text:String(node.attrs.text||''),node};}
  });
  return matches===1?found:null;
}

/** Preserve the note id, surrounding text and marks; reject a removed or concurrently changed note. */
export function updateEditorFootnote(tr:Transaction,id:string,original:string,text:string){
  const note=editorFootnote(tr.doc,id),next=text.trim();
  if(!note||note.text!==original||!next)return false;
  if(next!==original)closeHistory(tr).setNodeMarkup(note.pos,undefined,{...note.node.attrs,text:next});
  return true;
}
