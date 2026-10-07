import { createClient } from '@supabase/supabase-js';

export async function writerClient(request:Request){
  const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];

  if(!token||!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)return null;
  const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${token}`}}});
  const auth=await client.auth.getUser(token);

if(auth.error||!auth.data.user)return null;
  const author=await client.from('authors').select('user_id').eq('user_id',auth.data.user.id).maybeSingle();

if(author.error||!author.data)return null;

  return{client,userId:auth.data.user.id};
}
