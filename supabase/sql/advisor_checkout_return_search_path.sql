-- ITX-45: pin checkout_return search_path (advisor 0011_function_search_path_mutable).
-- Body unchanged from the deployed definition; only adds `set search_path`.
-- pg_temp is included so the `tmp_gear` temporary table still resolves.
create or replace function public.checkout_return(p_student_id text, p_gear_barcodes text[], p_action_type text)
 returns json
 language plpgsql
 set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_tenant_id uuid;
  v_student_uuid uuid;
  v_expected_count int := coalesce(array_length(p_gear_barcodes, 1), 0);
  v_found_count int;
begin
  if v_user_id is null then
    raise exception 'Unauthorized';
  end if;

  if v_expected_count = 0 then
    raise exception 'No gear provided';
  end if;

  select tenant_id into v_tenant_id
  from profiles
  where id = v_user_id;

  if v_tenant_id is null then
    raise exception 'Unauthorized';
  end if;

  if p_action_type <> 'admin_return' then
    select id into v_student_uuid
    from students
    where tenant_id = v_tenant_id
      and student_id = p_student_id;

    if v_student_uuid is null then
      raise exception 'Student not found';
    end if;
  end if;

  select count(*) into v_found_count
  from gear
  where tenant_id = v_tenant_id
    and barcode = any(p_gear_barcodes);

  if v_found_count <> v_expected_count then
    raise exception 'Gear not found';
  end if;

  -- Lock gear rows
  drop table if exists tmp_gear;

  create temporary table tmp_gear
  on commit drop
  as
  select id, barcode, status, checked_out_by
  from gear
  where tenant_id = v_tenant_id
    and barcode = any(p_gear_barcodes)
  for update;

  -- Reject unavailable statuses
  if exists (
    select 1 from tmp_gear
    where status in ('damaged','lost','retired','in_studio_only')
  ) then
    raise exception 'Gear unavailable';
  end if;

  if p_action_type = 'checkout' then
    if exists (select 1 from tmp_gear where checked_out_by is not null) then
      raise exception 'Gear already checked out';
    end if;

    update gear
    set checked_out_by = v_student_uuid,
        checked_out_at = now(),
        status = 'checked_out'
    where id in (select id from tmp_gear);

    insert into gear_logs (tenant_id, gear_id, checked_out_by, action_type, action_time, performed_by)
    select v_tenant_id, id, v_student_uuid, 'checkout', now(), v_user_id
    from tmp_gear;

  elsif p_action_type = 'return' then
    if exists (
      select 1 from tmp_gear
      where checked_out_by is distinct from v_student_uuid
    ) then
      raise exception 'Gear checked out by different student';
    end if;

    update gear
    set checked_out_by = null,
        checked_out_at = null,
        status = 'available'
    where id in (select id from tmp_gear);

    insert into gear_logs (tenant_id, gear_id, checked_out_by, action_type, action_time, performed_by)
    select v_tenant_id, id, v_student_uuid, 'return', now(), v_user_id
    from tmp_gear;

  elsif p_action_type = 'auto' then
    -- Return only items already checked out by this student
    update gear
    set checked_out_by = null,
        checked_out_at = null,
        status = 'available'
    where id in (
      select id from tmp_gear
      where checked_out_by = v_student_uuid
    );

    insert into gear_logs (tenant_id, gear_id, checked_out_by, action_type, action_time, performed_by)
    select v_tenant_id, id, v_student_uuid, 'return', now(), v_user_id
    from tmp_gear
    where checked_out_by = v_student_uuid;

    -- Checkout only items not checked out
    if exists (
      select 1 from tmp_gear
      where checked_out_by is not null
        and checked_out_by <> v_student_uuid
    ) then
      raise exception 'Gear checked out by different student';
    end if;

    update gear
    set checked_out_by = v_student_uuid,
        checked_out_at = now(),
        status = 'checked_out'
    where id in (
      select id from tmp_gear
      where checked_out_by is null
    );

    insert into gear_logs (tenant_id, gear_id, checked_out_by, action_type, action_time, performed_by)
    select v_tenant_id, id, v_student_uuid, 'checkout', now(), v_user_id
    from tmp_gear
    where checked_out_by is null;

  elsif p_action_type = 'admin_return' then
    -- Ensure all items are currently checked out
    if exists (select 1 from tmp_gear where checked_out_by is null) then
      raise exception 'Gear not checked out';
    end if;

    update gear
    set checked_out_by = null,
        checked_out_at = null,
        status = 'available'
    where id in (select id from tmp_gear);

    insert into gear_logs (tenant_id, gear_id, checked_out_by, action_type, action_time, performed_by)
    select v_tenant_id, id, checked_out_by, 'return', now(), v_user_id
    from tmp_gear;

  else
    raise exception 'Invalid action type';
  end if;

  return json_build_object('success', true);
end;
$function$;
