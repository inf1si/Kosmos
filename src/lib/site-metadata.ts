import type { Metadata, MetadataRoute } from 'next';
import { documentTitle, plainText, type Publication } from './model';

export const SITE_NAME='Orbis Tertius';

export const SITE_DESCRIPTION='소설과 설정집을 읽는 서재.';

export const SHARE_IMAGE_SIZE={width:1200,height:630};

const DESCRIPTION_LIMIT=150;

type SiteEnvironment={NEXT_PUBLIC_SITE_URL?:string;VERCEL_ENV?:string;VERCEL_PROJECT_PRODUCTION_URL?:string;VERCEL_URL?:string;NODE_ENV?:string};

function origin(value:string|undefined){
  if(!value)return '';

  try{return new URL(/^https?:\/\//.test(value)?value:`https://${value}`).origin;}catch{return '';}
}

/** The address search engines and link previews should use: the configured one, then Vercel's production domain. */
export function siteUrl(env:SiteEnvironment=process.env){
  return origin(env.NEXT_PUBLIC_SITE_URL)||origin(env.VERCEL_ENV==='production'?env.VERCEL_PROJECT_PRODUCTION_URL:env.VERCEL_URL)||origin(env.VERCEL_PROJECT_PRODUCTION_URL)||'http://localhost:3210';
}

/** Preview deployments and local runs stay out of search results. */
export function searchIndexable(env:SiteEnvironment=process.env){
  return env.VERCEL_ENV?env.VERCEL_ENV==='production':env.NODE_ENV==='production';
}

/** One line of at most `limit` characters, cut at a word where one is near. */
export function metaDescription(text:string,limit=DESCRIPTION_LIMIT){
  const line=text.replace(/\s+/g,' ').trim();

  if(line.length<=limit)return line;

  const cut=line.slice(0,limit-1),space=cut.lastIndexOf(' ');

  return `${(space>limit*0.6?cut.slice(0,space):cut).replace(/[\s,.;:·]+$/,'')}…`;
}

/** Markdown source as a plain sentence: marks and link targets removed, link text kept. */
export function plainMarkdown(source:string){
  return source.replace(/!\[[^\]]*\]\([^)]*\)/g,' ').replace(/\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm,'').replace(/[*_`~]+/g,'');
}

/** The author's description, else the subtitle, else the opening of the published text. */
export function workDescription(pub:Publication){
  const written=metaDescription(pub.description)||metaDescription(pub.subtitle);

  if(written)return written;

  let opening='';

  for(const scene of pub.scenes){
    for(const block of scene.content.content||[]){
      if(block.type!=='paragraph')continue;

      opening+=`${plainText(block)} `;

      if(opening.length>DESCRIPTION_LIMIT*2)return metaDescription(opening);
    }
  }

  return metaDescription(opening);
}

export function libraryDescription(pubs:Publication[],author:string){
  const titles=pubs.map(pub=>`「${pub.title}」`).join(' ');

  return metaDescription([author&&`${author}의 서재.`,titles].filter(Boolean).join(' '))||SITE_DESCRIPTION;
}

export function wikiDescription(pub:Publication){
  return metaDescription(`「${pub.title}」 설정집. ${pub.wiki.map(documentTitle).join(', ')}`);
}

/** Page metadata with its own canonical address and link preview; a page's `openGraph` replaces the layout's, so each page states all of it. */
export function pageMetadata({title,description,path,article,index=true}:{title?:string;description:string;path:string;article?:{publishedTime?:string;author?:string};index?:boolean}):Metadata{
  const shown=title||SITE_NAME,metadata:Metadata={description,alternates:{canonical:path}};

  if(title)metadata.title=title;

  if(!index)metadata.robots={index:false,follow:false};

  if(article){
    // A reading page draws its own image beside it.
    const openGraph:Metadata['openGraph']={title:shown,description,url:path,siteName:SITE_NAME,locale:'ko_KR',type:'article'};

    if(article.publishedTime)openGraph.publishedTime=article.publishedTime;

    if(article.author)openGraph.authors=[article.author];

    metadata.openGraph=openGraph;
    metadata.twitter={card:'summary_large_image',title:shown,description};

    return metadata;
  }

  const images=[{url:'/opengraph-image',...SHARE_IMAGE_SIZE,alt:SITE_NAME}];

  metadata.openGraph={title:shown,description,url:path,siteName:SITE_NAME,locale:'ko_KR',images,type:'website'};
  metadata.twitter={card:'summary_large_image',title:shown,description,images};

  return metadata;
}

/** Robots metadata for the whole site: only the production deployment is listed. */
export function siteRobots(env:SiteEnvironment=process.env):Metadata['robots']{
  return searchIndexable(env)?{index:true,follow:true}:{index:false,follow:false};
}

function validTime(value:string){const time=new Date(value).getTime();

  return Number.isNaN(time)?0:time;
}

function entry(url:string,time:number):MetadataRoute.Sitemap[number]{
  return time?{url,lastModified:new Date(time)}:{url};
}

export function sitemapEntries(pubs:Publication[],base:string):MetadataRoute.Sitemap{
  const newest=Math.max(0,...pubs.map(pub=>validTime(pub.publishedAt)));

  return [
    {url:`${base}/`},
    entry(`${base}/library`,newest),
    {url:`${base}/about`},
    ...pubs.flatMap(pub=>{
      const time=validTime(pub.publishedAt),reading=entry(`${base}/read/${pub.workId}`,time);

      return pub.wiki.length?[reading,entry(`${base}/wiki/${pub.workId}`,time)]:[reading];
    }),
  ];
}
