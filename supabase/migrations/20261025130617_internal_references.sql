begin;

-- Pure JSON transformation; only the existing privileged publisher calls it.
create or replace function public.strip_internal_references(p_node jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare children jsonb;
begin
 if jsonb_typeof(p_node) is distinct from 'object' then return p_node; end if;
 if p_node->>'type'='internalReference' then return null; end if;
 if jsonb_typeof(p_node->'content')='array' then
   select coalesce(jsonb_agg(clean order by n) filter(where clean is not null),'[]'::jsonb)
   into children from jsonb_array_elements(p_node->'content') with ordinality as item(child,n)
   cross join lateral (select public.strip_internal_references(child) as clean) stripped;
   return jsonb_set(p_node,'{content}',children);
 end if;
 return p_node;
end $$;
revoke all on function public.strip_internal_references(jsonb) from public,anon,authenticated;

create or replace function public.publish_work(p_id uuid,p_work_id uuid,p_scene_ids uuid[]) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.workspaces;w jsonb;pub jsonb;scene_data jsonb;wiki_data jsonb;edition_id uuid:=gen_random_uuid();
begin
 select * into r from public.workspaces where id=p_id and owner_id=auth.uid() for update;
 if not found then raise exception 'Author access required';end if;
 select value into w from jsonb_array_elements(r.payload->'works') where value->>'id'=p_work_id::text;
 if w is null then raise exception 'Work does not exist';end if;
 select jsonb_agg(jsonb_build_object('id',d->'id','title',d->'title','chapter',d->'chapter','content',public.strip_internal_references(d->'content')) order by n)
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

revoke all on function public.publish_work(uuid,uuid,uuid[]) from public,anon;
grant execute on function public.publish_work(uuid,uuid,uuid[]) to authenticated;

-- Reject private reference objects even if a future publishing path forgets the sanitizer.
alter table public.publications add constraint publications_no_internal_references
check(not jsonb_path_exists(payload,'$.** ? (@.type == "internalReference")'));
commit;
