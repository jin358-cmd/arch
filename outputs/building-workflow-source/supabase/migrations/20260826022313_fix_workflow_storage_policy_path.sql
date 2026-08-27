-- Qualify the outer storage object name inside project ownership subqueries (remote migration 20260826022313).
-- Without the qualification, PostgreSQL can bind `name` to workflow_projects.name.
drop policy if exists workflow_storage_select_own on storage.objects;
drop policy if exists workflow_storage_insert_own on storage.objects;
drop policy if exists workflow_storage_update_own on storage.objects;
drop policy if exists workflow_storage_delete_own on storage.objects;

create policy workflow_storage_select_own
on storage.objects for select to authenticated
using (
  bucket_id = 'workflow-meeting-attachments'
  and (storage.foldername(storage.objects.name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.workflow_projects project
    where project.user_id = (select auth.uid())
      and project.project_id = (storage.foldername(storage.objects.name))[2]
  )
);

create policy workflow_storage_insert_own
on storage.objects for insert to authenticated
with check (
  bucket_id = 'workflow-meeting-attachments'
  and (storage.foldername(storage.objects.name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.workflow_projects project
    where project.user_id = (select auth.uid())
      and project.project_id = (storage.foldername(storage.objects.name))[2]
  )
);

create policy workflow_storage_update_own
on storage.objects for update to authenticated
using (
  bucket_id = 'workflow-meeting-attachments'
  and (storage.foldername(storage.objects.name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.workflow_projects project
    where project.user_id = (select auth.uid())
      and project.project_id = (storage.foldername(storage.objects.name))[2]
  )
)
with check (
  bucket_id = 'workflow-meeting-attachments'
  and (storage.foldername(storage.objects.name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.workflow_projects project
    where project.user_id = (select auth.uid())
      and project.project_id = (storage.foldername(storage.objects.name))[2]
  )
);

create policy workflow_storage_delete_own
on storage.objects for delete to authenticated
using (
  bucket_id = 'workflow-meeting-attachments'
  and (storage.foldername(storage.objects.name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.workflow_projects project
    where project.user_id = (select auth.uid())
      and project.project_id = (storage.foldername(storage.objects.name))[2]
  )
);
