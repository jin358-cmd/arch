-- New Building Workflow cloud synchronization (remote migration 20260826020023)
-- Client access is limited to authenticated users and their own rows.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.workflow_projects (
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id text not null,
  name text not null,
  schema_version smallint not null default 1,
  version bigint not null default 1,
  device_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, project_id),
  constraint workflow_projects_project_id_length check (octet_length(project_id) between 1 and 240),
  constraint workflow_projects_name_length check (char_length(name) between 1 and 200),
  constraint workflow_projects_schema_version_positive check (schema_version > 0),
  constraint workflow_projects_version_positive check (version > 0),
  constraint workflow_projects_device_id_length check (device_id is null or octet_length(device_id) <= 160)
);

create table public.workflow_project_state (
  user_id uuid not null,
  project_id text not null,
  state_key text not null,
  state_value text not null,
  version bigint not null default 1,
  device_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, project_id, state_key),
  constraint workflow_project_state_project_fk
    foreign key (user_id, project_id)
    references public.workflow_projects (user_id, project_id)
    on delete cascade,
  constraint workflow_project_state_key_length check (octet_length(state_key) between 1 and 160),
  constraint workflow_project_state_version_positive check (version > 0),
  constraint workflow_project_state_device_id_length check (device_id is null or octet_length(device_id) <= 160)
);

create table public.workflow_meeting_attachments (
  user_id uuid not null,
  id text not null,
  project_id text not null,
  meeting_id text not null,
  object_path text not null,
  original_name text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint workflow_meeting_attachments_project_fk
    foreign key (user_id, project_id)
    references public.workflow_projects (user_id, project_id)
    on delete cascade,
  constraint workflow_meeting_attachments_object_unique unique (user_id, object_path),
  constraint workflow_meeting_attachments_id_length check (octet_length(id) between 1 and 240),
  constraint workflow_meeting_attachments_meeting_id_length check (octet_length(meeting_id) between 1 and 240),
  constraint workflow_meeting_attachments_name_length check (char_length(original_name) between 1 and 512),
  constraint workflow_meeting_attachments_mime_length check (octet_length(mime_type) between 1 and 255),
  constraint workflow_meeting_attachments_path_length check (octet_length(object_path) between 1 and 1024),
  constraint workflow_meeting_attachments_path_owner check (split_part(object_path, '/', 1) = user_id::text),
  constraint workflow_meeting_attachments_path_project check (split_part(object_path, '/', 2) = project_id),
  constraint workflow_meeting_attachments_size check (size_bytes between 0 and 20971520)
);

create index workflow_meeting_attachments_project_meeting_idx
  on public.workflow_meeting_attachments (user_id, project_id, meeting_id, uploaded_at desc);

create or replace function private.set_workflow_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

revoke execute on function private.set_workflow_updated_at() from public, anon, authenticated;

create trigger workflow_projects_set_updated_at
before update on public.workflow_projects
for each row execute function private.set_workflow_updated_at();

create trigger workflow_project_state_set_updated_at
before update on public.workflow_project_state
for each row execute function private.set_workflow_updated_at();

create trigger workflow_meeting_attachments_set_updated_at
before update on public.workflow_meeting_attachments
for each row execute function private.set_workflow_updated_at();

alter table public.workflow_projects enable row level security;
alter table public.workflow_projects force row level security;
alter table public.workflow_project_state enable row level security;
alter table public.workflow_project_state force row level security;
alter table public.workflow_meeting_attachments enable row level security;
alter table public.workflow_meeting_attachments force row level security;

revoke all on public.workflow_projects from anon, authenticated;
revoke all on public.workflow_project_state from anon, authenticated;
revoke all on public.workflow_meeting_attachments from anon, authenticated;
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.workflow_projects to authenticated;
grant select, insert, update, delete on public.workflow_project_state to authenticated;
grant select, insert, update, delete on public.workflow_meeting_attachments to authenticated;

create policy workflow_projects_select_own
on public.workflow_projects for select to authenticated
using ((select auth.uid()) = user_id);

create policy workflow_projects_insert_own
on public.workflow_projects for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy workflow_projects_update_own
on public.workflow_projects for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy workflow_projects_delete_own
on public.workflow_projects for delete to authenticated
using ((select auth.uid()) = user_id);

create policy workflow_project_state_select_own
on public.workflow_project_state for select to authenticated
using ((select auth.uid()) = user_id);

create policy workflow_project_state_insert_own
on public.workflow_project_state for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy workflow_project_state_update_own
on public.workflow_project_state for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy workflow_project_state_delete_own
on public.workflow_project_state for delete to authenticated
using ((select auth.uid()) = user_id);

create policy workflow_meeting_attachments_select_own
on public.workflow_meeting_attachments for select to authenticated
using ((select auth.uid()) = user_id);

create policy workflow_meeting_attachments_insert_own
on public.workflow_meeting_attachments for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy workflow_meeting_attachments_update_own
on public.workflow_meeting_attachments for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy workflow_meeting_attachments_delete_own
on public.workflow_meeting_attachments for delete to authenticated
using ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit)
values ('workflow-meeting-attachments', 'workflow-meeting-attachments', false, 20971520)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

create policy workflow_storage_select_own
on storage.objects for select to authenticated
using (
  bucket_id = 'workflow-meeting-attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.workflow_projects project
    where project.user_id = (select auth.uid())
      and project.project_id = (storage.foldername(name))[2]
  )
);

create policy workflow_storage_insert_own
on storage.objects for insert to authenticated
with check (
  bucket_id = 'workflow-meeting-attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.workflow_projects project
    where project.user_id = (select auth.uid())
      and project.project_id = (storage.foldername(name))[2]
  )
);

create policy workflow_storage_update_own
on storage.objects for update to authenticated
using (
  bucket_id = 'workflow-meeting-attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.workflow_projects project
    where project.user_id = (select auth.uid())
      and project.project_id = (storage.foldername(name))[2]
  )
)
with check (
  bucket_id = 'workflow-meeting-attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.workflow_projects project
    where project.user_id = (select auth.uid())
      and project.project_id = (storage.foldername(name))[2]
  )
);

create policy workflow_storage_delete_own
on storage.objects for delete to authenticated
using (
  bucket_id = 'workflow-meeting-attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.workflow_projects project
    where project.user_id = (select auth.uid())
      and project.project_id = (storage.foldername(name))[2]
  )
);

alter table public.workflow_projects replica identity full;
alter table public.workflow_project_state replica identity full;
alter table public.workflow_meeting_attachments replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workflow_projects'
    ) then
      execute 'alter publication supabase_realtime add table public.workflow_projects';
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workflow_project_state'
    ) then
      execute 'alter publication supabase_realtime add table public.workflow_project_state';
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workflow_meeting_attachments'
    ) then
      execute 'alter publication supabase_realtime add table public.workflow_meeting_attachments';
    end if;
  end if;
end;
$$;
