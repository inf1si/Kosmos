import {getMarkRange} from '@tiptap/core';
import type {Node as PMNode} from '@tiptap/pm/model';
import {EditorState,TextSelection,NodeSelection} from '@tiptap/pm/state';
import {CellSelection} from '@tiptap/pm/tables';
import {closeHistory} from '@tiptap/pm/history';

/** Web links are navigated by the browser; never fetch a URL to generate a preview. */
export function normalizeWebLink(value:string):string|null{
  const text=value.trim();

  if(!text||text.length>4096||/[\u0000-\u0020\u007f]/.test(text))return null;
  const explicit=/^[a-z][a-z\d+.-]*:/i.test(text);

  try{
    const url=new URL(text.startsWith('//')?`https:${text}`:explicit?text:`https://${text}`);

    return ['https:','http:'].includes(url.protocol)&&url.hostname&&!url.username&&!url.password?url.href:null;
  }catch{return null;}
}

/** Typing or pasting links text only when it is written as a web address, so names such as Mr.Kim or readme.md stay text. */
export function explicitWebAddress(value:string){return /^(?:https?:\/\/|www\.)/i.test(value)&&!!normalizeWebLink(value);}

export type WebLinkTarget={document:PMNode;from:number;to:number;href:string;inserting:boolean;linked:boolean};

export function captureWebLink(state:EditorState):WebLinkTarget{
  const selection=state.selection,link=state.schema.marks.link;

  if(selection instanceof NodeSelection||selection instanceof CellSelection||selection.empty&&!selection.$from.parent.isTextblock)throw new Error('글 안에 커서를 놓거나 글을 선택하세요.');
  const range=getMarkRange(selection.$from,link),from=selection.empty&&range?range.from:selection.from,to=selection.empty&&range?range.to:selection.to;
  const mark=range&&range.to>=to?state.doc.nodeAt(range.from)?.marks.find(mark=>mark.type===link):null;

  return {document:state.doc,from,to,href:String(mark?.attrs.href||''),inserting:from===to,linked:from<to&&state.doc.rangeHasMark(from,to,link)};
}

/** Modify text marks only, preserving inline references, footnotes and existing formatting. */
export function webLinkTransaction(state:EditorState,target:WebLinkTarget,value:string|null,label=''){
  if(!state.doc.eq(target.document))throw new Error('글이 바뀌었습니다. 다시 열어주세요.');
  const href=value===null?null:normalizeWebLink(value);

  if(value!==null&&!href)throw new Error('웹 주소를 확인하세요.');
  const link=state.schema.marks.link,tr=closeHistory(state.tr);

  if(target.inserting){
    if(!href)return tr;
    const marks=(state.storedMarks||state.doc.resolve(target.from).marks()).filter(mark=>!['link','wikiLink'].includes(mark.type.name));
    const text=state.schema.text(label.trim()||href,[...marks,link.create({href,target:'_blank',rel:'noopener noreferrer'})]);
    tr.insert(target.from,text).setSelection(TextSelection.create(tr.doc,target.from+text.nodeSize));
  }else{
    state.doc.nodesBetween(target.from,target.to,(node,pos)=>{
      if(!node.isText)return;
      const from=Math.max(pos,target.from),to=Math.min(pos+node.nodeSize,target.to);
      tr.removeMark(from,to,link);

      if(href){tr.removeMark(from,to,state.schema.marks.wikiLink);tr.addMark(from,to,link.create({href,target:'_blank',rel:'noopener noreferrer'}));}
    });
    tr.setSelection(TextSelection.create(tr.doc,target.to));
  }

  tr.removeStoredMark(link);

  return tr;
}
