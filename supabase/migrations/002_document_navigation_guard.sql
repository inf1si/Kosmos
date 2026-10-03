-- Prevent a pre-hierarchy browser tab from stripping navigation when it saves a full workspace.
-- Does not change RLS, grants, authentication, existing payloads or recovery history.
begin;
create or replace function public.guard_document_navigation() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 if exists (
   select 1
   from jsonb_array_elements(old.payload->'works') as previous(work)
   join jsonb_array_elements(new.payload->'works') as incoming(work)
     on previous.work->>'id'=incoming.work->>'id'
   where jsonb_typeof(previous.work->'navigation')='object'
     and jsonb_typeof(incoming.work->'navigation') is distinct from 'object'
 ) then
   raise exception '문서 정리 구조를 보호하기 위해 저장을 멈췄습니다. 집필실을 새로고침한 뒤 다시 시도하세요.' using errcode='P0001';
 end if;
 return new;
end $$;
revoke all on function public.guard_document_navigation() from public,anon,authenticated;
do $$ begin
 if not exists (select 1 from pg_trigger where tgname='preserve_document_navigation' and tgrelid='public.workspaces'::regclass) then
   create trigger preserve_document_navigation before update of payload on public.workspaces
   for each row execute function public.guard_document_navigation();
 end if;
end $$;
commit;
