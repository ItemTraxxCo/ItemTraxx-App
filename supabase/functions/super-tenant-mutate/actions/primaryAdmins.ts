import { isMissingPostgrestColumn } from "../../_shared/postgrestErrors.ts";
import {
  ACCESS_CODE_PATTERN,
  optionalText,
  requireEmail,
  requireEnum,
  requireText,
  requireUuid,
  SLUG_PATTERN,
} from "../../_shared/validation.ts";
import type { PgError, SuperTenantContext, TenantRow } from "../context.ts";
import { normalizeDistrictSlug } from "./districts.ts";
import { isMissingDistrictIdColumn } from "./contracts.ts";
import {
  defaultFeatureFlags,
  enrichTenants,
  isMissingPrimaryAdminColumn,
  isMissingStatusColumn,
} from "./tenantQueries.ts";
import {
  ensureDistrict,
  isValidTenantPlanForAccountCategory,
  TENANT_ACCOUNT_CATEGORIES,
  TENANT_PLAN_CODES,
  TENANT_STATUSES,
  upsertTenantPolicy,
} from "./tenantWrites.ts";

const isMissingIsActiveColumn = (error: PgError | null | undefined) =>
  isMissingPostgrestColumn(error, "is_active");

const lower = (value: string | null | undefined) => (value ?? "").toLowerCase();

