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
rollback;
