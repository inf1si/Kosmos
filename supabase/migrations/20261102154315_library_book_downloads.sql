begin;

create table public.book_downloads (
 work_id uuid not null,
 format text not null check(format in ('pdf','epub','html')),
 owner_id uuid not null references public.authors(user_id) on delete cascade,
 file_id uuid not null unique,
 object_path text not null unique,
 filename text not null check(length(filename) between 1 and 200 and filename !~ '[<>:"/\\|?*[:cntrl:]]' and right(filename,length(format)+1)='.'||format),
 size bigint not null check(size between 1 and 52428800),
 updated_at timestamptz not null default now(),
 primary key(work_id,format),
 check(object_path=owner_id::text||'/'||file_id::text||'.'||format)
);

create index book_downloads_owner on public.book_downloads(owner_id);

alter table public.book_downloads enable row level security;
revoke all on public.book_downloads from anon,authenticated;
grant select on public.book_downloads to anon,authenticated;
grant insert,update,delete on public.book_downloads to authenticated;
-- Policies match the registered author as well as the work, including after a new edition is published.
grant select(owner_id) on public.publications to anon,authenticated;
create policy book_download_public_read on public.book_downloads for select to anon using (
 exists(select 1 from public.publications p where p.active and p.work_id=book_downloads.work_id and p.owner_id=book_downloads.owner_id)
);
create policy book_download_signed_in_read on public.book_downloads for select to authenticated using (
 (owner_id=(select auth.uid()) and exists(select 1 from public.authors a where a.user_id=(select auth.uid()))) or
 exists(select 1 from public.publications p where p.active and p.work_id=book_downloads.work_id and p.owner_id=book_downloads.owner_id)
);
create policy book_download_insert on public.book_downloads for insert to authenticated with check (
 owner_id=(select auth.uid()) and exists(select 1 from public.authors a where a.user_id=(select auth.uid())) and
 exists(select 1 from public.publications p where p.active and p.work_id=book_downloads.work_id and p.owner_id=(select auth.uid()))
);
create policy book_download_update on public.book_downloads for update to authenticated using (
 owner_id=(select auth.uid()) and exists(select 1 from public.authors a where a.user_id=(select auth.uid()))
) with check (
 owner_id=(select auth.uid()) and exists(select 1 from public.authors a where a.user_id=(select auth.uid())) and
 exists(select 1 from public.publications p where p.active and p.work_id=book_downloads.work_id and p.owner_id=(select auth.uid()))
);
create policy book_download_delete on public.book_downloads for delete to authenticated using (
 owner_id=(select auth.uid()) and exists(select 1 from public.authors a where a.user_id=(select auth.uid()))
);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('book-downloads','book-downloads',false,52428800,array['application/pdf','application/epub+zip','text/html']);

create policy book_file_signed_in_read on storage.objects for select to authenticated using (
 bucket_id='book-downloads' and (
 ((storage.foldername(name))[1]=(select auth.uid())::text and exists(select 1 from public.authors a where a.user_id=(select auth.uid()))) or
 exists(select 1 from public.book_downloads b join public.publications p on p.work_id=b.work_id and p.owner_id=b.owner_id and p.active where b.object_path=objects.name))
);
create policy book_file_public_read on storage.objects for select to anon using (
 bucket_id='book-downloads' and exists(
 select 1 from public.book_downloads b join public.publications p on p.work_id=b.work_id and p.owner_id=b.owner_id and p.active where b.object_path=objects.name)
);
create policy book_file_insert on storage.objects for insert to authenticated with check (
 bucket_id='book-downloads' and (storage.foldername(name))[1]=(select auth.uid())::text and
 exists(select 1 from public.authors a where a.user_id=(select auth.uid()))
);
-- Objects are immutable. A replacement gets a new path, then metadata switches only if its prior file_id still matches.
create policy book_file_delete on storage.objects for delete to authenticated using (
 bucket_id='book-downloads' and (storage.foldername(name))[1]=(select auth.uid())::text and
 exists(select 1 from public.authors a where a.user_id=(select auth.uid()))
);

commit;
