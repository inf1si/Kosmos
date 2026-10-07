-- Public ordering metadata only. Manuscripts, edition payloads and timestamps stay unchanged.
begin;
alter table public.publications add column library_position bigint;
with works as (
 select owner_id,work_id,bool_or(active) as active,max(published_at) as published_at
 from public.publications group by owner_id,work_id
), positions as (
 select owner_id,work_id,row_number() over(partition by owner_id order by active desc,published_at desc,work_id) as position from works
)
update public.publications p set library_position=s.position from positions s where p.owner_id=s.owner_id and p.work_id=s.work_id;
alter table public.publications alter column library_position set not null;
alter table public.publications add constraint library_position_valid check(library_position between 1 and 9007199254740991);
create index publications_owner_work on public.publications(owner_id,work_id);
grant select(library_position) on public.publications to anon,authenticated;

create function public.assign_library_position() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.workspaces where owner_id=new.owner_id for update;
 select coalesce(max(library_position) filter(where work_id=new.work_id),max(library_position)+1,1)
 into new.library_position from public.publications where owner_id=new.owner_id;
 return new;
end $$;
revoke all on function public.assign_library_position() from public,anon,authenticated;
create trigger assign_library_position before insert on public.publications for each row execute function public.assign_library_position();

create function public.get_author_library() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.authors where user_id=auth.uid()) then raise exception 'Author access required';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'workId',work_id,'title',payload->'title','publishedAt',payload->'publishedAt','libraryPosition',library_position) order by library_position,published_at desc,work_id),'[]'::jsonb)
 from public.publications where owner_id=auth.uid() and active);
end $$;
revoke all on function public.get_author_library() from public,anon;
grant execute on function public.get_author_library() to authenticated;

create function public.set_library_order(p_publication_ids uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare current_ids uuid[];
begin
 if auth.uid() is null or not exists(select 1 from public.authors where user_id=auth.uid()) then raise exception 'Author access required';end if;
 perform 1 from public.workspaces where owner_id=auth.uid() for update;
 if not found then raise exception 'Author access required';end if;
 perform 1 from public.publications where owner_id=auth.uid() and active for update;
 select coalesce(array_agg(id),'{}'::uuid[]) into current_ids from public.publications where owner_id=auth.uid() and active;
 if p_publication_ids is null or cardinality(p_publication_ids)>100
 or cardinality(p_publication_ids)<>cardinality(current_ids)
 or (select count(distinct id) from unnest(p_publication_ids) id)<>cardinality(p_publication_ids)
 or not (p_publication_ids @> current_ids and p_publication_ids <@ current_ids) then
 raise exception '게시된 작품이 바뀌었습니다. 순서 편집을 다시 열어주세요.';
 end if;
 -- Reuse the active works' slots; withdrawn works keep their reserved positions.
 with slots as (
 select library_position,row_number() over(order by library_position,work_id) as ordinal from public.publications where owner_id=auth.uid() and active
 ), requested as (
 select p.work_id,s.library_position from unnest(p_publication_ids) with ordinality as ids(id,n)
 join public.publications p on p.id=ids.id and p.owner_id=auth.uid() and p.active
 join slots s on s.ordinal=ids.n
 ) update public.publications p set library_position=r.library_position from requested r where p.owner_id=auth.uid() and p.work_id=r.work_id;
 return public.get_author_library();
end $$;
revoke all on function public.set_library_order(uuid[]) from public,anon;
grant execute on function public.set_library_order(uuid[]) to authenticated;
commit;
