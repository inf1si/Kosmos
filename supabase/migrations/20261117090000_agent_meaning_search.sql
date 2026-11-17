begin;

-- Meaning search for the writing agent: one row per passage of a document, holding only its offsets and a unit-length embedding.
-- The passage text stays in the workspace; a row is replaced when the document's fingerprint changes. Only the server reads or writes.
create table public.agent_embeddings (
 owner_id uuid not null,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 document_id uuid not null,
 chunk_index integer not null check(chunk_index between 0 and 9999),
 hash text not null check(length(hash) between 1 and 64),
 model text not null check(length(model) between 1 and 200),
 start_offset integer not null check(start_offset>=0),
 length integer not null check(length between 1 and 20000),
 embedding real[] not null check(cardinality(embedding)=768),
 updated_at timestamptz not null default now(),
 primary key(owner_id,document_id,chunk_index)
);

-- Exact search: a writer's passages number in the thousands, so a scan of the requested documents is fast enough without an extension.
create function public.agent_match_passages(p_owner uuid,p_documents uuid[],p_model text,p_embedding real[],p_limit integer)
returns table(document_id uuid,chunk_index integer,start_offset integer,length integer,similarity double precision)
language sql stable security invoker set search_path='' as $$
 select e.document_id,e.chunk_index,e.start_offset,e.length,
  (select sum(a.x::double precision*a.y::double precision) from unnest(e.embedding,p_embedding) as a(x,y)) as similarity
 from public.agent_embeddings e
 where e.owner_id=p_owner and e.model=p_model and e.document_id=any(p_documents) and cardinality(p_embedding)=768
 order by similarity desc
 limit least(greatest(p_limit,1),50)
$$;

alter table public.agent_embeddings enable row level security;
revoke all on public.agent_embeddings from public,anon,authenticated;
grant all on public.agent_embeddings to service_role;
revoke all on function public.agent_match_passages(uuid,uuid[],text,real[],integer) from public,anon,authenticated;
grant execute on function public.agent_match_passages(uuid,uuid[],text,real[],integer) to service_role;
commit;
