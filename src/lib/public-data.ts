import { createClient } from '@supabase/supabase-js';
import { publicationSchema } from './model';
import { publishedProfileSchema } from './author-profile';

export async function getPublicData(){
  if(!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)return [];
  const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,cache:'no-store'})}});
  const {data,error}=await client.from('publications').select('payload,library_position').eq('active',true).order('library_position').order('published_at',{ascending:false});

  if(error)throw new Error('공개 작품을 불러오지 못했습니다.');

return(data||[]).map(row=>publicationSchema.parse({...row.payload,libraryPosition:row.library_position}));
}

export async function getPublicAuthorProfile(){
  if(!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)return null;
  const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,cache:'no-store'})}});
  const {data,error}=await client.from('author_profile').select('name,bio,published_at').eq('id',true).maybeSingle();

  if(error)throw new Error('자기소개를 불러오지 못했습니다.');

  return data?publishedProfileSchema.parse(data):null;
}
