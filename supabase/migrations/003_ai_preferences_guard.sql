-- Keep old browser tabs from stripping the account's synced prompt library.
begin;
create or replace function public.guard_ai_preferences() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 if jsonb_typeof(old.payload->'aiPreferences')='object'
    and jsonb_typeof(new.payload->'aiPreferences') is distinct from 'object' then
   raise exception 'AI 프리셋을 보호하기 위해 저장을 멈췄습니다. 집필실을 새로고침한 뒤 다시 시도하세요.' using errcode='P0001';
 end if;
 return new;
end $$;
revoke all on function public.guard_ai_preferences() from public,anon,authenticated;
do $$ begin
 if not exists (select 1 from pg_trigger where tgname='preserve_ai_preferences' and tgrelid='public.workspaces'::regclass) then
   create trigger preserve_ai_preferences before update of payload on public.workspaces
   for each row execute function public.guard_ai_preferences();
 end if;
end $$;
commit;
