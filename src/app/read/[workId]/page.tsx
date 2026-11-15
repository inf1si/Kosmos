import type { Metadata } from 'next';
import { SITE_DESCRIPTION, pageMetadata, workDescription } from '@/lib/site-metadata';
import { Reader } from '@/components/public-site';
import { getPublicAuthorName, getPublicData } from '@/lib/public-data';
import { manuscriptFontVariables } from '@/components/manuscript-fonts';

export const dynamic='force-dynamic';

export async function generateMetadata({params}:{params:Promise<{workId:string}>}):Promise<Metadata>{
  const {workId}=await params,[data,author]=await Promise.all([getPublicData().catch(()=>[]),getPublicAuthorName()]),pub=data.find(item=>item.workId===workId);

  // A work that is not published here has no page of its own to list.
  if(!pub)return {robots:{index:false,follow:false}};

  return pageMetadata({title:pub.title,description:workDescription(pub)||SITE_DESCRIPTION,path:`/read/${workId}`,article:{publishedTime:pub.publishedAt,author}});
}

export default async function ReaderPage({params}:{params:Promise<{workId:string}>}){const {workId}=await params;const [data,author]=await Promise.all([getPublicData().catch(()=>[]),getPublicAuthorName()]);const localPreview=!(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)&&(process.env.NODE_ENV==='development'||process.env.ALLOW_LOCAL_PREVIEW==='true');

return <Reader workId={workId} initial={data} localPreview={localPreview} fontClassName={manuscriptFontVariables} author={author}/>;}
