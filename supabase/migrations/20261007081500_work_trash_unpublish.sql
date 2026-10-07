-- Whole works can move to the shared trash, and an author can withdraw a work's public edition.
-- Apply before deploying the app version that offers 작품 휴지통 이동·게시 철회. Existing payloads, RLS and grants on tables stay as they are.
begin;
create or replace function public.guard_workspace_trash() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare item jsonb; body jsonb; placement jsonb; messages jsonb; asset_id jsonb; active_ids text[];
begin
 if tg_op='UPDATE' and jsonb_typeof(old.payload->'trash')='array'
    and jsonb_typeof(new.payload->'trash') is distinct from 'array' then
   raise exception '휴지통을 보호하기 위해 저장을 멈췄습니다. 집필실을 새로고침한 뒤 다시 시도하세요.' using errcode='P0001';
 end if;
 if not new.payload ? 'trash' then return new; end if;
 if jsonb_typeof(new.payload->'trash') is distinct from 'array' then raise exception '휴지통 목록을 확인하세요.'; end if;
 if jsonb_array_length(new.payload->'trash')>5000 then raise exception '휴지통은 최대 5,000개입니다.'; end if;
 select array_agg(id) into active_ids from (
   select w->>'id' id from jsonb_array_elements(new.payload->'works') w
   union all select d->>'id' from jsonb_array_elements(new.payload->'works') w cross join lateral jsonb_array_elements(w->'documents') d
   union all select n->>'id' from jsonb_array_elements(new.payload->'works') w cross join lateral jsonb_array_elements(coalesce(w->'navigation'->'nodes','[]')) n
   union all select n->>'id' from jsonb_array_elements(coalesce(new.payload->'notes','[]')) n
   union all select n->>'id' from jsonb_array_elements(coalesce(new.payload->'noteNavigation'->'nodes','[]')) n
   union all select a->>'id' from jsonb_array_elements(new.payload->'assets') a
 ) live;
 if exists (select 1 from jsonb_array_elements(new.payload->'trash') t group by t->>'id' having count(*)>1) then raise exception '휴지통 ID가 중복됩니다.'; end if;
 for item in select value from jsonb_array_elements(new.payload->'trash') loop
   if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'id') is distinct from 'string'
      or item->>'type' is null or item->>'type' not in ('note','document','work')
      or jsonb_typeof(item->'deletedAt') is distinct from 'string' then raise exception '휴지통 항목을 확인하세요.'; end if;
   perform (item->>'id')::uuid; perform (item->>'deletedAt')::timestamptz;
   if item->>'id'=any(active_ids) then raise exception '휴지통 ID가 현재 문서와 중복됩니다.'; end if;
   if item->>'type'='work' then
     body=item->'work';
     if jsonb_typeof(body) is distinct from 'object' or body->>'id' is distinct from item->>'id'
        or jsonb_typeof(body->'title') is distinct from 'string' or length(body->>'title') not between 1 and 300
        or jsonb_typeof(body->'documents') is distinct from 'array' or jsonb_array_length(body->'documents') not between 1 and 5000
        or jsonb_typeof(item->'index') is distinct from 'number' or jsonb_typeof(item->'noteIds') is distinct from 'array'
        or jsonb_array_length(item->'noteIds')>5000 then raise exception '휴지통 작품을 확인하세요.'; end if;
     if exists (select 1 from jsonb_array_elements(body->'documents') d where jsonb_typeof(d) is distinct from 'object' or jsonb_typeof(d->'assetIds') is distinct from 'array') then raise exception '휴지통 작품의 문서를 확인하세요.'; end if;
     for asset_id in select a from jsonb_array_elements(body->'documents') d cross join lateral jsonb_array_elements(d->'assetIds') a loop
       if not exists (select 1 from jsonb_array_elements(new.payload->'assets') x where x->'id'=asset_id and x->>'workId'=item->>'id') then raise exception '휴지통 첨부 연결을 확인하세요.'; end if;
     end loop;
     continue;
   end if;
   body=case when item->>'type'='note' then item->'note' else item->'document' end;
   if jsonb_typeof(body) is distinct from 'object' or body->>'id' is distinct from item->>'id'
      or jsonb_typeof(body->'title') is distinct from 'string' or length(body->>'title')>300
      or jsonb_typeof(body->'content') is distinct from 'object' or body->'content'->>'type' is distinct from 'doc'
      or jsonb_typeof(body->'assetIds') is distinct from 'array' then raise exception '휴지통 본문을 확인하세요.'; end if;
   if jsonb_array_length(body->'assetIds')>200 then raise exception '휴지통 첨부 한도를 확인하세요.'; end if;
   if item->>'type'='note' then
     if jsonb_typeof(body->'tags') is distinct from 'array' or jsonb_typeof(body->'linkedWorkIds') is distinct from 'array'
        or body->>'box' is null or body->>'box' not in ('inbox','icebox') then raise exception '휴지통 노트를 확인하세요.'; end if;
     if jsonb_array_length(body->'tags')>20 or jsonb_array_length(body->'linkedWorkIds')>100 then raise exception '휴지통 노트 한도를 확인하세요.'; end if;
     messages=body->'aiMessages';
   else
     if jsonb_typeof(item->'workId') is distinct from 'string' or jsonb_typeof(item->'workTitle') is distinct from 'string'
        or length(item->>'workTitle') not between 1 and 300 or length(body->>'title')=0
        or body->>'kind' is null or body->>'kind' not in ('scene','wiki','memo') then raise exception '휴지통 문서를 확인하세요.'; end if;
     perform (item->>'workId')::uuid; messages=item->'aiMessages';
   end if;
   if messages is not null then
     if jsonb_typeof(messages) is distinct from 'array' then raise exception '휴지통 대화를 확인하세요.'; end if;
     if jsonb_array_length(messages)>40 or jsonb_array_length(messages)%2<>0 then raise exception '휴지통 대화 한도를 확인하세요.'; end if;
     if exists (select 1 from jsonb_array_elements(messages) with ordinality m(value,i) where value->>'role' is distinct from case when i%2=1 then 'user' else 'assistant' end) then raise exception '휴지통 대화 순서를 확인하세요.'; end if;
   end if;
   placement=item->'placement';
   if jsonb_typeof(placement) is distinct from 'object' or jsonb_typeof(placement->'parentId') is null
      or jsonb_typeof(placement->'parentId') not in ('null','string') or jsonb_typeof(placement->'childIds') is distinct from 'array' then raise exception '휴지통의 원래 위치를 확인하세요.'; end if;
   if placement->>'parentId' is not null then perform (placement->>'parentId')::uuid; end if;
   if placement ? 'beforeId' then
     if jsonb_typeof(placement->'beforeId') is distinct from 'string' then raise exception '휴지통 순서를 확인하세요.'; end if;
     perform (placement->>'beforeId')::uuid;
   end if;
   if jsonb_array_length(placement->'childIds')>7500 then raise exception '휴지통 하위 항목 한도를 확인하세요.'; end if;
   if exists (select 1 from jsonb_array_elements_text(placement->'childIds') c group by c having count(*)>1)
      or placement->>'parentId'=item->>'id' or placement->>'beforeId'=item->>'id'
      or exists (select 1 from jsonb_array_elements_text(placement->'childIds') c where c=item->>'id') then raise exception '휴지통 하위 항목을 확인하세요.'; end if;
   for asset_id in select value from jsonb_array_elements(placement->'childIds') loop
     if jsonb_typeof(asset_id) is distinct from 'string' then raise exception '휴지통 하위 항목 ID를 확인하세요.'; end if;
     perform (asset_id#>>'{}')::uuid;
   end loop;
   if item->>'type'='document' then
     if jsonb_typeof(placement->'section') is distinct from 'object'
        or jsonb_typeof(placement->'section'->'id') is distinct from 'string' or length(placement->'section'->>'id') not between 1 and 100
        or jsonb_typeof(placement->'section'->'title') is distinct from 'string' or length(placement->'section'->>'title') not between 1 and 200
        or placement->'section'->>'defaultKind' is null or placement->'section'->>'defaultKind' not in ('scene','wiki','memo') then raise exception '휴지통 대분류를 확인하세요.'; end if;
   end if;
   for asset_id in select value from jsonb_array_elements(body->'assetIds') loop
     if not exists (select 1 from jsonb_array_elements(new.payload->'assets') a where a->'id'=asset_id and
       case when item->>'type'='note' then a->>'noteId'=item->>'id' else a->>'workId'=item->>'workId' end) then raise exception '휴지통 첨부 연결을 확인하세요.'; end if;
   end loop;
 end loop;
 return new;
end $$;
revoke all on function public.guard_workspace_trash() from public,anon,authenticated;
-- The trigger from 20261004104045 already calls this function; replacing the body is enough.

-- Turn off the active edition so /library, /read and /wiki stop serving it. Edition rows stay for the author's history.
create or replace function public.unpublish_work(p_work_id uuid) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare withdrawn integer;
begin
 if auth.uid() is null or not exists(select 1 from public.authors where user_id=auth.uid()) then raise exception 'Author access required';end if;
 update public.publications set active=false where owner_id=auth.uid() and work_id=p_work_id and active;
 get diagnostics withdrawn=row_count;
 return withdrawn;
end $$;
revoke all on function public.unpublish_work(uuid) from public,anon;
grant execute on function public.unpublish_work(uuid) to authenticated;
commit;
