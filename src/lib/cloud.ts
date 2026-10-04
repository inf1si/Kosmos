import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Workspace, workspaceSchema, Publication, publicationSchema } from './model';
import { applyNavigation, resolveNavigation } from './document-navigation';
let client:SupabaseClient|null=null;
export const cloudConfigured=!!(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
export function cloud(){
  if(!cloudConfigured)throw new Error('클라우드가 연결되지 않았습니다.');
  return client??=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{flowType:'pkce'}});
}
export async function fetchCloud(){
  const {data,error}=await cloud().from('workspaces').select('id,payload,version').single();
  if(error&&error.code!=='PGRST116')throw error;
  return data?{id:data.id as string,data:workspaceSchema.parse(data.payload),version:Number(data.version)}:null;
}
export async function initializeCloud(data:Workspace){
  const {data:result,error}=await cloud().rpc('initialize_workspace',{p_payload:data});
  if(error)throw error;
  return {id:String(result.id),data:workspaceSchema.parse(result.payload),version:Number(result.version)};
}
export async function saveCloud(id:string,baseVersion:number,payload:Workspace,requestId:string){
  // Normalize old offline queues and restored backups before the server's preservation guard runs.
  const complete={...payload,notes:payload.notes||[],works:payload.works.map(w=>applyNavigation(w,resolveNavigation(w)))};
  const {data,error}=await cloud().rpc('save_workspace',{p_id:id,p_base_version:baseVersion,p_payload:complete,p_request_id:requestId});
  if(error)throw new Error(error.message);
  return data as {status:'saved'|'conflict';version:number;payload?:Workspace};
}
export async function publishCloud(id:string,workId:string,sceneIds:string[]):Promise<Publication>{
  const {data,error}=await cloud().rpc('publish_work',{p_id:id,p_work_id:workId,p_scene_ids:sceneIds});
  if(error)throw error;return publicationSchema.parse(data);
}
export async function publicPublications():Promise<Publication[]>{
  const {data,error}=await cloud().from('publications').select('payload').eq('active',true).order('published_at',{ascending:false});
  if(error)throw error;return (data||[]).map(row=>publicationSchema.parse(row.payload));
}
