-- Apply once in a new Supabase project. No service-role key is needed in the app.
begin;
create table public.authors (user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.authors enable row level security;
create policy author_self on public.authors for select to authenticated using (user_id=auth.uid());
revoke all on public.authors from anon,authenticated;
grant select on public.authors to authenticated;
revoke all on public.authors from anon;
create table public.workspaces (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null unique references public.authors(user_id),
 version bigint not null default 0,payload jsonb not null,updated_at timestamptz not null default now(),
 check(coalesce(jsonb_typeof(payload)='object' and payload->>'formatVersion'='1',false))
);
alter table public.workspaces enable row level security;
create policy workspace_owner_read on public.workspaces for select to authenticated using(owner_id=auth.uid());
revoke all on public.workspaces from anon,authenticated;
grant select on public.workspaces to authenticated;
revoke all on public.workspaces from anon;
create table public.workspace_requests (
 workspace_id uuid references public.workspaces(id) on delete cascade,request_id uuid not null,
 payload_hash text not null,version bigint not null,created_at timestamptz not null default now(),primary key(workspace_id,request_id)
);
alter table public.workspace_requests enable row level security;
revoke all on public.workspace_requests from anon,authenticated;
create table public.workspace_revisions (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
 owner_id uuid not null references public.authors(user_id),payload jsonb not null,created_at timestamptz not null default now()
);
alter table public.workspace_revisions enable row level security;
create policy revision_owner_read on public.workspace_revisions for select to authenticated using(owner_id=auth.uid());
revoke all on public.workspace_revisions from anon,authenticated;
grant select on public.workspace_revisions to authenticated;
revoke all on public.workspace_revisions from anon;
create table public.publications (
 id uuid primary key,owner_id uuid not null references public.authors(user_id),work_id uuid not null,
 active boolean not null default true,payload jsonb not null,published_at timestamptz not null default now()
);
create unique index one_active_publication on public.publications(owner_id,work_id) where active;
alter table public.publications enable row level security;
create policy public_active_editions on public.publications for select to anon,authenticated using(active);
revoke all on public.publications from anon,authenticated;
grant select(id,work_id,active,payload,published_at) on public.publications to anon,authenticated;
create function public.initialize_workspace(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.workspaces;
begin
 if auth.uid() is null or not exists(select 1 from public.authors where user_id=auth.uid()) then raise exception 'Author access required';end if;
 if p_payload is null or p_payload->>'formatVersion' is distinct from '1' or jsonb_typeof(p_payload->'works') is distinct from 'array' or octet_length(p_payload::text)>20000000 then raise exception 'Invalid workspace';end if;
 insert into public.workspaces(owner_id,payload) values(auth.uid(),p_payload) on conflict(owner_id) do nothing;
 select * into r from public.workspaces where owner_id=auth.uid();
 return jsonb_build_object('id',r.id,'version',r.version,'payload',r.payload);
end $$;
create function public.save_workspace(p_id uuid,p_base_version bigint,p_payload jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.workspaces;prior public.workspace_requests;next_version bigint;
begin
 select * into r from public.workspaces where id=p_id and owner_id=auth.uid() for update;
 if not found then raise exception 'Author access required';end if;
 if p_payload is null or p_payload->>'formatVersion' is distinct from '1' or jsonb_typeof(p_payload->'works') is distinct from 'array' or octet_length(p_payload::text)>20000000 then raise exception 'Invalid workspace';end if;
 select * into prior from public.workspace_requests where workspace_id=p_id and request_id=p_request_id;
 if found then
  if prior.payload_hash<>md5(p_payload::text) then raise exception 'Request ID reused with different content';end if;
  if prior.version<>r.version then return jsonb_build_object('status','conflict','version',r.version,'payload',r.payload);end if;
  return jsonb_build_object('status','saved','version',prior.version);
 end if;
 if r.version<>p_base_version then return jsonb_build_object('status','conflict','version',r.version,'payload',r.payload);end if;
 if not exists(select 1 from public.workspace_revisions where workspace_id=p_id and created_at>now()-interval '10 minutes') then
  insert into public.workspace_revisions(workspace_id,owner_id,payload) values(p_id,auth.uid(),r.payload);
  delete from public.workspace_revisions where workspace_id=p_id and id not in(select id from public.workspace_revisions where workspace_id=p_id order by created_at desc limit 50);
 end if;
 next_version=r.version+1;
 update public.workspaces set payload=p_payload,version=next_version,updated_at=now() where id=p_id;
 insert into public.workspace_requests(workspace_id,request_id,payload_hash,version) values(p_id,p_request_id,md5(p_payload::text),next_version);
 delete from public.workspace_requests where workspace_id=p_id and created_at<now()-interval '7 days';
 return jsonb_build_object('status','saved','version',next_version);
end $$;
create function public.publish_work(p_id uuid,p_work_id uuid,p_scene_ids uuid[]) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.workspaces;w jsonb;pub jsonb;scene_data jsonb;wiki_data jsonb;edition_id uuid:=gen_random_uuid();
begin
 select * into r from public.workspaces where id=p_id and owner_id=auth.uid() for update;
 if not found then raise exception 'Author access required';end if;
 select value into w from jsonb_array_elements(r.payload->'works') where value->>'id'=p_work_id::text;
 if w is null then raise exception 'Work does not exist';end if;
 select jsonb_agg(jsonb_build_object('id',d->'id','title',d->'title','chapter',d->'chapter','content',d->'content') order by n)
 into scene_data from jsonb_array_elements(w->'documents') with ordinality as item(d,n)
 where d->>'kind'='scene' and (d->>'id')::uuid=any(p_scene_ids);
 if scene_data is null then raise exception 'Select at least one scene';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',d->'id','title',d->'title','category',d->'category','summary',d->'publicSummary')),'[]'::jsonb)
 into wiki_data from jsonb_array_elements(w->'documents') as item(d)
 where d->>'kind'='wiki' and d->>'isPublic'='true' and length(trim(d->>'publicSummary'))>0;
 pub:=jsonb_build_object('id',edition_id,'workId',p_work_id,'title',w->'title','subtitle',w->'subtitle','description',w->'description',
  'publishedAt',now(),'scenes',scene_data,'wiki',wiki_data);
 update public.publications set active=false where owner_id=auth.uid() and work_id=p_work_id and active;
 insert into public.publications(id,owner_id,work_id,payload) values(edition_id,auth.uid(),p_work_id,pub);
 return pub;
end $$;
revoke all on function public.initialize_workspace(jsonb) from public,anon;
revoke all on function public.save_workspace(uuid,bigint,jsonb,uuid) from public,anon;
revoke all on function public.publish_work(uuid,uuid,uuid[]) from public,anon;
grant execute on function public.initialize_workspace(jsonb) to authenticated;
grant execute on function public.save_workspace(uuid,bigint,jsonb,uuid) to authenticated;
grant execute on function public.publish_work(uuid,uuid,uuid[]) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('private-assets','private-assets',false,10485760,array['image/png','image/jpeg','image/webp']);
create policy private_asset_read on storage.objects for select to authenticated using
 (bucket_id='private-assets' and (storage.foldername(name))[1]=auth.uid()::text and exists(select 1 from public.authors where user_id=auth.uid()));
create policy private_asset_insert on storage.objects for insert to authenticated with check
 (bucket_id='private-assets' and (storage.foldername(name))[1]=auth.uid()::text and exists(select 1 from public.authors where user_id=auth.uid()));
-- Keep attachments immutable so previous backup/recovery references remain valid.
create table public.ai_usage(owner_id uuid references public.authors(user_id),day date,calls integer not null,primary key(owner_id,day));
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon,authenticated;
create function public.reserve_ai_call() returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare count integer;
begin
 if auth.uid() is null or not exists(select 1 from public.authors where user_id=auth.uid()) then raise exception 'Author access required';end if;
 insert into public.ai_usage(owner_id,day,calls) values(auth.uid(),current_date,1)
 on conflict(owner_id,day) do update set calls=public.ai_usage.calls+1 where public.ai_usage.calls<10 returning calls into count;
 if count is null then raise exception 'Daily AI limit reached';end if;
 return count;
end $$;
revoke all on function public.reserve_ai_call() from public,anon;
grant execute on function public.reserve_ai_call() to authenticated;
alter publication supabase_realtime add table public.workspaces;
commit;
