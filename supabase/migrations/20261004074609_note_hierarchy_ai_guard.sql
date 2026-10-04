-- Keep note hierarchy and per-note conversations when an older tab saves the workspace.
begin;
create or replace function public.guard_note_details() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare nav jsonb; item jsonb; messages jsonb;
begin
 if tg_op='UPDATE' then
   if jsonb_typeof(old.payload->'noteNavigation')='object'
      and jsonb_typeof(new.payload->'noteNavigation') is distinct from 'object' then
     raise exception '노트 정리 구조를 보호하기 위해 저장을 멈췄습니다. 집필실을 새로고침한 뒤 다시 시도하세요.' using errcode='P0001';
   end if;
   if exists (
     select 1 from jsonb_array_elements(coalesce(old.payload->'notes','[]')) previous
     join jsonb_array_elements(coalesce(new.payload->'notes','[]')) incoming on previous->>'id'=incoming->>'id'
     where jsonb_typeof(previous->'aiMessages')='array' and jsonb_typeof(incoming->'aiMessages') is distinct from 'array'
   ) then
     raise exception '노트 AI 대화를 보호하기 위해 저장을 멈췄습니다. 집필실을 새로고침한 뒤 다시 시도하세요.' using errcode='P0001';
   end if;
 end if;
 nav=new.payload->'noteNavigation';
 if nav is not null then
   if jsonb_typeof(nav) is distinct from 'object' or nav->>'version' is distinct from '1'
      or jsonb_typeof(nav->'nodes') is distinct from 'array' then raise exception '노트 정리 구조를 확인하세요.'; end if;
   if jsonb_array_length(nav->'nodes')>7500 then raise exception '노트와 폴더는 합계 7,500개까지입니다.'; end if;
   for item in select value from jsonb_array_elements(nav->'nodes') loop
     if jsonb_typeof(item->'id') is distinct from 'string' or item->>'type' is null or item->>'type' not in ('note','folder')
        or jsonb_typeof(item->'parentId') is null or jsonb_typeof(item->'parentId') not in ('null','string') then raise exception '노트 정리 항목을 확인하세요.'; end if;
     if item->>'type'='folder' and (jsonb_typeof(item->'title') is distinct from 'string' or length(btrim(item->>'title')) not between 1 and 300) then raise exception '폴더 이름을 확인하세요.'; end if;
     if item->>'type'='note' and not exists (select 1 from jsonb_array_elements(coalesce(new.payload->'notes','[]')) n where n->>'id'=item->>'id') then raise exception '정리 구조의 노트를 찾지 못했습니다.'; end if;
   end loop;
   if exists (select 1 from jsonb_array_elements(nav->'nodes') n group by n->>'id' having count(*)>1) then raise exception '노트 정리 ID가 중복됩니다.'; end if;
   if exists (select 1 from jsonb_array_elements(nav->'nodes') n where n->>'parentId' is not null and not exists (select 1 from jsonb_array_elements(nav->'nodes') p where p->>'id'=n->>'parentId')) then raise exception '상위 노트·폴더를 확인하세요.'; end if;
   if exists (
     with recursive nodes as materialized (select n->>'id' id,n->>'parentId' parent_id from jsonb_array_elements(nav->'nodes') n),
     walk as (
       select id,parent_id,array[id] path,1 depth,false cycle from nodes
       union all
       select n.id,n.parent_id,w.path||n.id,w.depth+1,n.id=any(w.path)
       from walk w join nodes n on n.id=w.parent_id where not w.cycle and w.depth<=24
     ) select 1 from walk where cycle or depth>24
   ) then raise exception '자신의 하위로 옮길 수 없으며 하위 깊이는 24단계까지입니다.'; end if;
 end if;
 for item in select value from jsonb_array_elements(coalesce(new.payload->'notes','[]')) loop
   if item ? 'aiMessages' then
     messages=item->'aiMessages';
     if jsonb_typeof(messages) is distinct from 'array' then raise exception '노트 대화 형식을 확인하세요.'; end if;
     if jsonb_array_length(messages)>40 or jsonb_array_length(messages)%2<>0 then raise exception '노트 대화는 질문·답변 20회까지입니다.'; end if;
     if exists (select 1 from jsonb_array_elements(messages) with ordinality m(value,i) where value->>'role' is distinct from case when i%2=1 then 'user' else 'assistant' end) then raise exception '노트 대화 순서를 확인하세요.'; end if;
   end if;
 end loop;
 if (select count(*) from jsonb_array_elements(coalesce(new.payload->'notes','[]')) n where jsonb_typeof(n->'aiMessages')='array' and jsonb_array_length(n->'aiMessages')>0)>200 then raise exception '노트 대화는 최대 200개까지입니다.'; end if;
 return new;
end $$;
revoke all on function public.guard_note_details() from public,anon,authenticated;
create trigger preserve_note_details before insert or update of payload on public.workspaces
for each row execute function public.guard_note_details();
commit;
