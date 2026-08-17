-- Keep the Super Admin reporting contract aligned with the item-based schema.
-- The workspace-model migration created this output as gear_total before the
-- physical gear -> items rename. Renaming the materialized-view column avoids
-- changing the Edge Function and frontend contract or touching stored data.
do $$
begin
  if to_regclass('public.super_reporting_workspace_metrics') is null then
    return;
  end if;

  if exists (
       select 1
       from pg_attribute
       where attrelid = 'public.super_reporting_workspace_metrics'::regclass
         and attname = 'gear_total'
         and not attisdropped
     )
     and not exists (
       select 1
       from pg_attribute
       where attrelid = 'public.super_reporting_workspace_metrics'::regclass
         and attname = 'item_total'
         and not attisdropped
     ) then
    alter materialized view public.super_reporting_workspace_metrics
      rename column gear_total to item_total;
  end if;
end
$$;
