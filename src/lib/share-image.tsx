import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SHARE_IMAGE_SIZE, SITE_NAME } from './site-metadata';

// The library's typographic cover in its default colours: a link preview has no reader theme to follow.
const cover='#5f4b8b',ink='#efeaf9',sub='#c9bfe3';

const fontFile=(weight:'Regular'|'Bold')=>readFile(join(process.cwd(),'node_modules/@kfonts/maruburi',`MaruBuri-${weight}.woff`));

function titleSize(title:string){
  const length=[...title].length;

  return length<=10?104:length<=18?84:length<=30?66:52;
}

/** A 1200×630 link preview: the title on the cover colour under the dotted orbit. */
export async function shareImage({title,subtitle='',author=''}:{title:string;subtitle?:string;author?:string}){
  const [regular,bold]=await Promise.all([fontFile('Regular'),fontFile('Bold')]),shown=[...title].length>60?`${[...title].slice(0,59).join('')}…`:title;

  return new ImageResponse(
    <div style={{width:'100%',height:'100%',display:'flex',flexDirection:'column',justifyContent:'space-between',padding:'64px 72px',background:cover,color:ink,fontFamily:'MaruBuri',position:'relative'}}>
      <svg width="520" height="520" viewBox="0 0 170 170" style={{position:'absolute',right:-90,top:-110}}>
        <circle cx="85" cy="85" r="70" fill="none" stroke={ink} strokeWidth="0.9" strokeDasharray="1.5 7" strokeLinecap="round"/>
        <circle cx="85" cy="85" r="44" fill="none" stroke={ink} strokeOpacity="0.5" strokeWidth="0.6"/>
      </svg>
      <div style={{display:'flex',fontSize:24,letterSpacing:'0.18em',color:sub}}>{SITE_NAME.toUpperCase()}</div>
      <div style={{display:'flex',flexDirection:'column',gap:20,maxWidth:720}}>
        <div style={{display:'flex',fontSize:titleSize(shown),fontWeight:700,lineHeight:1.25,wordBreak:'keep-all'}}>{shown}</div>
        {subtitle?<div style={{display:'flex',fontSize:34,lineHeight:1.4,color:sub,wordBreak:'keep-all'}}>{[...subtitle].length>70?`${[...subtitle].slice(0,69).join('')}…`:subtitle}</div>:null}
      </div>
      <div style={{display:'flex',fontSize:28,color:sub}}>{author}</div>
    </div>,
    {...SHARE_IMAGE_SIZE,fonts:[{name:'MaruBuri',data:regular,weight:400,style:'normal'},{name:'MaruBuri',data:bold,weight:700,style:'normal'}]},
  );
}
