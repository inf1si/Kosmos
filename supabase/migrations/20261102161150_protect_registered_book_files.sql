begin;
-- A registration may commit before its HTTP response is lost. Cleanup must never delete that now-public file.
alter policy book_file_delete on storage.objects using (
 bucket_id='book-downloads' and (storage.foldername(name))[1]=(select auth.uid())::text and
 exists(select 1 from public.authors a where a.user_id=(select auth.uid())) and
 not exists(select 1 from public.book_downloads b where b.object_path=objects.name)
);
commit;
