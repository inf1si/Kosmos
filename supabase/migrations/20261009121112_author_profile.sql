begin;
-- Only the explicitly published snapshot lives here; drafts remain in the owner's workspace.
create table public.author_profile (
 id boolean primary key default true check(id),
 owner_id uuid not null default auth.uid() references public.authors(user_id),
 name text not null default '' check(char_length(name)<=80),
 bio text not null check(char_length(btrim(bio)) between 1 and 10000),
 published_at timestamptz not null default now()
);
alter table public.author_profile enable row level security;
create policy profile_public_read on public.author_profile for select to anon,authenticated using(true);
create policy profile_author_insert on public.author_profile for insert to authenticated
 with check(owner_id=(select auth.uid()) and exists(select 1 from public.authors where user_id=(select auth.uid())));
create policy profile_author_update on public.author_profile for update to authenticated
 using(owner_id=(select auth.uid()) and exists(select 1 from public.authors where user_id=(select auth.uid())))
 with check(owner_id=(select auth.uid()) and exists(select 1 from public.authors where user_id=(select auth.uid())));
create policy profile_author_delete on public.author_profile for delete to authenticated
 using(owner_id=(select auth.uid()) and exists(select 1 from public.authors where user_id=(select auth.uid())));
revoke all on public.author_profile from public,anon,authenticated;
grant select(id,name,bio,published_at) on public.author_profile to anon,authenticated;
grant insert(id,name,bio,published_at),update(id,name,bio,published_at),delete on public.author_profile to authenticated;
commit;
