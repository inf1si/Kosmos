-- Older clients must not strip independent notes from the shared workspace JSON.
begin;
create or replace function public.guard_personal_notes() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare note jsonb; work_id jsonb;
begin
 if jsonb_typeof(old.payload->'notes')='array'
    and jsonb_typeof(new.payload->'notes') is distinct from 'array' then
   raise exception '개인 노트를 보호하기 위해 저장을 멈췄습니다. 집필실을 새로고침한 뒤 다시 시도하세요.' using errcode='P0001';
 end if;
 if new.payload ? 'notes' then
   if jsonb_typeof(new.payload->'notes') is distinct from 'array' then
     raise exception '노트 목록 형식을 확인하세요.';
   end if;
   if jsonb_array_length(new.payload->'notes')>5000 then raise exception '노트는 최대 5,000개입니다.'; end if;
   for note in select value from jsonb_array_elements(new.payload->'notes') loop
     if jsonb_typeof(note->'id') is distinct from 'string'
       or jsonb_typeof(note->'title') is distinct from 'string'
       or jsonb_typeof(note->'content') is distinct from 'object'
       or jsonb_typeof(note->'tags') is distinct from 'array'
       or jsonb_typeof(note->'assetIds') is distinct from 'array'
       or jsonb_typeof(note->'linkedWorkIds') is distinct from 'array'
       or note->>'box' is null or note->>'box' not in ('inbox','icebox') then
       raise exception '노트 구조를 확인하세요.';
     end if;
     if jsonb_array_length(note->'tags')>20 or jsonb_array_length(note->'assetIds')>200 or jsonb_array_length(note->'linkedWorkIds')>100 then
       raise exception '노트 태그·첨부·작품 연결 한도를 확인하세요.';
     end if;
     for work_id in select value from jsonb_array_elements(note->'linkedWorkIds') loop
       if not exists (select 1 from jsonb_array_elements(new.payload->'works') w where w->'id'=work_id) then
         raise exception '노트에 연결된 작품을 확인하세요.';
       end if;
     end loop;
   end loop;
 end if;
 return new;
end $$;
revoke all on function public.guard_personal_notes() from public,anon,authenticated;
create trigger preserve_personal_notes before update of payload on public.workspaces
for each row execute function public.guard_personal_notes();
commit;