export const handlePrimaryAdminAction = async (
  context: SuperTenantContext,
) => {
  const { action, adminClient, jsonResponse, payload, user, writeAudit } =
    context;

  if (action === "create_tenant") {
    const next = payload;
    const name = requireText(next.name, { maxLen: 120 });
    const accessCode = requireText(next.access_code, {
      maxLen: 64,
      pattern: ACCESS_CODE_PATTERN,
    });
    const authEmail = requireEmail(next.auth_email);
    const password = typeof next.password === "string" ? next.password : "";
    const status = requireEnum(next.status, TENANT_STATUSES);
    const accountCategory =
      next.account_category === undefined || next.account_category === null ||
        next.account_category === ""
        ? "organization"
        : requireEnum(next.account_category, TENANT_ACCOUNT_CATEGORIES);
    const planCode = next.plan_code === undefined || next.plan_code === null ||
        next.plan_code === ""
      ? null
      : requireEnum(next.plan_code, TENANT_PLAN_CODES);
    const districtSlugRaw = optionalText(next.district_slug, { maxLen: 80 });
    const districtSlug = districtSlugRaw
      ? requireText(normalizeDistrictSlug(districtSlugRaw), {
        maxLen: 63,
        pattern: SLUG_PATTERN,
      })
      : "";
    const districtName = optionalText(next.district_name, { maxLen: 120 });

    if (password.length < 8 || password.length > 1024) {
      return jsonResponse(400, { error: "Invalid request" });
    }
    if ((districtSlug && !districtName) || (!districtSlug && districtName)) {
      return jsonResponse(400, {
        error:
          "District name and slug must both be provided when assigning a district.",
      });
    }
    if (
      (accountCategory === "individual" &&
        !(!planCode || planCode === "individual_yearly" ||
          planCode === "individual_monthly")) ||
      (accountCategory === "district" &&
        !(!planCode || planCode === "core" || planCode === "growth" ||
          planCode === "enterprise")) ||
      (accountCategory === "organization" &&
        !(!planCode || planCode === "starter" || planCode === "scale" ||
          planCode === "enterprise"))
    ) {
      return jsonResponse(400, {
        error: "Invalid plan for tenant account category.",
      });
    }
    if (accountCategory === "individual" && (districtSlug || districtName)) {
      return jsonResponse(400, {
        error: "Individual accounts cannot be assigned to a district.",
      });
    }

    let districtId: string | null = null;
    if (districtSlug && districtName) {
      const districtResult = await ensureDistrict(
        context,
        districtSlug,
        districtName,
      );
      if (districtResult.error) {
        return jsonResponse(400, { error: districtResult.error });
      }
      districtId = districtResult.districtId;
    }

    const { data: existingProfile } = await adminClient
      .from("profiles")
      .select("id")
      .eq("auth_email", authEmail)
      .maybeSingle();
    if (existingProfile?.id) {
      return jsonResponse(409, {
        error:
          "This email is already in use. Use a different email for this tenant admin account.",
      });
    }

    const { data, error } = await adminClient
      .from("tenants")
      .insert({
        name,
        access_code: accessCode,
        status,
        district_id: districtId,
      })
      .select(
        "id, name, access_code, status, created_at, district_id, primary_admin_profile_id",
      )
      .single();

    if (error || !data) {
      if (
        !isMissingStatusColumn(error as PgError) &&
        !isMissingDistrictIdColumn(error as PgError)
      ) {
        return jsonResponse(400, { error: "Unable to create tenant." });
      }

      const { data: fallbackData, error: fallbackError } = await adminClient
        .from("tenants")
        .insert({ name, access_code: accessCode })
        .select("id, name, access_code, created_at")
        .single();

      if (fallbackError || !fallbackData) {
        return jsonResponse(400, { error: "Unable to create tenant." });
      }

      const fallbackResponse = {
        ...fallbackData,
        status: "active",
        district_id: null,
        primary_admin_profile_id: null,
      } as TenantRow;

      return jsonResponse(200, {
        data: (await enrichTenants(context, [fallbackResponse]))[0],
        warning:
          "Tenant created in legacy mode. Run latest migration to enable full status and primary admin fields.",
      });
    }

    const createAuthUser = await adminClient.auth.admin.createUser({
      email: authEmail,
      password,
      email_confirm: true,
    });
    if (createAuthUser.error || !createAuthUser.data.user?.id) {
      await adminClient.from("tenants").delete().eq("id", data.id);
      const message = lower(createAuthUser.error?.message);
      if (
        message.includes("already") ||
        message.includes("registered") ||
        message.includes("exists")
      ) {
        return jsonResponse(409, {
          error:
            "This email is already registered. Use a different email for the tenant admin login.",
        });
      }
      if (message.includes("password")) {
        return jsonResponse(400, {
          error:
            "Password does not meet requirements. Use a stronger password and try again.",
        });
      }
      return jsonResponse(400, {
        error: "Unable to create auth user.",
      });
    }

    const userId = createAuthUser.data.user.id;
    let createdProfileId: string | null = null;

    const insertWithIsActive = await adminClient
      .from("profiles")
      .insert({
        id: userId,
        tenant_id: data.id,
        auth_email: authEmail,
        role: "tenant_admin",
        is_active: true,
      })
      .select("id")
      .single();

    if (insertWithIsActive.error) {
      if (!isMissingIsActiveColumn(insertWithIsActive.error as PgError)) {
        await adminClient.auth.admin.deleteUser(userId);
        await adminClient.from("tenants").delete().eq("id", data.id);
        return jsonResponse(400, {
          error: "Unable to create tenant admin profile.",
        });
      }

      const insertLegacyProfile = await adminClient
        .from("profiles")
        .insert({
          id: userId,
          tenant_id: data.id,
          auth_email: authEmail,
          role: "tenant_admin",
        })
        .select("id")
        .single();

      if (insertLegacyProfile.error) {
        await adminClient.auth.admin.deleteUser(userId);
        await adminClient.from("tenants").delete().eq("id", data.id);
        return jsonResponse(400, {
          error: "Unable to create tenant admin profile.",
        });
      }

      createdProfileId = insertLegacyProfile.data.id;
    } else {
      createdProfileId = insertWithIsActive.data.id;
    }

    if (createdProfileId) {
      const updateTenantPrimary = await adminClient
        .from("tenants")
        .update({ primary_admin_profile_id: createdProfileId })
        .eq("id", data.id);

      if (
        updateTenantPrimary.error &&
        !isMissingPrimaryAdminColumn(updateTenantPrimary.error as PgError)
      ) {
        await adminClient.auth.admin.deleteUser(userId);
        await adminClient.from("profiles").delete().eq("id", createdProfileId);
        await adminClient.from("tenants").delete().eq("id", data.id);
        return jsonResponse(400, {
          error: "Unable to set tenant primary admin.",
        });
      }
    }

    const tenantPolicyResult = await upsertTenantPolicy(context, {
      tenant_id: data.id,
      checkout_due_hours: 72,
      account_category: accountCategory,
      plan_code: planCode,
      feature_flags: defaultFeatureFlags(),
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    });

    if (tenantPolicyResult.error) {
      console.error("super-tenant-mutate tenant policy create failed", {
        code: tenantPolicyResult.error.code,
        message: tenantPolicyResult.error.message,
        details: tenantPolicyResult.error.details,
        hint: tenantPolicyResult.error.hint,
        accountCategory,
        planCode,
        tenantId: data.id,
      });
      await adminClient.auth.admin.deleteUser(userId);
      if (createdProfileId) {
        await adminClient.from("profiles").delete().eq("id", createdProfileId);
      }
      await adminClient.from("tenants").delete().eq("id", data.id);
      return jsonResponse(400, {
        error: "Unable to create tenant policy.",
      });
    }

    await writeAudit("create_tenant", "tenant", data.id, {
      tenant_name: data.name,
      status: data.status,
      account_category: accountCategory,
      plan_code: planCode,
      district_slug: districtSlug || null,
      tenant_admin_email: authEmail,
    });

    const { data: finalTenant } = await adminClient
      .from("tenants")
      .select(
        "id, name, access_code, status, created_at, district_id, primary_admin_profile_id",
      )
      .eq("id", data.id)
      .single();

    return jsonResponse(200, {
      data:
        (await enrichTenants(context, [(finalTenant ?? data) as TenantRow]))[0],
    });
  }

  if (action === "send_primary_admin_reset") {
    const next = payload;
    const tenantId = requireUuid(next.tenant_id);

    const { data: tenant, error: tenantError } = await adminClient
      .from("tenants")
      .select("id, primary_admin_profile_id")
      .eq("id", tenantId)
      .single();

    if (tenantError || !tenant?.id) {
      return jsonResponse(400, { error: "Invalid tenant." });
    }

    if (!tenant.primary_admin_profile_id) {
      return jsonResponse(400, {
        error: "No primary admin is set for this tenant.",
      });
    }

    const { data: primaryProfile, error: primaryError } = await adminClient
      .from("profiles")
      .select("auth_email")
      .eq("id", tenant.primary_admin_profile_id)
      .single();

    const authEmail = primaryProfile?.auth_email?.trim();
    if (primaryError || !authEmail) {
      return jsonResponse(400, { error: "Primary admin email not found." });
    }

    const redirectTo = context.resetRedirectTo;
    if (!redirectTo) {
      console.error(
        "super-tenant-mutate missing ITX_PASSWORD_RESET_REDIRECT_URL",
      );
      return jsonResponse(500, {
        error: "Password reset redirect is not configured.",
      });
    }
    const { error: resetError } = await adminClient.auth.resetPasswordForEmail(
      authEmail,
      { redirectTo },
    );
    if (resetError) {
      return jsonResponse(400, {
        error: `Unable to send password reset. ${resetError.message}`,
      });
    }

    await writeAudit("send_primary_admin_reset", "tenant", tenant.id, {
      auth_email: authEmail,
    });

    return jsonResponse(200, {
      data: { success: true, auth_email: authEmail },
    });
  }

  if (action === "set_primary_admin") {
    const next = payload;
    const tenantId = requireUuid(next.tenant_id);
    const profileId = requireUuid(next.profile_id);

    const { data: targetProfile, error: profileError } = await adminClient
      .from("profiles")
      .select("id, tenant_id, role, auth_email")
      .eq("id", profileId)
      .single();

    if (
      profileError ||
      !targetProfile?.id ||
      targetProfile.tenant_id !== tenantId ||
      targetProfile.role !== "tenant_admin"
    ) {
      return jsonResponse(400, { error: "Invalid tenant admin profile." });
    }

    const { data, error } = await adminClient
      .from("tenants")
      .update({ primary_admin_profile_id: profileId })
      .eq("id", tenantId)
      .select(
        "id, name, access_code, status, created_at, district_id, primary_admin_profile_id",
      )
      .single();

    if (error || !data) {
      if (isMissingPrimaryAdminColumn(error as PgError)) {
        return jsonResponse(400, {
          error:
            "Primary admin field is not enabled yet. Run the latest database migration.",
        });
      }
      return jsonResponse(400, { error: "Unable to update primary admin." });
    }

    await writeAudit("set_primary_admin", "tenant", tenantId, {
      profile_id: profileId,
      auth_email: targetProfile.auth_email ?? null,
    });

    return jsonResponse(200, {
      data: (await enrichTenants(context, [data as TenantRow]))[0],
    });
  }

  return jsonResponse(400, { error: "Invalid action" });
};
