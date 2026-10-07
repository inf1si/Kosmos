import { Library } from '@/components/public-site';
import { getPublicData } from '@/lib/public-data';

export const dynamic='force-dynamic';

export default async function LibraryPage(){let data:Awaited<ReturnType<typeof getPublicData>>=[];let error='';

try{data=await getPublicData();}catch{error='서재를 불러오지 못했습니다. 잠시 뒤 다시 열어주세요.';}

const localPreview=!(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)&&(process.env.NODE_ENV==='development'||process.env.ALLOW_LOCAL_PREVIEW==='true');

return <Library initial={data} localPreview={localPreview} error={error}/>;}
