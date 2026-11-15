import type { Metadata } from 'next';
import { pageMetadata, wikiDescription } from '@/lib/site-metadata';
import { Wiki } from '@/components/public-site';
import { getPublicAuthorName, getPublicData } from '@/lib/public-data';

export const dynamic='force-dynamic';

export async function generateMetadata({params}:{params:Promise<{workId:string}>}):Promise<Metadata>{
  const {workId}=await params,data=await getPublicData().catch(()=>[]),pub=data.find(item=>item.workId===workId);

  if(!pub)return {robots:{index:false,follow:false}};

  return pageMetadata({title:`${pub.title} 설정집`,description:wikiDescription(pub),path:`/wiki/${workId}`,index:pub.wiki.length>0});
}

export default async function WikiPage({params,searchParams}:{params:Promise<{workId:string}>;searchParams:Promise<{doc?:string}>}){const {workId}=await params;const {doc}=await searchParams;const [data,author]=await Promise.all([getPublicData().catch(()=>[]),getPublicAuthorName()]);const localPreview=!(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)&&(process.env.NODE_ENV==='development'||process.env.ALLOW_LOCAL_PREVIEW==='true');

return <Wiki workId={workId} initial={data} localPreview={localPreview} initialDoc={doc} author={author}/>;}
