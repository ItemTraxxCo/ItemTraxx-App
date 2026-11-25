begin;

insert into public.workspaces (id, name, slug, status)
values ('d2e37e92-845c-49e0-8e23-acf280177001', 'Synthetic quota test', 'synthetic-quota-cascade', 'suspended');
insert into public.borrowers (id, workspace_id, username, borrower_id)
values ('d2e37e92-845c-49e0-8e23-acf280177002', 'd2e37e92-845c-49e0-8e23-acf280177001', 'Synthetic', 'SYNTHETIC-1'),
       ('d2e37e92-845c-49e0-8e23-acf280177003', 'd2e37e92-845c-49e0-8e23-acf280177001', 'Synthetic two', 'SYNTHETIC-2');
insert into public.items (id, workspace_id, name, status)
values ('d2e37e92-845c-49e0-8e23-acf280177004', 'd2e37e92-845c-49e0-8e23-acf280177001', 'Synthetic item', 'available');

do $$ begin
  if (select active_borrowers from public.workspace_usage where workspace_id = 'd2e37e92-845c-49e0-8e23-acf280177001') <> 2 then
    raise exception 'borrower increment failed';
  end if;
  if (select active_items from public.workspace_usage where workspace_id = 'd2e37e92-845c-49e0-8e23-acf280177001') <> 1 then
    raise exception 'item increment failed';
  end if;
end $$;
delete from public.borrowers where id = 'd2e37e92-845c-49e0-8e23-acf280177002';
do $$ begin
  if (select active_borrowers from public.workspace_usage where workspace_id = 'd2e37e92-845c-49e0-8e23-acf280177001') <> 1 then
    raise exception 'ordinary borrower decrement failed';
  end if;
end $$;

delete from public.workspaces where id = 'd2e37e92-845c-49e0-8e23-acf280177001';
do $$ begin
  if exists (select 1 from public.borrowers where workspace_id = 'd2e37e92-845c-49e0-8e23-acf280177001')
    or exists (select 1 from public.items where workspace_id = 'd2e37e92-845c-49e0-8e23-acf280177001')
    or exists (select 1 from public.workspace_usage where workspace_id = 'd2e37e92-845c-49e0-8e23-acf280177001') then
    raise exception 'cascade left workspace data behind';
  end if;
end $$;

insert into public.workspaces (id, name, slug, status, archived_at, purge_after, purge_state)
values ('d2e37e92-845c-49e0-8e23-acf280177005', 'Synthetic purge test', 'synthetic-quota-purge', 'suspended', now() - interval '2 days', now() - interval '1 day', 'purging');
insert into public.borrowers (workspace_id, username, borrower_id)
values ('d2e37e92-845c-49e0-8e23-acf280177005', 'Synthetic', 'SYNTHETIC-3');
insert into public.items (workspace_id, name, status)
values ('d2e37e92-845c-49e0-8e23-acf280177005', 'Synthetic item', 'available');
insert into public.sgw_workspace_key_lifecycle (workspace_id, state)
values ('d2e37e92-845c-49e0-8e23-acf280177005', 'revoked');
set local role service_role;
select public.purge_workspace_data('d2e37e92-845c-49e0-8e23-acf280177005', '{}'::jsonb);
reset role;
do $$ begin
  if exists (select 1 from public.workspaces where id = 'd2e37e92-845c-49e0-8e23-acf280177005') then
    raise exception 'workspace purge did not remove the workspace';
  end if;
end $$;
rollback;
