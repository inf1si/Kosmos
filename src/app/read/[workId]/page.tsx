import { Reader } from '@/components/public-site';
import { getPublicData } from '@/lib/public-data';
export const dynamic='force-dynamic';
export default async function ReaderPage({params}:{params:Promise<{workId:string}>}){const {workId}=await params;const data=await getPublicData().catch(()=>[]);const localPreview=!(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)&&(process.env.NODE_ENV==='development'||process.env.ALLOW_LOCAL_PREVIEW==='true');return <Reader workId={workId} initial={data} localPreview={localPreview}/>;}
