<template>
  <div class="page security-report-page">
    <main class="security-report-container">
      <RouterLink class="brand-mark" to="/" aria-label="ItemTraxx home">
        <img v-if="brandLogoUrl" class="brand-mark-full" :src="brandLogoUrl" alt="ItemTraxx Co" />
      </RouterLink>

      <div class="page-nav-left security-report-top-nav">
        <RouterLink class="security-report-back-link" to="/security" aria-label="Return to security page" @click.prevent="$router.back()">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5 8 12l7 7" />
          </svg>
        </RouterLink>
        <span class="security-report-breadcrumb"> </span>
      </div>

      <section class="security-report-hero">
        <p class="security-report-eyebrow">Security reporting</p>
        <h1>Report a security issue privately.</h1>
        <p class="security-report-lead">
          Found a possible vulnerability? Share a concise report with steps to reproduce and expected impact.
          Keep testing limited to what is necessary to verify the issue safely.
        </p>
      </section>

      <section class="security-report-guidance-card">
        <p class="security-report-section-label">How to report clearly</p>
        <h2>What helps us verify quickly.</h2>
        <div class="security-report-guidance-grid">
          <div>
            <h3>Include</h3>
            <ul class="security-report-list">
              <li v-for="item in reportContents" :key="item.title">
                <strong>{{ item.title }}</strong>
                <span>{{ item.description }}</span>
              </li>
            </ul>
          </div>
          <div>
            <h3>Avoid</h3>
            <ul class="security-report-list">
              <li v-for="item in avoidList" :key="item.title">
                <strong>{{ item.title }}</strong>
                <span>{{ item.description }}</span>
              </li>
            </ul>
          </div>
        </div>
        <p class="security-report-reference">
          Public disclosure contact reference:
          <a href="https://itemtraxx.com/.well-known/security.txt" target="_blank" rel="noreferrer">security.txt</a>.
          If your issue is not security-related, use <RouterLink to="/contact-support">Contact Support</RouterLink>.
        </p>
      </section>

      <section class="security-report-layout">
        <section class="security-report-form-card">
          <p class="security-report-section-label">Submission</p>
          <h2>Send us something you found.</h2>

          <form class="form" @submit.prevent="handleSend">
            <label>
              Name
              <input
                v-model.trim="fullName"
                type="text"
                required
                maxlength="120"
                placeholder="Your full name"
              />
            </label>

            <label>
              Reply email address
              <input
                v-model.trim="replyEmail"
                type="email"
                required
                maxlength="160"
                placeholder="security@example.org"
              />
            </label>

            <label>
              Short summary
              <input
                v-model.trim="summary"
                type="text"
                required
                maxlength="160"
                placeholder="Short title for the issue"
              />
            </label>

            <label>
              Severity estimate
              <select v-model="severity">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
                <option value="unknown">Unsure</option>
              </select>
            </label>

            <label>
              Affected page or process
              <input
                v-model.trim="affectedArea"
                type="text"
                maxlength="160"
                placeholder="/login, /tenant/checkout, admin action, checkout, return, etc."
              />
            </label>

            <label>
              Report details
              <textarea
                v-model.trim="details"
                rows="8"
                maxlength="4000"
                placeholder="Describe what you found, how to reproduce it, and what impact you believe it has. And any other details that can help us understand and verify the issue."
              ></textarea>
            </label>

            <label>
              Attach images (optional, max 2 images)
              <input
                ref="attachmentsInput"
                type="file"
                accept="image/*"
                multiple
                @change="handleAttachmentChange"
              />
              <p class="muted">Supported file types: PNG, JPG, WEBP, or GIF. Maximum 2 images, up to 4 MB each.</p>
            </label>

            <ul v-if="attachments.length" class="attachment-list">
              <li v-for="file in attachments" :key="file.filename">
                <span>{{ file.filename }}</span>
                <span class="muted">{{ formatAttachmentSize(file.size_bytes) }}</span>
              </li>
            </ul>

            <label v-if="turnstileSiteKey">
              Security Check
              <div :ref="setTurnstileContainerRef"></div>
              <p class="muted security-note">Complete the security check to enable send.</p>
            </label>

            <input
              v-model="website"
              type="text"
              class="honeypot"
              autocomplete="off"
              tabindex="-1"
              aria-hidden="true"
            />

            <div class="form-actions">
              <button type="submit" class="button-primary" :disabled="isSending || !canSubmit">
                {{ isSending ? "Sending..." : "Send security report" }}
              </button>
            </div>
            <p class="security-report-legal-note">
              By clicking Send Security Report, you agree to our <RouterLink to="/privacy">Privacy Policy</RouterLink> and <RouterLink to="/legal">Terms of Service</RouterLink>.
            </p>
          </form>

          <p v-if="error" class="error">{{ error }}</p>
        </section>
      </section>

      <PublicFooter />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import PublicFooter from "../components/PublicFooter.vue";
