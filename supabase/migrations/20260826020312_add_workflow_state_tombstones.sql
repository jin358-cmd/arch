-- Preserve removals across devices without hard-deleting version history (remote migration 20260826020312).
alter table public.workflow_project_state
add column is_deleted boolean not null default false;
