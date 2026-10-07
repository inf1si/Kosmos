-- New clients send explicit empty lists when removing fields or templates.
-- Reject older clients that silently omit the new fields, without changing manuscripts or RLS.
create or replace function public.guard_workspace_templates()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare old_items jsonb; new_items jsonb;
begin
  if new.payload ? 'templates' and
     (jsonb_typeof(new.payload->'templates') is distinct from 'array' or jsonb_array_length(new.payload->'templates') > 100) then
    raise exception '템플릿 목록을 확인하세요.';
  end if;
  if tg_op = 'UPDATE' then
    if old.payload ? 'templates' and not (new.payload ? 'templates') then
      raise exception '템플릿을 보존하려면 집필실을 새로고침하세요.';
    end if;
    old_items := jsonb_path_query_array(old.payload, '$.works[*].documents[*]')
      || jsonb_path_query_array(old.payload, '$.notes[*]')
      || jsonb_path_query_array(old.payload, '$.trash[*].document')
      || jsonb_path_query_array(old.payload, '$.trash[*].note')
      || jsonb_path_query_array(old.payload, '$.trash[*].work.documents[*]');
    if exists (select 1 from jsonb_array_elements(old_items) as d where d ? 'customProperties') then
      new_items := jsonb_path_query_array(new.payload, '$.works[*].documents[*]')
        || jsonb_path_query_array(new.payload, '$.notes[*]')
        || jsonb_path_query_array(new.payload, '$.trash[*].document')
        || jsonb_path_query_array(new.payload, '$.trash[*].note')
        || jsonb_path_query_array(new.payload, '$.trash[*].work.documents[*]');
      if exists (
        select 1 from jsonb_array_elements(old_items) as old_doc
        join jsonb_array_elements(new_items) as new_doc on old_doc->>'id' = new_doc->>'id'
        where old_doc ? 'customProperties'
          and jsonb_typeof(new_doc->'customProperties') is distinct from 'array'
      ) then
        raise exception '추가한 속성을 보존하려면 집필실을 새로고침하세요.';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_workspace_templates() from public, anon, authenticated;
drop trigger if exists workspace_templates_guard on public.workspaces;
create trigger workspace_templates_guard before insert or update of payload on public.workspaces
for each row execute function public.guard_workspace_templates();