import { useTurnstile } from "../composables/useTurnstile";
import { submitContactSupportRequest } from "../services/contactSupportService";
import { toUserFacingErrorMessage } from "../services/appErrors";
import { saveSubmissionConfirmation } from "../services/submissionConfirmation";

type SupportAttachment = {
  filename: string;
  content_type: string;
  content_base64: string;
  size_bytes: number;
};

const router = useRouter();
const fullName = ref("");
const replyEmail = ref("");
const summary = ref("");
const severity = ref<"low" | "medium" | "high" | "critical" | "unknown">("unknown");
const affectedArea = ref("");
const details = ref("");
const website = ref("");
const attachments = ref<SupportAttachment[]>([]);
const attachmentsInput = ref<HTMLInputElement | null>(null);
const isSending = ref(false);
const error = ref("");
const lightBrandLogoUrl = import.meta.env.VITE_BRAND_LOGO_LIGHT_URL as string | undefined;
const darkBrandLogoUrl = import.meta.env.VITE_BRAND_LOGO_DARK_URL as string | undefined;
const themeMode = ref<"light" | "dark">("dark");
const brandLogoUrl = computed(() =>
  themeMode.value === "light"
    ? lightBrandLogoUrl || darkBrandLogoUrl || ""
    : darkBrandLogoUrl || lightBrandLogoUrl || ""
);
const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
const {
  containerRef: turnstileContainerRef,
  token: turnstileToken,
  reset: resetTurnstile,
} = useTurnstile(turnstileSiteKey);
let themeObserver: MutationObserver | null = null;

const setTurnstileContainerRef = (
  el: Element | { $el?: Element } | null
) => {
  if (el instanceof HTMLElement) {
    turnstileContainerRef.value = el;
    return;
  }
  if (el && "$el" in el && el.$el instanceof HTMLElement) {
    turnstileContainerRef.value = el.$el;
    return;
  }
  turnstileContainerRef.value = null;
};

const canSubmit = computed(() => {
  if (!fullName.value || !replyEmail.value || !summary.value || !details.value) return false;
  if (turnstileSiteKey && !turnstileToken.value) return false;
  return true;
});

const formatAttachmentSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const fileToAttachment = (file: File) =>
  new Promise<SupportAttachment>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Unable to read ${file.name}.`));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const commaIndex = result.indexOf(",");
      const contentBase64 = commaIndex >= 0 ? result.slice(commaIndex + 1) : result;
      resolve({
        filename: file.name,
        content_type: file.type || "application/octet-stream",
        content_base64: contentBase64,
        size_bytes: file.size,
      });
    };
    reader.readAsDataURL(file);
  });

const handleAttachmentChange = async (event: Event) => {
  error.value = "";
  const target = event.target as HTMLInputElement | null;
  const files = Array.from(target?.files ?? []);
  if (files.length === 0) {
    attachments.value = [];
    return;
  }
  if (files.length > 2) {
    error.value = "Attach up to 2 images.";
    if (attachmentsInput.value) attachmentsInput.value.value = "";
    attachments.value = [];
    return;
  }
  const invalidType = files.find((file) => !file.type.startsWith("image/"));
  if (invalidType) {
    error.value = "Only image attachments are allowed.";
    if (attachmentsInput.value) attachmentsInput.value.value = "";
    attachments.value = [];
    return;
  }
  const oversized = files.find((file) => file.size > 4 * 1024 * 1024);
  if (oversized) {
    error.value = `${oversized.name} is larger than 4 MB.`;
    if (attachmentsInput.value) attachmentsInput.value.value = "";
    attachments.value = [];
    return;
  }
  try {
    attachments.value = await Promise.all(files.map((file) => fileToAttachment(file)));
  } catch (err) {
    error.value = toUserFacingErrorMessage(err, "Unable to process attachments.");
    if (attachmentsInput.value) attachmentsInput.value.value = "";
    attachments.value = [];
  }
};

const handleSend = () => {
  void send();
};

const send = async () => {
  error.value = "";
  if (!canSubmit.value || (turnstileSiteKey && !turnstileToken.value)) {
    error.value = "Complete required fields and security check.";
    return;
  }
  isSending.value = true;
  try {
    const renderedMessage = [
      `Security report severity: ${severity.value}`,
      affectedArea.value ? `Affected area: ${affectedArea.value}` : null,
      "",
      details.value,
    ]
      .filter(Boolean)
      .join("\n");

    const response = await submitContactSupportRequest({
      name: fullName.value,
      reply_email: replyEmail.value,
      subject: `[Security Report] ${summary.value}`,
      category: "bug",
      message: renderedMessage,
      turnstile_token: turnstileToken.value ?? "",
      website: website.value,
      attachments: attachments.value,
    });

    saveSubmissionConfirmation({
      kind: "Security report",
      title: "Security report sent.",
      lead: "Your security report was submitted privately. We will follow up from support@itemtraxx.com after review.",
      submittedAt: new Date().toISOString(),
      referenceId: response?.request_id ?? null,
      fields: [
        { label: "Reply email", value: replyEmail.value },
        { label: "Name", value: fullName.value },
        { label: "Severity", value: severity.value },
        { label: "Summary", value: summary.value },
        ...(affectedArea.value ? [{ label: "Affected area", value: affectedArea.value }] : []),
      ],
    });

    await router.push({ name: "public-submit-confirmation" });
  } catch (err) {
    error.value = toUserFacingErrorMessage(err, "Unable to send security report.");
  } finally {
    isSending.value = false;
    if (turnstileSiteKey) {
      try {
        resetTurnstile();
      } catch {
        // no-op
      }
    }
  }
};

const reportContents = [
  {
    title: "Clear summary",
    description: "Describe what you found, what you expected, and why you believe it is security-sensitive.",
  },
  {
    title: "Reproduction steps",
    description: "Include the exact steps, route, tenant context, and whether the issue requires authentication.",
  },
  {
    title: "Impact",
    description: "Explain the likely effect: unauthorized access, data exposure, privilege escalation, or workflow bypass.",
  },
  {
    title: "Evidence",
    description: "Attach screenshots, request details, console output, or other proof that helps confirm the issue quickly.",
  },
];

const avoidList = [
  {
    title: "Do not post publicly first",
    description: "Please report privately and give us time to investigate before public disclosure.",
  },
  {
    title: "Do not access unrelated data",
    description: "Verify only what you need. Do not browse, download, or retain data unrelated to your finding.",
  },
  {
    title: "Do not disrupt service",
    description: "Avoid destructive testing or high-volume traffic that could impact real users.",
  },
];

onMounted(() => {
  const syncTheme = () => {
    themeMode.value = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  };
  syncTheme();
  themeObserver = new MutationObserver(syncTheme);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
});

onUnmounted(() => {
  if (themeObserver) {
    themeObserver.disconnect();
    themeObserver = null;
  }
});
</script>

<style scoped>
.security-report-page {
  max-width: 1080px;
  padding-top: calc(2rem + env(safe-area-inset-top, 0px));
}

.security-report-container {
  width: 100%;
}

.brand-mark {
  display: inline-flex;
  align-items: center;
  text-decoration: none;
  margin-bottom: 0.45rem;
}

.brand-mark-full {
  height: 5.8rem;
  width: auto;
  object-fit: contain;
  display: block;
}

.security-report-top-nav {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  margin-bottom: 1rem;
}

.security-report-back-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 999px;
  border: 1px solid rgba(77, 97, 122, 0.4);
  background: linear-gradient(180deg, rgba(31, 40, 54, 0.46) 0%, rgba(17, 23, 32, 0.34) 100%);
  backdrop-filter: blur(2px);
  color: #f5f7fb;
  text-decoration: none;
  transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease;
}

.security-report-back-link:hover {
  text-decoration: none;
  transform: translateY(-1px);
  border-color: rgba(39, 196, 172, 0.58);
  background: linear-gradient(180deg, rgba(29, 66, 75, 0.62) 0%, rgba(16, 37, 48, 0.54) 100%);
  box-shadow: 0 16px 32px rgba(25, 194, 168, 0.14);
}

.security-report-back-link svg {
  width: 1.1rem;
  height: 1.1rem;
  stroke: currentColor;
  stroke-width: 2;
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.security-report-breadcrumb,
.security-report-eyebrow,
.security-report-section-label {
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: inherit;
  opacity: 0.72;
}

.security-report-hero {
  display: grid;
  gap: 0.65rem;
  margin-bottom: 1rem;
}

.security-report-hero h1,
.security-report-form-card h2,
.security-report-guidance-card h2 {
  margin: 0;
  font-size: clamp(1.4rem, 3vw, 2.4rem);
  line-height: 1.06;
  letter-spacing: -0.05em;
}

.security-report-form-card h2,
.security-report-guidance-card h2 {
  font-size: clamp(1.2rem, 2vw, 1.75rem);
}

.security-report-lead,
.security-report-form-card p,
.security-report-guidance-card p,
.security-report-list span {
  margin: 0;
  color: inherit;
  opacity: 0.82;
  line-height: 1.7;
}

.security-report-layout {
  display: block;
}

.security-report-form-card .form {
  margin-top: 0.8rem;
}

.security-report-guidance-card {
  display: grid;
  gap: 1rem;
  margin: 0.2rem 0 1.25rem;
  padding-bottom: 1rem;
  border-bottom: 3px solid color-mix(in srgb, var(--border) 78%, transparent);
}

.security-report-guidance-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.security-report-guidance-grid h3 {
  margin: 0 0 0.6rem;
  font-size: 0.95rem;
  letter-spacing: 0.01em;
}

.security-report-reference {
  opacity: 0.8;
}

.security-report-list {
  margin: 0;
  padding-left: 1.2rem;
  display: grid;
  gap: 0.8rem;
}

.security-report-list li {
  display: grid;
  gap: 0.18rem;
}

.security-report-page a {
  color: var(--link-color);
}

.security-report-form-card label {
  display: grid;
  gap: 0.48rem;
  font-weight: 600;
}

.security-report-form-card input:not(.honeypot),
.security-report-form-card select,
.security-report-form-card textarea {
  box-shadow: 0 1px 3px color-mix(in srgb, #000 10%, transparent);
}

.security-report-form-card textarea {
  min-height: 10rem;
}

.security-report-form-card input[type="file"] {
  padding: 0.75rem;
}

.security-report-form-card input[type="file"]::file-selector-button {
  margin-right: 0.8rem;
  border: 1px solid var(--report-input-border);
  border-radius: 999px;
  padding: 0.45rem 0.8rem;
  background: rgba(25, 194, 168, 0.12);
  color: inherit;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.security-report-legal-note {
  margin: 0.4rem 0 1.25rem;
  padding-bottom: 0.85rem;
  border-bottom: 2px solid color-mix(in srgb, var(--border) 78%, transparent);
  color: inherit;
  opacity: 0.72;
  font-size: 0.92rem;
}

.security-note {
  font-size: 0.84rem;
}

.security-report-form-card .button-primary:disabled {
  background: color-mix(in srgb, var(--surface-2) 84%, #8b9097 16%);
  border-color: color-mix(in srgb, var(--border) 78%, #8b9097 22%);
  color: color-mix(in srgb, currentColor 65%, transparent);
  box-shadow: none;
  cursor: not-allowed;
  opacity: 0.8;
}

.attachment-list {
  margin: 0;
  padding-left: 1.1rem;
}

.attachment-list li {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
}

.honeypot {
  position: absolute;
  left: -9999px;
  top: auto;
  width: 1px;
  height: 1px;
  overflow: hidden;
}

@media (max-width: 900px) {
  .security-report-guidance-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .security-report-page {
    padding-top: calc(1.25rem + env(safe-area-inset-top, 0px));
  }

  .brand-mark {
    margin-bottom: 0.25rem;
  }

  .brand-mark-full {
    height: 3.9rem;
  }

  .security-report-guidance-card {
    margin-bottom: 1rem;
  }
}
</style>
