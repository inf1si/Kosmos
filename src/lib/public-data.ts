import { createClient } from '@supabase/supabase-js';
import { publicationSchema } from './model';
export async function getPublicData(){
  if(!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)return [];
  const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,cache:'no-store'})}});
  const {data,error}=await client.from('publications').select('payload').eq('active',true).order('published_at',{ascending:false});
  if(error)throw new Error('공개 작품을 불러오지 못했습니다.');return(data||[]).map(row=>publicationSchema.parse(row.payload));
}
