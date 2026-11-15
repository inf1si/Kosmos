import { createClient } from '@supabase/supabase-js';
import { readLimitedJson } from '@/lib/http';
import { automatedAgent, viewRequestSchema } from '@/lib/work-views';

export const dynamic='force-dynamic';

const done=()=>new Response(null,{status:204,headers:{'Cache-Control':'no-store'}});

function sameSite(request:Request){
  const origin=request.headers.get('origin');

  if(!origin)return request.headers.get('sec-fetch-site')==='same-origin';

  try{return new URL(origin).host===(request.headers.get('x-forwarded-host')||request.headers.get('host'));}catch{return false;}
}

/** Counts one opening of a published work. Always answers 204 so the reading page never waits on or reacts to it. */
export async function POST(request:Request){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;

  if(!url||!key||!sameSite(request)||automatedAgent(request.headers.get('user-agent')||''))return done();

  const body=viewRequestSchema.safeParse(await readLimitedJson(request,200).catch(()=>null));

  if(!body.success)return done();

  // The database counts only works with an active publication; an error leaves the count as it was.
  await createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}).rpc('record_work_view',{p_work_id:body.data.workId}).then(()=>{},()=>{});

  return done();
}
