-- Owners remain recorded when writer access is revoked; authors is an allowlist, not an identity table.
begin;
create table public.agent_sessions (
 id uuid primary key, owner_id uuid not null,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 title text not null check(length(title) between 1 and 300), scope jsonb not null,
 mode text not null check(mode in ('discuss','review','execute')),
 provider text not null check(provider in ('openai','anthropic','gemini')), web boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.agent_runs (
 id uuid primary key, session_id uuid not null references public.agent_sessions(id) on delete cascade,
 owner_id uuid not null, workspace_id uuid not null references public.workspaces(id) on delete cascade,
 message text not null, provider text not null, model text not null, mode text not null, web boolean not null,
 status text not null default 'queued' check(status in ('queued','running','completed','failed','cancelled')),
 workflow_id text, snapshot jsonb not null, base_hash text not null,
 operations jsonb not null default '[]', events jsonb not null default '[]', answer text not null default '', error text not null default '', usage jsonb,
 applied_version bigint, applied_hash text, reverted boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index agent_one_running_per_owner on public.agent_runs(owner_id) where status='running';
create index agent_runs_session on public.agent_runs(session_id,created_at);
create index agent_sessions_owner on public.agent_sessions(owner_id,updated_at desc);
create table public.agent_memories (
 id uuid primary key, session_id uuid not null references public.agent_sessions(id) on delete cascade,
 owner_id uuid not null, title text not null check(length(title)<=300),
 content text not null, sources jsonb not null default '[]', updated_at timestamptz not null default now()
);
create index agent_memories_session on public.agent_memories(session_id);
alter table public.agent_sessions enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_memories enable row level security;
create policy agent_sessions_read on public.agent_sessions for select to authenticated using(owner_id=(select auth.uid()) and exists(select 1 from public.authors where user_id=(select auth.uid())));
create policy agent_runs_read on public.agent_runs for select to authenticated using(owner_id=(select auth.uid()) and exists(select 1 from public.authors where user_id=(select auth.uid())));
create policy agent_memories_read on public.agent_memories for select to authenticated using(owner_id=(select auth.uid()) and exists(select 1 from public.authors where user_id=(select auth.uid())));
revoke all on public.agent_sessions,public.agent_runs,public.agent_memories from public,anon,authenticated;
grant select on public.agent_sessions,public.agent_runs,public.agent_memories to authenticated;
grant all on public.agent_sessions,public.agent_runs,public.agent_memories to service_role;

-- Server-only invoker functions. Browser roles cannot submit forged agent state or a workspace payload.
create function public.agent_claim_run(p_id uuid,p_workflow text) returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare r public.agent_runs;
begin
 perform 1 from public.authors where user_id=(select owner_id from public.agent_runs where id=p_id) for update;
 select * into r from public.agent_runs where id=p_id for update;
 if not found or r.status not in ('queued','running') or not exists(select 1 from public.authors where user_id=r.owner_id) then return false; end if;
 if r.workflow_id is not null and r.workflow_id<>p_workflow then return false; end if;
 if exists(select 1 from public.agent_runs where owner_id=r.owner_id and id<>p_id and status='running') then return false; end if;
 update public.agent_runs set status='running',workflow_id=p_workflow,updated_at=now() where id=p_id;
 return true;
end $$;

create function public.agent_record_step(p_id uuid,p_workflow text,p_event jsonb,p_operation jsonb default null) returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare r public.agent_runs;
begin
 select * into r from public.agent_runs where id=p_id for update;
 if not found or r.status<>'running' or r.workflow_id<>p_workflow or not exists(select 1 from public.authors where user_id=r.owner_id) then raise exception 'Agent stopped'; end if;
 if exists(select 1 from jsonb_array_elements(r.events) e where e->>'id'=p_event->>'id') then return; end if;
 if jsonb_typeof(p_event) is distinct from 'object' or nullif(p_event->>'id','') is null then raise exception 'Invalid event'; end if;
 update public.agent_runs set events=events||jsonb_build_array(p_event),operations=case when p_operation is null then operations else operations||jsonb_build_array(p_operation) end,updated_at=now() where id=p_id;
end $$;

create function public.agent_commit_workspace(p_id uuid,p_base_version bigint,p_payload jsonb,p_after_hash text,p_revert boolean default false) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare r public.agent_runs; w public.workspaces; next_version bigint;
begin
 select * into r from public.agent_runs where id=p_id for update;
 if not found or not exists(select 1 from public.authors where user_id=r.owner_id) then raise exception 'Author access required'; end if;
 if (not p_revert and r.status not in ('running','completed')) or r.mode='discuss' then raise exception 'Agent cannot write'; end if;
 if r.reverted then raise exception 'Agent change discarded or reverted'; end if;
 if not p_revert and r.applied_version is not null then return jsonb_build_object('status','saved','version',r.applied_version); end if;
 if p_revert and (r.applied_version is null or r.reverted) then raise exception 'No change to revert'; end if;
 select * into w from public.workspaces where id=r.workspace_id and owner_id=r.owner_id for update;
 if not found then raise exception 'Author access required'; end if;
 if w.version<>p_base_version then return jsonb_build_object('status','conflict'); end if;
 if p_payload is null or p_payload->>'formatVersion' is distinct from '1' or p_payload->>'id' is distinct from w.payload->>'id' or jsonb_typeof(p_payload->'works') is distinct from 'array' or octet_length(p_payload::text)>20000000 then raise exception 'Invalid workspace'; end if;
 insert into public.workspace_revisions(workspace_id,owner_id,payload) values(w.id,w.owner_id,w.payload);
 next_version=w.version+1;
 update public.workspaces set payload=p_payload,version=next_version,updated_at=now() where id=w.id;
 update public.agent_runs set applied_version=case when p_revert then applied_version else next_version end,applied_hash=case when p_revert then applied_hash else p_after_hash end,reverted=p_revert,updated_at=now() where id=p_id;
 return jsonb_build_object('status','saved','version',next_version);
end $$;
revoke all on function public.agent_claim_run(uuid,text),public.agent_record_step(uuid,text,jsonb,jsonb),public.agent_commit_workspace(uuid,bigint,jsonb,text,boolean) from public,anon,authenticated;
grant execute on function public.agent_claim_run(uuid,text),public.agent_record_step(uuid,text,jsonb,jsonb),public.agent_commit_workspace(uuid,bigint,jsonb,text,boolean) to service_role;
commit;
