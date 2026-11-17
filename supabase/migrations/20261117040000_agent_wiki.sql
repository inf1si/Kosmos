begin;

-- LLM wiki pages the writing agent keeps per work ('work:<id>') and one common page set over the notes ('common').
-- Pages are private to their author; only the server (service role) writes them, the author reads their own.
create table public.agent_wiki_pages (
 id uuid primary key, owner_id uuid not null,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 scope_key text not null check(scope_key='common' or scope_key ~ '^work:[0-9a-f-]{36}$'),
 title text not null check(length(title) between 1 and 300),
 category text not null check(category in ('character','place','rule','event','thread','open','concept','source','other')),
 content text not null check(length(content) between 1 and 40000),
 sources jsonb not null default '[]',
 run_id uuid,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index agent_wiki_pages_scope on public.agent_wiki_pages(owner_id,scope_key,updated_at desc);

-- What the writer said a source is (settled setting, idea, draft) for one wiki scope: { "<document id>": "canon" | "idea" | "draft" }.
create table public.agent_wiki_scopes (
 owner_id uuid not null, scope_key text not null check(scope_key='common' or scope_key ~ '^work:[0-9a-f-]{36}$'),
 source_roles jsonb not null default '{}' check(jsonb_typeof(source_roles)='object'),
 updated_at timestamptz not null default now(),
 primary key(owner_id,scope_key)
);

alter table public.agent_wiki_pages enable row level security;
alter table public.agent_wiki_scopes enable row level security;
create policy agent_wiki_pages_read on public.agent_wiki_pages for select to authenticated using(owner_id=(select auth.uid()) and exists(select 1 from public.authors where user_id=(select auth.uid())));
create policy agent_wiki_scopes_read on public.agent_wiki_scopes for select to authenticated using(owner_id=(select auth.uid()) and exists(select 1 from public.authors where user_id=(select auth.uid())));
revoke all on public.agent_wiki_pages,public.agent_wiki_scopes from public,anon,authenticated;
grant select on public.agent_wiki_pages,public.agent_wiki_scopes to authenticated;
grant all on public.agent_wiki_pages,public.agent_wiki_scopes to service_role;
commit;
