import type { Command } from '@tiptap/core';
import { NodeRange } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { liftTarget } from '@tiptap/pm/transform';

const itemTypes=new Set(['listItem','taskItem']);

/** List items whose own first line is selected, and whether the selection touches a list at all. */
function selectedItems(tr:Transaction){
  const items:number[]=[];let listed=false;

  for(const {$from,$to} of tr.selection.ranges)tr.doc.nodesBetween($from.pos,$to.pos,(node,pos)=>{
    if(!node.isTextblock)return true;
    const $pos=tr.doc.resolve(pos);

    for(let depth=$pos.depth;depth>0;depth--)if(itemTypes.has($pos.node(depth).type.name)){
      listed=true;

      if(depth===$pos.depth&&$pos.index(depth)===0&&!items.includes($pos.before(depth)))items.push($pos.before(depth));
    }

    return false;
  });

  return {items,listed};
}

/**
 * Paragraph style for the selected blocks. Tiptap's setNode falls back to clearNodes inside a list,
 * which lifts every ancestor of the cursor and so pulls the sibling items of a nested item up a level.
 * Here only the selected item leaves its list: the list splits around it and the siblings stay put.
 */
export const blockStyle=(level:0|1|2|3):Command=>({state,tr,dispatch,commands})=>{
  const {items,listed}=selectedItems(tr);

  if(!listed)return level?commands.setHeading({level}):commands.setParagraph();

  if(!dispatch)return true;

  // Last item first, so the positions of the earlier items are still valid.
  for(const pos of items.reverse()){
    const item=tr.doc.nodeAt(pos);

    if(!item)continue;
    const $start=tr.doc.resolve(pos+1),range=new NodeRange($start,tr.doc.resolve(pos+item.nodeSize-1),$start.depth),target=liftTarget(range);

    if(target!==null)tr.lift(range,target);
  }

  const type=level?state.schema.nodes.heading:state.schema.nodes.paragraph;

  for(const {$from,$to} of tr.selection.ranges)tr.setBlockType($from.pos,$to.pos,type,node=>level?{...node.attrs,level}:node.attrs);

  return true;
};
