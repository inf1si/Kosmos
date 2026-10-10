import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { Workspace, workspaceSchema, Publication, publicationSchema } from './model';
import { libraryItemSchema, type LibraryItem } from './library-order';
import { applyNavigation, resolveNavigation } from './document-navigation';
import { publishedProfileSchema, type AuthorProfile } from './author-profile';

let client:SupabaseClient|null=null;

export const cloudConfigured=!!(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

export function cloud(){
  if(!cloudConfigured)throw new Error('클라우드가 연결되지 않았습니다.');

  return client??=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{flowType:'pkce'}});
}

export async function publicAuthorProfile(){
  const {data,error}=await cloud().from('author_profile').select('name,bio,published_at').eq('id',true).maybeSingle();

  if(error)throw new Error('자기소개를 불러오지 못했습니다.');

  return data?publishedProfileSchema.parse(data):null;
}

export async function publishAuthorProfile(profile:AuthorProfile){
  const parsed=publishedProfileSchema.parse({...profile,published_at:new Date().toISOString()});
  const {data,error}=await cloud().from('author_profile').upsert({id:true,...parsed}).select('name,bio,published_at').single();

  if(error)throw new Error('자기소개를 공개하지 못했습니다. 다시 시도하세요.');

  return publishedProfileSchema.parse(data);
}

export async function unpublishAuthorProfile(){
  const {error}=await cloud().from('author_profile').delete().eq('id',true);

  if(error||await publicAuthorProfile())throw new Error('자기소개 공개를 취소하지 못했습니다. 다시 시도하세요.');
}

export async function fetchCloud(){
  const {data,error}=await cloud().from('workspaces').select('id,payload,version').single();

  if(error&&error.code!=='PGRST116')throw error;

  return data?{id:z.string().parse(data.id),data:workspaceSchema.parse(data.payload),version:Number(data.version)}:null;
}

export type ServerRevision={id:string;createdAt:string};

// save_workspace keeps the previous payload about every 10 minutes (latest 50); RLS limits reads to the owner.
export async function cloudRevisions(workspaceId:string):Promise<ServerRevision[]>{
  const {data,error}=await cloud().from('workspace_revisions').select('id,created_at').eq('workspace_id',workspaceId).order('created_at',{ascending:false}).limit(50);

  if(error)throw new Error('서버 이력을 불러오지 못했습니다.');

  return z.array(z.object({id:z.string(),created_at:z.string()})).parse(data||[]).map(r=>({id:r.id,createdAt:r.created_at}));
}

export async function cloudRevision(workspaceId:string,id:string){
  const {data,error}=await cloud().from('workspace_revisions').select('payload').eq('workspace_id',workspaceId).eq('id',id).single();

  if(error||!data)throw new Error('서버 이력을 불러오지 못했습니다.');

  return workspaceSchema.parse(data.payload);
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

  if(error)throw new CloudSaveError(error.message,error.code);

  return z.object({status:z.enum(['saved','conflict']),version:z.number(),payload:workspaceSchema.optional()}).parse(data);
}

export class CloudSaveError extends Error {
  constructor(message:string,public code:string){super(message);}
}

export async function publishCloud(id:string,workId:string,sceneIds:string[]):Promise<Publication>{
  const {data,error}=await cloud().rpc('publish_work',{p_id:id,p_work_id:workId,p_scene_ids:sceneIds});

  if(error)throw error;

return publicationSchema.parse(data);
}

/** Turns off the work's active public edition. A server without the 2026-10-07 migration has no such function. */
export async function unpublishCloud(workId:string):Promise<void>{
  const {error}=await cloud().rpc('unpublish_work',{p_work_id:workId});

  if(error?.code==='PGRST202')throw new Error('서버에 게시 철회 기능이 아직 설치되지 않았습니다. 데이터베이스 업데이트 후 다시 시도하세요.');

  if(error)throw error;
}

export async function publicPublications():Promise<Publication[]>{
  const {data,error}=await cloud().from('publications').select('payload,library_position').eq('active',true).order('library_position').order('published_at',{ascending:false});

  if(error)throw error;

return (data||[]).map(row=>publicationSchema.parse({...row.payload,libraryPosition:row.library_position}));
}

export async function authorLibrary():Promise<LibraryItem[]>{
  const {data,error}=await cloud().rpc('get_author_library');

  if(error)throw new Error(error.message);

  return z.array(libraryItemSchema).parse(data);
}

export async function reorderLibrary(ids:string[]):Promise<LibraryItem[]>{
  const {data,error}=await cloud().rpc('set_library_order',{p_publication_ids:ids});

  if(error?.code==='PGRST202')throw new Error('서버에 서재 순서 기능이 아직 설치되지 않았습니다.');

  if(error)throw new Error(error.message);

  return z.array(libraryItemSchema).parse(data);
}
