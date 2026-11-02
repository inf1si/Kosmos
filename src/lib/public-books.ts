import {createClient} from '@supabase/supabase-js';

/** Public downloads always use the anonymous role, including when the visitor is the author. */
export function publicBooksClient(){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if(!url||!key)return null;

  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input,init)=>fetch(input,{...init,cache:'no-store'})}});
}
