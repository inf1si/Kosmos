import { Node,Mark,Extension,mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { TableKit } from '@tiptap/extension-table';
import Superscript from '@tiptap/extension-superscript';
import Subscript from '@tiptap/extension-subscript';
import Highlight from '@tiptap/extension-highlight';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Plugin } from '@tiptap/pm/state';
import { uid } from './model';
import { htmlParagraphAttrs,paragraphCss,inlineFontSize,listStyleType,validListStyle } from './manuscript-format';
import { searchPlugin } from './editor-search';

const Note=Node.create({name:'footnote',priority:1000,group:'inline',inline:true,atom:true,
  addAttributes(){return {noteId:{default:null},text:{default:''}};},parseHTML(){return [{tag:'sup[data-note-id]'}];},
  renderHTML({HTMLAttributes}){return ['sup',mergeAttributes({'data-note-id':HTMLAttributes.noteId,class:'editor-note'}), '*'];},
});
const WikiLink=Mark.create({name:'wikiLink',inclusive:false,addAttributes(){return {targetId:{default:null}};},
  parseHTML(){return [{tag:'span[data-wiki-id]'}];},renderHTML({HTMLAttributes}){return ['span',mergeAttributes({'data-wiki-id':HTMLAttributes.targetId,class:'editor-wiki-link'}),0];},
});
const StableBlocks=Extension.create({name:'stableBlocks',
  addGlobalAttributes(){return [{types:['paragraph','heading'],attributes:{blockId:{default:null,parseHTML:el=>el.getAttribute('data-block-id'),renderHTML:attrs=>({'data-block-id':attrs.blockId})}}}];},
  addProseMirrorPlugins(){return [new Plugin({appendTransaction(transactions,_old,state){if(!transactions.some(t=>t.docChanged))return;const tr=state.tr;const seen=new Set<string>();state.doc.descendants((node,pos)=>{if(!['paragraph','heading'].includes(node.type.name))return;const id=node.attrs.blockId as string;if(!id||seen.has(id)){const next=uid();seen.add(next);tr.setNodeMarkup(pos,undefined,{...node.attrs,blockId:next});}else seen.add(id);});return tr.docChanged?tr:null;}})];},
});
const ParagraphFormat=Extension.create({name:'paragraphFormat',addGlobalAttributes(){return [{types:['paragraph','heading'],attributes:Object.fromEntries(['lineHeight','indent','firstLineIndent','spaceBefore','spaceAfter'].map(key=>[key,{default:null,parseHTML:(el:HTMLElement)=>htmlParagraphAttrs(el.getAttribute('style')||'')[key]??null,renderHTML:(attrs:Record<string,unknown>)=>{const style=paragraphCss({[key]:attrs[key]});return style?{style}:{};}}]))}];}});
// Only this editor's own size spans are read back, so text pasted from web pages keeps the manuscript size.
const FontSize=Mark.create({name:'fontSize',
  addAttributes(){return {size:{default:null,parseHTML:el=>inlineFontSize(Number(el.getAttribute('data-font-size')))??null,renderHTML:attrs=>{const size=inlineFontSize(attrs.size);return size?{'data-font-size':String(size),style:`font-size:${size}px`}:{};}}};},
  parseHTML(){return [{tag:'span[data-font-size]'}];},renderHTML({HTMLAttributes}){return ['span',HTMLAttributes,0];},
});
const ListStyle=Extension.create({name:'listStyle',addGlobalAttributes(){return [{types:['bulletList','orderedList'],attributes:{listStyle:{default:null,
  parseHTML:el=>{const type=el.tagName==='OL'?'orderedList':'bulletList',value=el.getAttribute('data-list-style');return value&&validListStyle(type,value)?value:null;},
  renderHTML:attrs=>{const style=listStyleType({type:'bulletList',attrs})??listStyleType({type:'orderedList',attrs});return style?{'data-list-style':style,style:`list-style-type:${style}`}:{};}}}}];}});
// Personal-note image: an attachment of the note shown in the body. The studio view resolves the private blob.
export const NoteImage=Node.create({name:'noteImage',group:'block',atom:true,draggable:true,
  addAttributes(){return {assetId:{default:null},alt:{default:''}};},
  parseHTML(){return [{tag:'figure[data-note-image]',getAttrs:el=>({assetId:(el as HTMLElement).getAttribute('data-note-image'),alt:(el as HTMLElement).getAttribute('data-alt')||''})}];},
  renderHTML({HTMLAttributes}){return ['figure',{'data-note-image':HTMLAttributes.assetId,'data-alt':HTMLAttributes.alt,class:'note-image'}];},
});
const SearchMarks=Extension.create({name:'searchMarks',addProseMirrorPlugins(){return [searchPlugin()];}});
export const editorExtensions=[StarterKit,TextAlign.configure({types:['heading','paragraph']}),TableKit.configure({table:{resizable:true,renderWrapper:true,cellMinWidth:60}}),Superscript.extend({excludes:'subscript'}),Subscript.extend({excludes:'superscript'}),Highlight,FontSize,Note,WikiLink,StableBlocks,ParagraphFormat,ListStyle,SearchMarks];
/** Personal notes add checklists and in-body images. Works keep the base set so their documents never hold these nodes. */
export const noteExtensions=[TaskList,TaskItem.configure({nested:true})];
