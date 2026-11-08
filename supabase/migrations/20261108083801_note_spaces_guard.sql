-- Preserve note-space metadata against older clients and validate section ownership.
-- Existing hierarchy/conversation/trash guards and workspace RLS remain in force.
begin;
create or replace function public.guard_note_spaces() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare spaces jsonb; space jsonb; section_item jsonb;
begin
 if tg_op='UPDATE' and jsonb_typeof(old.payload->'noteNavigation'->'spaces')='array'
    and jsonb_typeof(new.payload->'noteNavigation'->'spaces') is distinct from 'array' then
   raise exception '노트 작업공간이 변경되었습니다. 새로고침하세요.' using errcode='P0001';
 end if;
 spaces=new.payload->'noteNavigation'->'spaces';
 if spaces is null then return new; end if;
 if jsonb_typeof(spaces) is distinct from 'array' or jsonb_array_length(spaces) not between 1 and 100 then
   raise exception '노트 작업공간을 확인하세요.';
 end if;
 if not exists(select 1 from jsonb_array_elements(spaces) s where s->>'id'='default')
    or exists(select 1 from jsonb_array_elements(spaces) s group by s->>'id' having count(*)>1) then
   raise exception '기본 작업공간과 작업공간 ID를 확인하세요.';
 end if;
 for space in select value from jsonb_array_elements(spaces) loop
   if jsonb_typeof(space) is distinct from 'object' or jsonb_typeof(space->'id') is distinct from 'string'
      or length(space->>'id') not between 1 and 100 or jsonb_typeof(space->'title') is distinct from 'string'
      or length(space->>'title')>80 or jsonb_typeof(space->'sections') is distinct from 'array'
      or jsonb_array_length(space->'sections') not between 1 and 40 then raise exception '작업공간의 이름·섹션을 확인하세요.'; end if;
   for section_item in select value from jsonb_array_elements(space->'sections') loop
     if jsonb_typeof(section_item) is distinct from 'object' or jsonb_typeof(section_item->'id') is distinct from 'string'
        or length(section_item->>'id') not between 1 and 100 or jsonb_typeof(section_item->'title') is distinct from 'string'
        or length(btrim(section_item->>'title')) not between 1 and 200 then raise exception '노트 섹션을 확인하세요.'; end if;
   end loop;
 end loop;
 if exists(select 1 from jsonb_array_elements(spaces) s cross join lateral jsonb_array_elements(s->'sections') section group by section->>'id' having count(*)>1) then
   raise exception '노트 섹션 ID가 중복됩니다.';
 end if;
 if exists(
   with sections as materialized(select section->>'id' id from jsonb_array_elements(spaces) s cross join lateral jsonb_array_elements(s->'sections') section)
   select 1 from jsonb_array_elements(new.payload->'noteNavigation'->'nodes') n
   left join sections s on s.id=n->>'sectionId'
   where jsonb_typeof(n->'sectionId') is distinct from 'string' or s.id is null
 ) then raise exception '노트의 작업공간·섹션을 확인하세요.'; end if;
 if exists(
   with nodes as materialized(select n->>'id' id,n->>'sectionId' section_id,n->>'parentId' parent_id from jsonb_array_elements(new.payload->'noteNavigation'->'nodes') n)
   select 1 from nodes n join nodes p on p.id=n.parent_id where n.section_id is distinct from p.section_id
 ) then raise exception '상위 노트·폴더의 섹션을 확인하세요.'; end if;
 if exists(
   select 1 from jsonb_array_elements(coalesce(new.payload->'notes','[]')) note
   where not exists(select 1 from jsonb_array_elements(new.payload->'noteNavigation'->'nodes') n where n->>'type'='note' and n->>'id'=note->>'id')
 ) then raise exception '노트의 소속을 확인하세요.'; end if;
 return new;
end $$;
revoke all on function public.guard_note_spaces() from public,anon,authenticated;
drop trigger if exists guard_note_spaces on public.workspaces;
create trigger guard_note_spaces before insert or update of payload on public.workspaces
for each row execute function public.guard_note_spaces();
commit;
