import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  emailPurposeFromSupportCategory,
  extractEmailAddress,
  resolveEmailAddress,
  resolveEmailFrom,
} from "./emailConfig.ts";

const withEnv = async (
  vars: Record<string, string | undefined>,
  fn: () => Promise<void>,
) => {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = Deno.env.get(key);
    if (value === undefined) Deno.env.delete(key);
    else Deno.env.set(key, value);
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
};

Deno.test("resolveEmailFrom prefers the purpose-specific identity", async () => {
  await withEnv(
    {
      ITX_EMAIL_SALES: "ItemTraxx Sales <sales@example.test>",
      ITX_EMAIL_FROM: "ItemTraxx Support <support@example.test>",
      ITX_RESEND_FROM: "ItemTraxx Legacy <legacy@example.test>",
    },
    async () => {
      assertEquals(
        resolveEmailFrom("sales"),
        "ItemTraxx Sales <sales@example.test>",
      );
    },
  );
});

Deno.test("resolveEmailFrom preserves the shared and legacy fallbacks", async () => {
  await withEnv(
    {
      ITX_EMAIL_SALES: undefined,
      ITX_EMAIL_FROM: "ItemTraxx Support <support@example.test>",
      ITX_RESEND_FROM: "ItemTraxx Legacy <legacy@example.test>",
    },
    async () => {
      assertEquals(
        resolveEmailFrom("sales"),
        "ItemTraxx Support <support@example.test>",
      );
    },
  );

  await withEnv(
    {
      ITX_EMAIL_SALES: undefined,
      ITX_EMAIL_FROM: undefined,
      ITX_RESEND_FROM: "ItemTraxx Legacy <legacy@example.test>",
    },
    async () => {
      assertEquals(
        resolveEmailFrom("sales"),
        "ItemTraxx Legacy <legacy@example.test>",
      );
    },
  );
});

Deno.test("resolveEmailAddress extracts display-name addresses and honors legacy overrides", async () => {
  assertEquals(
    extractEmailAddress("ItemTraxx Sales <sales@example.test>"),
    "sales@example.test",
  );
  assertEquals(
    extractEmailAddress("support@example.test"),
    "support@example.test",
  );

  await withEnv(
    {
      ITX_EMAIL_SUPPORT: undefined,
      ITX_SUPPORT_EMAIL: "legacy-support@example.test",
    },
    async () => {
      assertEquals(
        resolveEmailAddress("support", "ITX_SUPPORT_EMAIL"),
        "legacy-support@example.test",
      );
    },
  );

  await withEnv(
    {
      ITX_EMAIL_SUPPORT: "ItemTraxx Support <support@example.test>",
      ITX_SUPPORT_EMAIL: "legacy-support@example.test",
    },
    async () => {
      assertEquals(
        resolveEmailAddress("support", "ITX_SUPPORT_EMAIL"),
        "support@example.test",
      );
    },
  );
});

Deno.test("emailPurposeFromSupportCategory separates privacy and security requests", () => {
  assertEquals(emailPurposeFromSupportCategory("privacy"), "privacy");
  assertEquals(emailPurposeFromSupportCategory("security"), "security");
  assertEquals(emailPurposeFromSupportCategory("bug"), "support");
});
