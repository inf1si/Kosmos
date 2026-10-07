import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin,PluginKey } from '@tiptap/pm/state';
import { Decoration,DecorationSet } from '@tiptap/pm/view';

export type SearchOptions={query:string;caseSensitive:boolean;wholeWord:boolean};

export type SearchMatch={from:number;to:number};

export const searchKey=new PluginKey<SearchOptions>('manuscriptSearch');

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
