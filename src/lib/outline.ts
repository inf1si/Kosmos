import { NovelDocument, plainText } from './model';

export type SceneGroup={key:string;kicker:string;title:string;scenes:NovelDocument[]};

/** Characters without whitespace, the count shown everywhere in the studio. */
export function countChars(doc:NovelDocument){return plainText(doc.content).replace(/\s/g,'').length;}

/** "제1부 · 남겨진 시간" → kicker "제1부", title "남겨진 시간". A label without "·" is all title. */
export function splitLabel(label:string,empty:string):{kicker:string;title:string}{
  const text=label.trim();if(!text)return {kicker:'',title:empty};
  const at=text.indexOf('·');if(at<0)return {kicker:'',title:text};
  const kicker=text.slice(0,at).trim(),title=text.slice(at+1).trim();
  return title?{kicker,title}:{kicker:'',title:kicker};
}

/** The part a story time belongs to: "귀환일 · 08:40" → "귀환일". */
export function storyDay(storyTime:string){return storyTime.split('·')[0].trim();}

/**
 * Scenes grouped by a key in manuscript order. Without merge, only neighbouring scenes share a group,
 * so the sidebar shows the real order; with merge, a key that comes back later joins its first group.
 */
export function groupScenes(scenes:NovelDocument[],keyOf:(doc:NovelDocument)=>string,empty:string,merge=false):SceneGroup[]{
  const groups:SceneGroup[]=[];
  for(const doc of scenes){
    const key=keyOf(doc).trim();
    const group=merge?groups.find(g=>g.key===key):groups.at(-1)?.key===key?groups.at(-1):undefined;
    if(group)group.scenes.push(doc);else groups.push({key,...splitLabel(key,empty),scenes:[doc]});
  }
  return groups;
}

/** Where a new scene in this part goes: after the part's last scene, else after the last scene. */
export function sceneInsertIndex(documents:NovelDocument[],chapter:string){
  let part=-1,scene=-1;
  documents.forEach((d,i)=>{if(d.kind!=='scene')return;scene=i;if(d.chapter.trim()===chapter.trim())part=i;});
  return (part>=0?part:scene>=0?scene:documents.length-1)+1;
}

/** "제N부" one past the highest numbered part. */
export function nextPartLabel(scenes:NovelDocument[]){
  const numbers=scenes.map(d=>/^제\s*(\d+)\s*부/.exec(d.chapter.trim())?.[1]).filter(Boolean).map(Number);
  return `제${(numbers.length?Math.max(...numbers):0)+1}부`;
}
