import type { Command } from '@tiptap/core';
import { NodeRange } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { canJoin,liftTarget } from '@tiptap/pm/transform';

const itemTypes=new Set(['listItem','taskItem']);

/** Text blocks of the selection that sit directly in a list item, and whether the selection touches a list at all. */
function selectedLines(tr:Transaction){
  const lines:number[]=[];let listed=false;

  for(const {$from,$to} of tr.selection.ranges)tr.doc.nodesBetween($from.pos,$to.pos,(node,pos,parent)=>{
    if(!node.isTextblock)return true;
    const $pos=tr.doc.resolve(pos);

    for(let depth=$pos.depth;depth>0;depth--)if(itemTypes.has($pos.node(depth).type.name))listed=true;

    if(parent&&itemTypes.has(parent.type.name)&&!lines.includes(pos+1))lines.push(pos+1);

    return false;
  });

  return {lines,listed};
}

/**
 * Takes the text block around `inside` out of every list it is in, up to the left edge of the lists.
 * Each pass lifts the block and whatever follows it in its item one level. The items before it keep
 * their place; the items after it lose their parent and follow as a list of their own.
 */
function leaveLists(tr:Transaction,inside:number){
  let at=inside;

  for(let $pos=tr.doc.resolve(at);$pos.depth>1&&itemTypes.has($pos.node($pos.depth-1).type.name);$pos=tr.doc.resolve(at)){
    const depth=$pos.depth-1,contentEnd=$pos.end(depth),last=$pos.index(depth-1)===$pos.node(depth-1).childCount-1;
    const range=new NodeRange($pos,tr.doc.resolve(contentEnd),depth),target=liftTarget(range),from=tr.steps.length;

    if(target===null)return;
    tr.lift(range,target);
    const joint=tr.mapping.slice(from).map(contentEnd,-1),$joint=tr.doc.resolve(joint);

    // A child list of the block and the rest of the split list now sit side by side: one list.
    if(!last&&$joint.nodeBefore&&$joint.nodeBefore.type===$joint.nodeAfter?.type&&canJoin(tr.doc,joint))tr.join(joint);
    at=tr.mapping.slice(from).map(at);
  }
}

/**
 * Paragraph style for the selected blocks. Tiptap's setNode falls back to clearNodes inside a list,
 * which lifts every ancestor of the cursor and so pulls the items above a nested item up a level.
 * Here the selected line leaves the list altogether and the items above it stay as they were.
 */
export const blockStyle=(level:0|1|2|3):Command=>({state,tr,dispatch,commands})=>{
  const {lines,listed}=selectedLines(tr);

  if(!listed)return level?commands.setHeading({level}):commands.setParagraph();

  if(!dispatch)return true;

  // Last line first, so the positions of the earlier lines are still valid.
  for(const inside of lines.reverse())leaveLists(tr,inside);

  const type=level?state.schema.nodes.heading:state.schema.nodes.paragraph;

  for(const {$from,$to} of tr.selection.ranges)tr.setBlockType($from.pos,$to.pos,type,node=>level?{...node.attrs,level}:node.attrs);

  return true;
};
