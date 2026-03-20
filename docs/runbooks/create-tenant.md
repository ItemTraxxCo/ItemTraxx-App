# Create Tenant Runbook

This runbook documents the current process for creating a new tenant in ItemTraxx.

## Where To Create Tenants

Use the super admin tenant management page:

- `https://itemtraxx.com/super-admin/tenants`

The create flow is handled by:

- `/Users/dennisfrenkel/Documents/ItemTraxx/itemtraxx-code/src/pages/super/Tenants.vue`
- `/Users/dennisfrenkel/Documents/ItemTraxx/itemtraxx-code/src/services/superTenantService.ts`
- `/Users/dennisfrenkel/Documents/ItemTraxx/itemtraxx-code/supabase/functions/super-tenant-mutate/index.ts`

Backend action:

- `create_tenant`

## Required Inputs

When creating a tenant, the current UI requires:

- `Tenant name`
- `Access code`
- `Tenant admin email`
- `Tenant admin password`
- `Tenant status`

It also supports:

- `Account category`
- `Plan`
- `District assignment` for district-linked tenants

## Current Account Categories And Plans

### Organization

Allowed plans:

- `starter`
- `scale`
- `enterprise`

### District

Allowed plans:

- `core`
- `growth`
- `enterprise`

### Individual

Allowed plans:

- `individual_yearly`
- `individual_monthly`

Constraints:

- `individual` tenants cannot be assigned to a district.
- District-linked tenants must provide both a district name and district slug.

## What The Create Flow Does

When the super admin submits the form, ItemTraxx does all of the following.

1. Creates the tenant row in `public.tenants`
- stores tenant name
- stores access code
- stores status
- stores `district_id` when applicable

2. Creates the initial tenant admin auth account
- creates a Supabase Auth user with the submitted email and password
- sets `email_confirm: true`

3. Creates the primary admin profile
- inserts a `profiles` row
- assigns role `tenant_admin`
- links the profile to the new tenant
- sets `is_active = true` when that column exists in the schema

4. Marks the primary admin on the tenant
- updates `tenants.primary_admin_profile_id`

5. Creates the tenant policy row
- `checkout_due_hours = 72`
- selected `account_category`
- selected `plan_code`
- default feature flags

6. Writes an audit log entry
- action: `create_tenant`

## Important Current Behavior

### Initial tenant admin is created with a real password

The first tenant admin is not invited by reset link.

Current behavior:

- the super admin sets the initial tenant admin email and password during tenant creation
- that tenant admin can sign in immediately after creation

### Additional tenant admins are different

After tenant creation, the primary tenant admin can create additional tenant admins from:

- `/tenant/admin/admins`

Those additional tenant admins are created by:

- email address
- password reset / setup link

They are not created by assigning a direct password in the create form.

## Recommended Creation Checklist

Before creating the tenant:

1. Confirm tenant name
2. Confirm access code
3. Confirm tenant admin email
4. Confirm tenant admin password meets requirements
5. Confirm correct account category
6. Confirm correct plan
7. Confirm district assignment, if applicable

After creating the tenant:

1. Verify tenant appears in `/super-admin/tenants`
2. Verify tenant status is correct
3. Verify plan and account category are correct
4. Verify district assignment is correct, if applicable
5. Verify the tenant admin can sign in
6. If district-linked, verify login redirects to the correct custom district host

## Failure Modes To Check

### Tenant create fails immediately

Likely causes:

- duplicate tenant admin email
- weak password
- invalid account category / plan pairing
- invalid district assignment
- schema drift in `tenant_policies` or `tenants`

### Tenant created but admin cannot sign in

Check:

- auth user was created
- `profiles` row exists with role `tenant_admin`
- `profiles.tenant_id` is correct
- tenant is not suspended or archived

### District-linked tenant does not route correctly

Check:

- district exists
- tenant has correct `district_id`
- district slug is valid
- district host DNS/setup is in place

## Notes

- This runbook documents the current production-oriented flow.
- If the tenant creation process is changed later to invite the initial tenant admin by reset link instead of password, this runbook should be updated.
