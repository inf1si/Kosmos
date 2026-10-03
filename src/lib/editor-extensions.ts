import { Node,Mark,Extension,mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { TableKit } from '@tiptap/extension-table';
import Superscript from '@tiptap/extension-superscript';
import Subscript from '@tiptap/extension-subscript';
import Highlight from '@tiptap/extension-highlight';
import { Plugin } from '@tiptap/pm/state';
import { uid } from './model';
import { htmlParagraphAttrs,paragraphCss } from './manuscript-format';
import { searchPlugin } from './editor-search';

const Note=Node.create({name:'footnote',priority:1000,group:'inline',inline:true,atom:true,
  addAttributes(){return {noteId:{default:null},text:{default:''}};},parseHTML(){return [{tag:'sup[data-note-id]'}];},
  renderHTML({HTMLAttributes}){return ['sup',mergeAttributes({'data-note-id':HTMLAttributes.noteId,class:'editor-note',title:HTMLAttributes.text}), '*'];},
});
const WikiLink=Mark.create({name:'wikiLink',inclusive:false,addAttributes(){return {targetId:{default:null}};},
  parseHTML(){return [{tag:'span[data-wiki-id]'}];},renderHTML({HTMLAttributes}){return ['span',mergeAttributes({'data-wiki-id':HTMLAttributes.targetId,class:'editor-wiki-link'}),0];},
});
const StableBlocks=Extension.create({name:'stableBlocks',
  addGlobalAttributes(){return [{types:['paragraph','heading'],attributes:{blockId:{default:null,parseHTML:el=>el.getAttribute('data-block-id'),renderHTML:attrs=>({'data-block-id':attrs.blockId})}}}];},
  addProseMirrorPlugins(){return [new Plugin({appendTransaction(transactions,_old,state){if(!transactions.some(t=>t.docChanged))return;const tr=state.tr;const seen=new Set<string>();state.doc.descendants((node,pos)=>{if(!['paragraph','heading'].includes(node.type.name))return;const id=node.attrs.blockId as string;if(!id||seen.has(id)){const next=uid();seen.add(next);tr.setNodeMarkup(pos,undefined,{...node.attrs,blockId:next});}else seen.add(id);});return tr.docChanged?tr:null;}})];},
});
const ParagraphFormat=Extension.create({name:'paragraphFormat',addGlobalAttributes(){return [{types:['paragraph','heading'],attributes:Object.fromEntries(['lineHeight','indent','firstLineIndent','spaceBefore','spaceAfter'].map(key=>[key,{default:null,parseHTML:(el:HTMLElement)=>htmlParagraphAttrs(el.getAttribute('style')||'')[key]??null,renderHTML:(attrs:Record<string,unknown>)=>{const style=paragraphCss({[key]:attrs[key]});return style?{style}:{};}}]))}];}});
const SearchMarks=Extension.create({name:'searchMarks',addProseMirrorPlugins(){return [searchPlugin()];}});
export const editorExtensions=[StarterKit,TextAlign.configure({types:['heading','paragraph']}),TableKit.configure({table:{resizable:true,renderWrapper:true,cellMinWidth:60}}),Superscript.extend({excludes:'subscript'}),Subscript.extend({excludes:'superscript'}),Highlight,Note,WikiLink,StableBlocks,ParagraphFormat,SearchMarks];
