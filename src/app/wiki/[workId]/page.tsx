import { Wiki } from '@/components/public-site';
import { getPublicData } from '@/lib/public-data';

export const dynamic='force-dynamic';

export default async function WikiPage({params,searchParams}:{params:Promise<{workId:string}>;searchParams:Promise<{doc?:string}>}){const {workId}=await params;const {doc}=await searchParams;const data=await getPublicData().catch(()=>[]);const localPreview=!(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)&&(process.env.NODE_ENV==='development'||process.env.ALLOW_LOCAL_PREVIEW==='true');

return <Wiki workId={workId} initial={data} localPreview={localPreview} initialDoc={doc}/>;}
