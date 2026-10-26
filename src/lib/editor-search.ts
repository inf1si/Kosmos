import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin,PluginKey } from '@tiptap/pm/state';
import { Decoration,DecorationSet } from '@tiptap/pm/view';

export type SearchOptions={query:string;caseSensitive:boolean;wholeWord:boolean};

export type SearchMatch={from:number;to:number};

export const searchKey=new PluginKey<SearchOptions>('manuscriptSearch');

export const searchJumpKey=new PluginKey<SearchMatch|null>('workspaceSearchJump');

const empty:SearchOptions={query:'',caseSensitive:false,wholeWord:false};

const cache=new WeakMap<ProseMirrorNode,{key:string;matches:SearchMatch[]}>();

/** Match across adjacent formatted text, never across paragraphs or inline atoms such as footnotes. */
export function searchMatches(doc:ProseMirrorNode,options:SearchOptions):SearchMatch[]{
  if(!options.query||options.query.length>500)return [];
  const key=JSON.stringify(options),cached=cache.get(doc);

if(cached?.key===key)return cached.matches;
  const result:SearchMatch[]=[],escaped=options.query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),pattern=new RegExp(escaped,options.caseSensitive?'gu':'giu');
  doc.descendants((block,pos)=>{if(!block.isTextblock)return;let value='',start=pos+1;

    const flush=()=>{for(const match of value.matchAll(pattern)){const at=match.index!,end=at+match[0].length;

      if(options.wholeWord&&(/[\p{L}\p{N}\p{M}_]$/u.test(value.slice(Math.max(0,at-2),at))||/^[\p{L}\p{N}\p{M}_]/u.test(value.slice(end,end+2))))continue;
      result.push({from:start+at,to:start+end});}

value='';};

    block.forEach((child,offset)=>{if(child.isText){if(!value)start=pos+1+offset;value+=child.text;}else flush();});flush();

return false;
  });cache.set(doc,{key,matches:result});

return result;
}

export function searchPlugin(){return new Plugin<SearchOptions>({key:searchKey,state:{init:()=>empty,apply:(tr,value)=>tr.getMeta(searchKey)??value},props:{decorations(state){
  const matches=searchMatches(state.doc,searchKey.getState(state)||empty);

return DecorationSet.create(state.doc,matches.map(m=>Decoration.inline(m.from,m.to,{class:state.selection.from===m.from&&state.selection.to===m.to?'editor-search-match current':'editor-search-match'})));
}}});}

export function searchJumpPlugin(){return new Plugin<SearchMatch|null>({key:searchJumpKey,state:{init:()=>null,apply:(tr,value,old)=>{
  const next:SearchMatch|null|undefined=tr.getMeta(searchJumpKey);

  return next!==undefined?next:tr.docChanged||tr.selectionSet&&!tr.selection.eq(old.selection)?null:value;
}},props:{decorations(state){const range=searchJumpKey.getState(state);

return range?DecorationSet.create(state.doc,[Decoration.inline(range.from,range.to,{class:'editor-search-match current'})]):null;},handleKeyDown(view,event){if(event.key!=='Escape'||!searchJumpKey.getState(view.state))return false;view.dispatch(view.state.tr.setMeta(searchJumpKey,null).setMeta('addToHistory',false));

return true;}}});}
