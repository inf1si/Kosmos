begin;

-- Daily reading-page view counts for published works. The public cannot read or write them:
-- the server records a view with the service role and each author reads only their own totals.
create table public.work_views (
 work_id uuid not null,
 day date not null,
 owner_id uuid not null references public.authors(user_id) on delete cascade,
 views integer not null default 0 check(views>=0),
 primary key(work_id,day)
);

create index work_views_owner on public.work_views(owner_id);

alter table public.work_views enable row level security;
revoke all on public.work_views from anon,authenticated;
grant select on public.work_views to authenticated;
create policy work_views_owner_read on public.work_views for select to authenticated using(owner_id=(select auth.uid()));

-- Days follow Korean time so a day's count matches the author's calendar.
create function public.record_work_view(p_work_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare
 author uuid;
begin
 select owner_id into author from public.publications where work_id=p_work_id and active limit 1;
 if author is null then return;end if;
 insert into public.work_views(work_id,day,owner_id,views) values(p_work_id,(now() at time zone 'Asia/Seoul')::date,author,1)
 on conflict(work_id,day) do update set views=public.work_views.views+1;
end $$;
revoke all on function public.record_work_view(uuid) from public,anon,authenticated;
grant execute on function public.record_work_view(uuid) to service_role;

create function public.work_view_totals() returns table(work_id uuid,total bigint,recent bigint)
language sql stable security invoker set search_path='' as $$
 select v.work_id,sum(v.views)::bigint,coalesce(sum(v.views) filter(where v.day>(now() at time zone 'Asia/Seoul')::date-7),0)::bigint
 from public.work_views v where v.owner_id=(select auth.uid()) group by v.work_id
$$;
revoke all on function public.work_view_totals() from public,anon;
grant execute on function public.work_view_totals() to authenticated;

commit;
